// BEACON — DEMO AUTO-REPORT WATCHER (plan §0 decision 18 / ADR-037 §5; FR-LD-13, FR-LD-14).
//
// WHAT THIS IS. During the live demo the first critical wildfire/flood signal in the watched region sends
// ONE Telegram message, so a real notification lands mid-presentation without an operator having to approve
// an alert on camera. It is env-gated (`DEMO_AUTO_REPORT`) and off by default.
//
// WHAT THIS IS NOT, and the reasons are constitutional, not stylistic:
//  • ART. XIII (human-in-the-loop before public action) — this module sends a MONITORING NOTIFICATION and
//    nothing else. It has NO alert store, NO `AlertSinkPort`, NO CAP/EDXL mapper and NO alert factory in its
//    dependency surface, so "the watcher cannot publish" is a property of the TYPE, not a promise in a
//    comment: there is nothing here to call. Every outbound text is prefixed `MONITORING_NOTICE_LABEL`, so a
//    recipient cannot mistake it for an approved public warning either. Public alerting still runs through
//    the DRAFT → authenticated VERIFIER/EM → `AlertSinkPort` path, untouched.
//  • ART. XII (deterministic → AI → human) — it makes NO judgement of its own. Whether a signal is firing
//    comes from `evaluateRule`, the SAME threshold engine the DRAFT-alert derivation uses (edge + dwell +
//    cooldown + the forecast vintage/lead-time gates); whether it is critical is an index comparison against
//    the domain's own ordered `ALERT_SEVERITIES`. No LLM is reachable from here, and no severity, category or
//    figure is invented — each travels with the signal from its source.
//  • ART. XIV — it never constructs a transport. It sends through the injected `NotificationPort`
//    (`makeNotifier`: PII redaction → output firewall → hash-chained audit → transport), which is the only
//    audited outbound surface in the system.
//
// EVERY instant is injected (`deps.clock`) and every effect is a port, so the whole watcher is provable with
// a fake notifier and no timer, no network and no clock read.
import type { AlertCategory, AlertSeverity } from '@/domain/alert.js';
import { ALERT_SEVERITIES } from '@/domain/alert.js';
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import type { Envelope, NotificationPort, SourceRef } from '@/ports/interaction.js';
import type {
  RuleRuntimeState,
  SignalReading,
} from '@/application/threshold-evaluation/threshold-evaluation.js';
import { evaluateRule } from '@/application/threshold-evaluation/threshold-evaluation.js';

/**
 * The mandatory prefix of every message this module can send (FR-LD-13). Exported so the test asserts the
 * EXACT shipped string rather than a copy that could drift away from it.
 */
export const MONITORING_NOTICE_LABEL = '⚠️ AUTOMATED MONITORING (not an approved public alert)';

/**
 * The severity floor at which an automated monitoring notification is warranted. It is a NAMED POSITION in
 * the domain's own ordered severity vocabulary (`ALERT_SEVERITIES`), not a second severity scale — a new
 * severity added to the domain re-ranks this comparison automatically instead of silently bypassing it.
 */
export const CRITICAL_SEVERITY_FLOOR: AlertSeverity = 'SEVERE';

/**
 * The hazard families the demo watcher reports on: `Fire` (wildfire) and `Met` (flood — CAP v1.2 has no
 * "Flood" category, so a river-flood warning is `Met`, the same mapping the RO scenario uses). `Safety` is
 * deliberately absent: it is the catch-all category, and a monitoring beat that fires on everything is a
 * notification nobody reads.
 */
export const WATCHED_CATEGORIES: readonly AlertCategory[] = ['Fire', 'Met'];

/**
 * One watched signal: a threshold RULE, its current READING, and the provenance the notification must cite.
 *
 * Deliberately NOT `ThresholdAlertSpec` (`@/application/derivation/derive-alerts.js`), which additionally
 * carries the `alertId` of the DRAFT it would propose. A watcher that must never create an alert has no
 * business holding an alert id, and omitting it means one cannot be leaked into a message by accident.
 */
