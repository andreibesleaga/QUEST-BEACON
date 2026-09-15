'use client';
// BEACON — Verifier report queue (E8·T-378…T-381; FR-6/EV5/ST1/Art.XIII). Lists UNVERIFIED/TRIAGED reports
// for a VERIFIER (role via store.actorRole). Approve → VERIFIED (optimistic), reject/misinformation →
// REJECTED (NO outbound action), approve-with-CAP (emitCap=true) → surfaces the emitted DRAFT alert from the
// response meta (DRAFT-only — a DRAFT never auto-promotes to ACTUAL). Report text renders via React escaping
// (no dangerouslySetInnerHTML) — XSS-safe (T-394a).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ExternalLink, Eye, FileText, Radio, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button, EmptyState, OriginalLanguageChip, Panel, UnverifiedBadge } from '../ui/index.js';
import { useFormat, useT } from '../../_lib/i18n.js';
import { confidenceComponentsOf } from '../../_lib/mappers.js';
import { useVerifyReport } from '../../_lib/hooks.js';
import { useUiStore } from '../../_lib/store.js';
import type { ReportSummary, VerifyReportBody } from '../../_lib/types.js';

const PENDING_STATUSES = new Set(['UNVERIFIED', 'TRIAGED']);

/**
 * Terminal decisions. `transitionPublicReport` allows NOTHING out of these (domain TRANSITIONS), so a row
 * in one of them is finished work, not queue work — and GET /reports deliberately returns every report
 * (it is the honest store view, and an audit surface may want all of them). Filtering therefore belongs
 * HERE, in the queue panel: without it a rejected report reappeared on every refetch and sat in the queue
 * permanently, which is why "reject" did not feel like rejection (found 2026-08-04). The row the operator
 * JUST decided is kept on screen deliberately — see `visibleReports`.
 */
const TERMINAL_STATUSES = new Set(['VERIFIED', 'REJECTED']);
const VERIFIER_ROLES = new Set(['VERIFIER', 'EM']);

interface EmittedAlert {
  readonly id?: string | undefined;
  readonly capStatus?: string | undefined;
  readonly headline?: string | undefined;
}

/**
 * Defensively read the DRAFT alert the CAP-emit flow attached to the response meta.
 *
 * F-407: this read `state`, a key the `Alert` entity does not have — its CAP lifecycle marker is
 * `capStatus`. The consequence was invisible because the render site wrote `emitted.state ?? 'DRAFT'`, so
 * the banner printed a confident "DRAFT alert DRAFT" whether or not the server had said anything at all. A
 * defaulted display of an UNREAD field is worse than a blank one on an Art. XIII surface: it reports a
 * public-alert state the client never actually received. The fallback is gone with the wrong key.
 */