export interface WatchedSignal {
  readonly rule: ThresholdRule;
  readonly reading: SignalReading;
  readonly category: AlertCategory;
  readonly severity: AlertSeverity;
  /** The SOURCE_RECORD reference behind the signal: citation + honest mode label + freshness (Art. XI/XVI). */
  readonly source: SourceRef;
  /** A deterministic one-line description of what fired. Composed from config/source values — never narrated. */
  readonly summary: string;
}

/**
 * The narrow audit surface this use-case needs, declared HERE rather than imported: `src/application/**` may
 * import ports and domain only, never an adapter (`.dependency-cruiser.cjs` `application-no-adapters`). The
 * shipped `AuditChain` (`@/adapters/compliance/audit-chain.js`) satisfies it structurally, so the watcher
 * writes into the SAME hash-chained AUDIT_EVENT log as every other audited action — no second log.
 */
export interface MonitoringAuditPort {
  append(input: {
    readonly action: string;
    readonly target: string;
    readonly at: string;
    readonly regionId?: string;
  }): unknown;
}

export interface DemoWatchDeps {
  /** The region under watch (`DEMO_AUTO_REPORT_REGION`) — reported verbatim in the message. */
  readonly regionId: string;
  /** The region's current signal slice. Injected so S2 can swap the seeded slice for live adapter data. */
  readonly signals: () => Promise<readonly WatchedSignal[]>;
  /** The EXISTING audited notifier. The only effect this module can have on the outside world. */
  readonly notifier: NotificationPort;
  /** Chat ids from the subscriber registry (`TELEGRAM_ALERT_CHAT_IDS`). Empty ⇒ nothing to send to. */
  readonly audience: readonly string[];
  readonly clock: () => string;
  /** `DEMO_AUTO_REPORT_ONCE` — latch after the first successful send (one notification per boot). */
  readonly once?: boolean;
  readonly audit?: MonitoringAuditPort;
}

/** Aggregate-only tick outcome: counts and flags, never the message text or a chat id. */
export interface DemoWatchTickResult {
  readonly evaluated: number;
  readonly fired: number;
  readonly sent: number;
  readonly failed: number;
  readonly latched: boolean;
  /** True when the latch was already closed and the tick did no work at all (not even a signal read). */
  readonly skipped: boolean;
}

export interface DemoWatcher {
  tick(): Promise<DemoWatchTickResult>;
  readonly latched: boolean;
}

const SKIPPED_TICK: DemoWatchTickResult = {
  evaluated: 0,
  fired: 0,
  sent: 0,
  failed: 0,
  latched: true,
  skipped: true,
};

const AUDIT_SENT = 'MONITORING_NOTIFICATION_SENT';
const AUDIT_FAILED = 'MONITORING_NOTIFICATION_FAILED';

/**
 * Whether a fired signal is worth an automated notification: a watched hazard family, at or above the
 * critical floor. Both halves come from the signal itself — this function classifies nothing (Art. XII).
 */
export function isReportable(signal: WatchedSignal): boolean {
  return (
    WATCHED_CATEGORIES.includes(signal.category) &&
    ALERT_SEVERITIES.indexOf(signal.severity) >= ALERT_SEVERITIES.indexOf(CRITICAL_SEVERITY_FLOOR)
  );
}

/**
 * The notification envelope. `headline` carries the mandatory label and `summary` the region, the signal,
 * its citation and its freshness — the two fields `makeNotifier` composes its outbound text from, in that
 * order, so the label is the FIRST thing a recipient reads. `provenance` is the signal's own SOURCE_RECORD
 * reference, which the notifier renders as a `sources:` footer (F1: no ungrounded data response).
 *
 * `meta.kind` states what this is in the payload as well as the prose, for any future consumer that reads
 * the envelope structurally instead of its text.
 */
export function monitoringEnvelope(signal: WatchedSignal, regionId: string, at: string): Envelope {
  const rule = `${signal.rule.target} ${signal.rule.operator} ${signal.rule.value}`;
  return {
    data: {
      headline: MONITORING_NOTICE_LABEL,
      summary:
        `region ${regionId} — ${signal.severity} ${signal.category} signal: ${signal.summary} ` +
        `[rule ${String(signal.rule.id)}: ${rule}] ` +
        `source ${signal.source.sourceId} (${signal.source.mode}), data as of ${signal.source.fetchedAt}`,
    },
    provenance: [signal.source],
    freshness: signal.source.fetchedAt,
    meta: { kind: 'MONITORING_NOTIFICATION', regionId, generatedAt: at },
  };
}

/**
 * Build the watcher. Per-rule runtime state (edge/dwell/cooldown/forecast vintage) is kept across ticks in
 * the closure, which is exactly what makes "the FIRST critical signal" meaningful: a rule that is still
 * above its threshold on the next tick has not fired again, so a re-fire cannot be manufactured by polling.
 */
export function makeDemoWatcher(deps: DemoWatchDeps): DemoWatcher {
  const state = new Map<string, RuleRuntimeState>();
  const once = deps.once ?? true;
  let latched = false;

  return {
    get latched(): boolean {
      return latched;
    },

    async tick(): Promise<DemoWatchTickResult> {
      if (once && latched) return SKIPPED_TICK;
      const at = deps.clock();
      const signals = await deps.signals();
      const fired = firedReportableSignals(signals, state, Date.parse(at));
      const first = fired[0];
      if (first === undefined) {
        return { evaluated: signals.length, fired: 0, sent: 0, failed: 0, latched, skipped: false };
      }
      const delivery = await sendMonitoring(deps, monitoringEnvelope(first, deps.regionId, at), at);
      // Latch on a SUCCESSFUL send only: latching on a failure would spend the one notification the demo
      // gets on a message nobody received (Art. XVI — degrade, never dead-end).
      if (delivery.sent > 0) latched = true;
      return {
        evaluated: signals.length,
        fired: fired.length,
        ...delivery,
        latched,
        skipped: false,
      };
    },
  };
}

/**
 * Evaluate every signal through the EXISTING threshold engine, carry each rule's runtime state forward, and
 * return those that both FIRED this tick and are reportable. Every signal is evaluated (never short-circuited
 * at the first fire) so the dwell/cooldown state of the others stays honest across ticks.
 */
function firedReportableSignals(
  signals: readonly WatchedSignal[],
  state: Map<string, RuleRuntimeState>,
  now: number,
): readonly WatchedSignal[] {
  const fired: WatchedSignal[] = [];
  for (const signal of signals) {
    const key = String(signal.rule.id);
    const previous = state.get(key);
    const outcome = evaluateRule({
      rule: signal.rule,
      reading: signal.reading,
      now,
      ...(previous !== undefined ? { previous } : {}),
    });
    state.set(key, outcome.state);
    if (outcome.fired && isReportable(signal)) fired.push(signal);
  }
  return fired;
}

/**
 * Deliver to every subscribed chat id. AUDITED-NOT-FATAL (Art. XVI, and the same posture as the approved-
 * alert broadcast in `interop.ts`): a typed `err` and a thrown transport are both recorded and swallowed —
 * a messaging problem must never terminate the scheduler loop or the server process.
 */
async function sendMonitoring(
  deps: DemoWatchDeps,
  envelope: Envelope,
  at: string,
): Promise<{ readonly sent: number; readonly failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const audience of deps.audience) {
    if (await deliverOne(deps, audience, envelope)) sent += 1;
    else failed += 1;
  }
  if (sent > 0) safeAudit(deps, AUDIT_SENT, at);
  if (failed > 0) safeAudit(deps, AUDIT_FAILED, at);
  return { sent, failed };
}

/** One delivery attempt. Returns whether it landed; never throws. */
async function deliverOne(
  deps: DemoWatchDeps,
  audience: string,
  envelope: Envelope,
): Promise<boolean> {
  try {
    const result = await deps.notifier.notify(audience, envelope);
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * Append one AGGREGATE-ONLY audit record (action + region target + instant — never the text, never a chat
 * id: the notifier already hash-chains the text digest). A ledger that is unavailable must not take the
 * watcher down with it, so the append itself is guarded.
 */
function safeAudit(deps: DemoWatchDeps, action: string, at: string): void {
  try {
    deps.audit?.append({
      action,
      target: `demo-watch:${deps.regionId}`,
      at,
      regionId: deps.regionId,
    });
  } catch {
    // Audited-not-fatal, one level up: an audit sink that throws must not break the monitoring beat.
  }
}