function readEmittedAlert(
  meta: Readonly<Record<string, unknown>> | undefined,
): EmittedAlert | undefined {
  const raw = meta?.['emittedAlert'];
  if (raw === null || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const pick = (k: keyof EmittedAlert): string | undefined =>
    typeof a[k] === 'string' ? (a[k] as string) : undefined;
  return { id: pick('id'), capStatus: pick('capStatus'), headline: pick('headline') };
}

/** Round a [0,1] engine score to a whole percentage for display (never recomputed — Art. XII rendering only). */
function pct(value: number): number {
  return Math.round(value * 100);
}

// Live Views v1.2 (ADR-029 / plan §3.6): a citizen live-view link auto-fades ~2h after receipt.
const LIVE_VIEW_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Pure, fixed-clock-testable freshness check for a citizen live-view link (Live Views v1.2, ADR-029). A link
 * older than the ~2h TTL auto-fades — the chip renders as a muted, non-clickable "expired live link" (the
 * stream is almost certainly over; an Unofficial link is never kept live indefinitely). `now` is injected so
 * tests are deterministic (no wall clock). An ABSENT/unparseable receipt time is treated as fresh (fail-open):
 * the read-model does not yet stamp a receipt time on the report row (see app/_lib/types.ts `submittedAt`).
 */
export function isLiveViewFresh(
  submittedAt: string | undefined,
  now: number,
  ttlMs: number = LIVE_VIEW_TTL_MS,
): boolean {
  if (submittedAt === undefined) return true;
  const t = Date.parse(submittedAt);
  if (Number.isNaN(t)) return true;
  return now - t <= ttlMs;
}

/**
 * The citizen live-view link chip (Live Views v1.2, ADR-029). Styled DISTINCTLY from agency content — a dashed
 * `warn`/`unverified`-toned border + the permanent "Live Feed — Unofficial" label — so it can NEVER be mistaken
 * for a trusted agency camera. Link-only (target=_blank rel=noopener noreferrer); BEACON never fetches it. Past
 * TTL it renders muted + non-clickable ("expired live link"). The caption reminds the verifier that rejecting
 * the report delists the link (the existing Reject affordance is the delist path — Art. XIII HITL).
 */
function LiveViewChip({
  reportId,
  url,
  fresh,
}: {
  reportId: string;
  url: string;
  fresh: boolean;
}): ReactNode {
  const t = useT('verifierQueue');
  if (!fresh) {
    return (
      <div
        className="flex flex-col gap-1 rounded-lg border border-dashed border-line bg-surface-2 p-2 text-xs opacity-70"
        data-testid={`live-view-expired-${reportId}`}
      >
        <div className="flex items-center gap-1.5">
          <Radio aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" strokeWidth={2} />
          <span className="font-medium text-fg-muted">{t('liveFeedExpired')}</span>
        </div>
        <p className="text-[11px] italic text-fg-muted">{t('liveFeedExpiredCaption')}</p>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-dashed border-warn bg-surface-2 p-2 text-xs"
      data-testid={`live-view-${reportId}`}
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 font-medium text-unverified underline"
        data-testid={`live-view-link-${reportId}`}
      >
        <Radio aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
        {t('liveFeed')}
        <ExternalLink aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
      </a>
      <p className="text-[11px] italic text-fg-muted">{t('liveFeedCaption')}</p>
    </div>
  );
}

interface VisionFindingView {
  readonly label: string;
  readonly confidence: number;
  readonly notes?: string | undefined;
}

/**
 * Defensively read the ADVISORY VisionFinding the verify PATCH's response meta may carry (W4c,
 * `command-router.ts` `handleVerify` → `requestVisionAssist`; unknown shape at the wire). Absent/malformed
 * → undefined so the chip simply doesn't render (present-only, never a dead-end).
 */
function readVisionFinding(
  meta: Readonly<Record<string, unknown>> | undefined,
): VisionFindingView | undefined {
  const raw = meta?.['visionFinding'];
  if (raw === null || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const label = typeof v['label'] === 'string' ? v['label'] : undefined;
  const confidence = typeof v['confidence'] === 'number' ? v['confidence'] : undefined;
  if (label === undefined || confidence === undefined) return undefined;
  const notes = typeof v['notes'] === 'string' ? v['notes'] : undefined;
  return { label, confidence, notes };
}

/**
 * The vision-assist chip (W4c wiring into the verifier queue) — an ADVISORY, confidence-scored finding from
 * a consented/PII-screened image the verifier attached to their decision. Rendered ONLY when the API returns
 * one (no imagery-attach affordance exists yet — honest scope). Explicitly labelled advisory: it informs the
 * human record, it NEVER auto-decides (Art. XII/XIII HITL) — the verifier's Approve/Reject choice already
 * stands by the time this arrives (`handleVerify` requests it AFTER the decision is committed).
 */
function VisionFindingChip({
  reportId,
  finding,
}: {
  reportId: string;
  finding: VisionFindingView;
}): ReactNode {
  const t = useT('verifierQueue');
  const format = useFormat();
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-dashed border-line bg-surface-2 p-2 text-xs"
      data-testid={`vision-finding-${reportId}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Eye aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" strokeWidth={2} />
        <span className="font-medium text-fg" data-testid={`vision-finding-label-${reportId}`}>
          {/* The finding LABEL is the model's own closed-vocabulary token ('burn-area') — verbatim (F-62). */}
          {t('visionFinding', { label: finding.label })}
        </span>
        <span
          className="tabular-nums text-fg-muted"
          data-testid={`vision-finding-confidence-${reportId}`}
        >
          {format.number(finding.confidence, { style: 'percent' })}
        </span>
      </div>
      {finding.notes !== undefined ? <p className="text-fg-muted">{finding.notes}</p> : null}
      <p
        className="text-[11px] italic text-fg-muted"
        data-testid={`vision-finding-caption-${reportId}`}
      >
        {t('visionCaption')}
      </p>
    </div>
  );
}

/**
 * The recorded-tile handle: a REAL NASA GIBS crop on disk (fixtures/vision/, PROVENANCE.json). It works
 * air-gapped and is the only imagery the gate profile ever requests.
 */
const FIXTURE_IMAGE_REF = 'fixture:gibs-modis721-burn-area-us-ca-001';

/** ~0.3° each way ≈ a 60–70 km box: wide enough for a MODIS/VIIRS product to show a perimeter's context. */
const LIVE_IMAGERY_HALF_SPAN_DEG = 0.3;

/**
 * Defensively read a `[lon, lat]` out of the report's precise geometry. `geomPrecise` is typed `unknown` here
 * and is present ONLY for RESPONDER+ (Art. XIV, server-gated at routes/queue.ts:101), so the live-imagery
 * affordance simply does not appear for a report whose position this client is not allowed to see.
 */
function readReportPosition(geomPrecise: unknown): readonly [number, number] | undefined {
  if (geomPrecise === null || typeof geomPrecise !== 'object') return undefined;
  const g = geomPrecise as { type?: unknown; coordinates?: unknown };
  if (g.type !== 'Point' || !Array.isArray(g.coordinates)) return undefined;
  const [lon, lat] = g.coordinates as unknown[];
  if (typeof lon !== 'number' || typeof lat !== 'number') return undefined;
  return [lon, lat];
}

/**
 * Build the LIVE `gibs:<layer>:<bbox>:<date>` handle from the report's own position and the current day.
 *
 * The empty layer segment means "the server's task-appropriate default" — the browser deliberately does not
 * pick a satellite product; `imagery/gibs.ts` owns that choice, and its `parseGibsRef` is the single parser
 * for this string. The two are pinned together by a test that feeds this function's output to that parser
 * (verifier-queue.test.tsx), so the format cannot drift on one side only.
 *
 * `now` is injected (the panel already threads it for live-view freshness) so the handle is deterministic
 * under a fixed test clock rather than dependent on the wall clock.
 */
export function liveImageRef(position: readonly [number, number], now: number): string {
  const [lon, lat] = position;
  const span = LIVE_IMAGERY_HALF_SPAN_DEG;
  const bbox = [lon - span, lat - span, lon + span, lat + span]
    .map((n) => Number(n.toFixed(4)))
    .join(',');
  return `gibs::${bbox}:${new Date(now).toISOString().slice(0, 10)}`;
}

/**
 * The deterministic confidence blend for a report: the overall score + each present sub-component as a
 * labelled bar (geocode / authority / classifier / corroboration). Rendered, never computed (Art. XII) —
 * this is exactly what the verifier needs to judge a report, incl. a low-corroboration misinformation smell.
 */
function ConfidenceMeter({ report }: { report: ReportSummary }): ReactNode {
  const t = useT('verifierQueue');
  // Percentages go through the ICU formatter so the DIGITS follow the locale too (an Arabic UI otherwise
  // mixed Arabic-Indic numerals in the prose with ASCII ones in the meter). `pct` stays for the CSS width,
  // which must remain an ASCII number whatever the locale.
  const format = useFormat();
  const components = confidenceComponentsOf(report);
  if (report.confidence === undefined && components.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid={`confidence-${report.id}`}>
      {report.confidence !== undefined ? (
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-fg-muted">{t('confidence')}</span>
          <span
            className="tabular-nums font-semibold text-fg"
            data-testid={`confidence-value-${report.id}`}
          >
            {format.number(report.confidence, { style: 'percent' })}
          </span>
        </div>
      ) : null}
      {components.length > 0 ? (
        <div className="flex flex-col gap-1" role="group" aria-label={t('componentsLabel')}>
          {components.map((c) => (
            <div
              key={c.key}
              className="flex items-center gap-2"
              data-testid={`component-${c.key}-${report.id}`}
            >
              <span className="w-28 shrink-0 text-[11px] text-fg-muted">
                {t(`component.${c.key}`)}
              </span>
              <span
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
                role="presentation"
              >
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${pct(c.value)}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-end text-[11px] tabular-nums text-fg-muted">
                {format.number(pct(c.value))}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReportRow({
  report,
  status,
  canAct,
  onDecide,
  visionEnabled,
  visionLiveEnabled,
  visionFinding,
  now,
}: {
  report: ReportSummary;
  status: string;
  canAct: boolean;
  onDecide: (
    id: string,
    decision: 'VERIFIED' | 'REJECTED',
    emitCap: boolean,
    imageRef: string | undefined,
  ) => void;
  /** Shows the advisory vision-check toggle (build-gated: NEXT_PUBLIC_FEATURE_VISION — UX-only; the
   *  server's FEATURE_VISION remains authoritative and simply produces no finding when off). */
  visionEnabled: boolean;
  /** Shows the LIVE-imagery variant of that toggle (build-gated: NEXT_PUBLIC_FEATURE_VISION_LIVE). */
  visionLiveEnabled: boolean;
  visionFinding?: VisionFindingView | undefined;
  /** Injected evaluation instant for live-view freshness (tests pass a fixed clock). */
  now?: number | undefined;
}): ReactNode {
  const t = useT('verifierQueue');
  const pending = PENDING_STATUSES.has(status);
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        {/* THE CLAIM under review. `PublicReportIntake.text` was required from S03 but no store persisted
            it, so this always fell through to a placeholder and the verifier was approving/rejecting blind
            (fixed 2026-08-04: entity + both stores + migration 0006 + the queue row now carry it).
            `whitespace-pre-wrap` keeps the reporter's own line breaks; `break-words` stops a long
            unbroken string from blowing out the queue column. The fallback is now reachable only for rows
            written before the column existed, and says exactly that rather than implying a policy. */}
        <p
          className="flex-1 whitespace-pre-wrap break-words text-sm text-fg"
          data-testid={`report-text-${report.id}`}
        >
          {report.text ?? t('noClaim')}
          {/* The claim is EVIDENCE and stays in the reporter's words — labelled, never silently English. */}
          {report.text !== undefined ? <OriginalLanguageChip /> : null}
        </p>
        {status === 'VERIFIED' || status === 'REJECTED' ? (
          <span
            className="shrink-0 rounded border border-line px-2 py-0.5 text-xs font-medium text-fg-muted"
            data-testid={`status-${report.id}`}
          >
            {status}
          </span>
        ) : (
          <UnverifiedBadge />
        )}
      </div>
      <ConfidenceMeter report={report} />
      {report.liveViewUrl !== undefined ? (
        <LiveViewChip
          reportId={report.id}
          url={report.liveViewUrl}
          // Evaluate freshness per render: default to Date.now() at call time (never a module-load default).
          fresh={isLiveViewFresh(report.submittedAt, now ?? Date.now())}
        />
      ) : null}
      {visionFinding !== undefined ? (
        <VisionFindingChip reportId={report.id} finding={visionFinding} />
      ) : null}
      {canAct && pending ? (
        <DecisionActions
          reportId={report.id}
          onDecide={onDecide}
          visionEnabled={visionEnabled}
          // Live imagery needs a place to look at: no precise position ⇒ no live variant, rather than a
          // handle pointing at an arbitrary bbox (the finding would be honest-looking and about nowhere).
          liveRef={liveRefFor(report, now, visionLiveEnabled)}
        />
      ) : null}
    </li>
  );
}

/**
 * The live `gibs:` handle for a report — undefined when the flag is off OR the precise position is not
 * available to this client. Both conditions live here (rather than at the call site) to keep ReportRow under
 * the complexity ceiling.
 */
function liveRefFor(
  report: ReportSummary,
  now: number | undefined,
  enabled: boolean,
): string | undefined {
  const position = enabled ? readReportPosition(report.geomPrecise) : undefined;
  return position === undefined ? undefined : liveImageRef(position, now ?? Date.now());
}

/**
 * The three decision buttons + the optional advisory vision toggles. Extracted from ReportRow purely to
 * stay under the complexity ceiling as the vision gate was added; behaviour is unchanged. The toggle's
 * state lives HERE so each row's choice is independent and resets when the row unmounts.
 */
function DecisionActions({
  reportId,
  onDecide,
  visionEnabled,
  liveRef,
}: {
  reportId: string;
  onDecide: (
    id: string,
    decision: 'VERIFIED' | 'REJECTED',
    emitCap: boolean,
    imageRef: string | undefined,
  ) => void;
  visionEnabled: boolean;
  /** The LIVE imagery handle for this row, or undefined when the live variant must not be offered. */
  liveRef?: string | undefined;
}): ReactNode {
  // Advisory only (Art. XII/XIII): the analysis rides ALONG WITH the human decision — it can never
  // change it, and a vision failure never blocks it (the server attaches meta.visionFinding after the
  // decision is committed). The recorded-fixture choice works air-gapped; the live choice fetches a fresh
  // NASA GIBS crop of THIS report's position server-side (the browser never fetches imagery itself).
  const t = useT('verifierQueue');
  const [withVision, setWithVision] = useState(false);
  const [useLive, setUseLive] = useState(false);
  const live = useLive && liveRef !== undefined;
  const imageRef = withVision ? (live ? liveRef : FIXTURE_IMAGE_REF) : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {visionEnabled ? (
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            className="size-3.5"
            checked={withVision}
            onChange={(e) => setWithVision(e.target.checked)}
            data-testid={`vision-toggle-${reportId}`}
          />
          <Eye aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
          {t('visionToggle')}
        </label>
      ) : null}
      {/* The live variant is a SECOND, dependent choice rather than a replacement: the recorded fixture is
          the offline path and must stay one click away when the network (or the free model tier) is down.
          Nested under the vision toggle because live imagery with no vision request is meaningless. */}
      {visionEnabled && withVision && liveRef !== undefined ? (
        <label className="ms-5 flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            className="size-3.5"
            checked={useLive}
            onChange={(e) => setUseLive(e.target.checked)}
            data-testid={`vision-live-toggle-${reportId}`}
          />
          {t('visionLiveToggle')}
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          data-testid="verify-report-btn"
          onClick={() => onDecide(reportId, 'VERIFIED', false, imageRef)}
        >
          <Check aria-hidden="true" className="size-4" strokeWidth={2} /> {t('approve')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          data-testid="reject-report-btn"
          title={t('rejectTitle')}
          onClick={() => onDecide(reportId, 'REJECTED', false, imageRef)}
        >
          <ShieldAlert aria-hidden="true" className="size-4" strokeWidth={2} /> {t('reject')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDecide(reportId, 'VERIFIED', true, imageRef)}
        >
          <ShieldCheck aria-hidden="true" className="size-4" strokeWidth={2} />{' '}
          {t('approveWithCap')}
        </Button>
      </div>
      <p className="text-[11px] text-fg-muted">{t('rejectCaption')}</p>
    </div>
  );
}

export interface VerifierQueueProps {
  reports: readonly ReportSummary[];
  /** Region scoping the optimistic verify cache key. */
  regionId?: string | undefined;
  /** Shows the per-row advisory vision-check toggle (build-gated in page.tsx; default off keeps every
   *  existing baseline byte-identical). */
  visionEnabled?: boolean | undefined;
  /**
   * Shows the LIVE-imagery variant of that toggle (build-gated: `NEXT_PUBLIC_FEATURE_VISION_LIVE`, mirrored
   * in page.tsx from the server's own `VISION_MODE`). DEFAULT OFF, and nested inside `visionEnabled`, so the
   * Playwright baselines cannot move: the gate profile pins both flags off.
   */
  visionLiveEnabled?: boolean | undefined;
  className?: string | undefined;
  /** Injected evaluation instant for live-view freshness (defaults to Date.now() per render). */
  now?: number | undefined;
}

/**
 * The verify request body. Extracted from the click handler purely to keep `VerifierQueue` under the
 * complexity gate — the three optional spreads are cheap to read on their own and were the difference.
 *
 * The vision request is either the recorded on-disk crop (air-gapped) or a live NASA GIBS handle for this
 * report's own position; `imageRef` already carries that choice. Consent and PII-screen are asserted
 * because BOTH are public satellite imagery with no reporter PII. The server re-verifies both gates
 * in-path regardless (compliance gateway + sealed adapter), and `VISION_PII_SCREEN=on` additionally
 * refuses any scheme whose provenance it does not know (imagery/resolver.ts) — the client asserting a
 * gate is never what satisfies it.
 */
/**
 * The emitted-draft-alert sentence. Extracted from the render so `VerifierQueue` stays under the
 * complexity gate, and because the branch deserves its own name.
 *
 * `status` is the CAP lifecycle token (DRAFT) and `headline` the engine-built CAP headline — both pass
 * through VERBATIM as arguments; only the sentence around them is translated. The headline
 * present/absent split is two whole messages rather than a glued-on ": headline", so a translator can
 * put the colon clause where their own language wants it.
 */
type VerifierT = ReturnType<typeof useT<'verifierQueue'>>;

function emittedAlertText(
  t: VerifierT,
  emitted: {
    readonly capStatus?: string | undefined;
    readonly id?: string | undefined;
    readonly headline?: string | undefined;
  },
): string {
  const values = {
    status: emitted.capStatus ?? t('emittedAlertStatusFallback'),
    id: emitted.id ?? '',
  };
  return emitted.headline === undefined
    ? t('emittedAlert', values)
    : t('emittedAlertWithHeadline', { ...values, headline: emitted.headline });
}

function decisionBody(
  decision: 'VERIFIED' | 'REJECTED',
  emitCap: boolean,
  imageRef: string | undefined,
): VerifyReportBody {
  return {
    decision,
    ...(emitCap ? { emitCap: true } : {}),
    ...(imageRef !== undefined
      ? {
          visionAssist: {
            imageRef,
            task: 'burn-area' as const,
            imageConsented: true,
            piiScreened: true,
          },
        }
      : {}),
  };
}

export function VerifierQueue({
  reports,
  regionId,
  visionEnabled,
  visionLiveEnabled,
  className,
  now,
}: VerifierQueueProps): ReactNode {
  const t = useT('verifierQueue');
  const actorRole = useUiStore((s) => s.actorRole);
  const verify = useVerifyReport(regionId);
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  // The report id the LATEST verify mutation targeted — scopes the (unscoped-at-the-wire) response meta's
  // vision finding / emitted alert back onto the row that produced them.
  const [lastDecidedId, setLastDecidedId] = useState<string | undefined>(undefined);
  const canAct = VERIFIER_ROLES.has(actorRole);

  function onDecide(
    id: string,
    decision: 'VERIFIED' | 'REJECTED',
    emitCap: boolean,
    imageRef: string | undefined,
  ): void {
    setOptimistic((prev) => ({ ...prev, [id]: decision }));
    setLastDecidedId(id);
    verify.mutate(
      { id, body: decisionBody(decision, emitCap, imageRef) },
      {
        // A decision that did NOT persist must not stay hidden behind the optimistic entry — clear it so
        // the row returns, and say so. An Art. XIII surface never fails silently (that silence is exactly
        // how the illegal-transition 409 shipped unnoticed until 2026-08-05).
        onError: () => {
          setOptimistic((prev) =>
            Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)),
          );
          setLastDecidedId(undefined);
        },
      },
    );
  }

  const emitted = readEmittedAlert(verify.data?.meta);
  const visionFinding = readVisionFinding(verify.data?.meta);

  // The queue shows OUTSTANDING work. A decided report drops out — except the one just acted on, which
  // stays visible with its status badge (and any emitted-alert / vision detail) so the operator SEES the
  // decision land instead of the row vanishing mid-click. It leaves on the next region switch/refresh,
  // when `lastDecidedId` no longer matches. Note this reads the OPTIMISTIC status, so the row survives
  // the round-trip rather than flickering out and back.
  const visibleReports = reports.filter(
    (r) => !TERMINAL_STATUSES.has(optimistic[r.id] ?? r.status) || r.id === lastDecidedId,
  );

  return (
    <Panel title={t('title')} className={className} data-testid="verifier-queue">
      {verify.isError ? (
        <p role="alert" className="mb-2 text-xs text-alert" data-testid="decision-error">
          {t('decisionFailed')}
        </p>
      ) : null}
      {visibleReports.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} icon={FileText} />
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleReports.map((r) => (
            <ReportRow
              key={r.id}
              report={r}
              status={optimistic[r.id] ?? r.status}
              canAct={canAct}
              onDecide={onDecide}
              visionEnabled={visionEnabled === true}
              visionLiveEnabled={visionLiveEnabled === true}
              visionFinding={r.id === lastDecidedId ? visionFinding : undefined}
              now={now}
            />
          ))}
        </ul>
      )}

      {emitted ? (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-3 text-sm"
          data-testid="emitted-draft-alert"
        >
          <ShieldCheck
            aria-hidden="true"
            className="size-4 shrink-0 text-fg-muted"
            strokeWidth={2}
          />
          <span className="text-fg">
            {/* `status` is the CAP lifecycle token (DRAFT) and `headline` the engine-built CAP headline —
                both pass through VERBATIM as arguments; only the sentence around them is translated. The
                headline present/absent split is two messages rather than a glued-on ": headline", so a
                translator can put the colon clause where their language wants it. */}
            {emittedAlertText(t, emitted)}
            {/* Engine-built CAP headline tokens — English by design, labelled (Art. XII/XVI). */}
            <OriginalLanguageChip />
          </span>
        </div>
      ) : null}
    </Panel>
  );
}
