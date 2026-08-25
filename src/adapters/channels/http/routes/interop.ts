// BEACON — interop HTTP handlers (E7·T-291/T-303/T-307; SPEC §2.2, ADR-010/ADR-023, Art. XIII). Framework-
// agnostic PURE handlers for the CAP/EDXL interop surface (FR-9). Each parses an already-authenticated,
// already-validated request shape and returns an Envelope-shaped { status, body } — the Next.js (or any)
// transport adapts native req/res into these, and the composition root wires them into the dispatcher
// (ZERO edits to routing.ts / http-dispatcher.ts). RBAC is enforced here by role rank (identical policy to
// the command-router's MIN_ROLE, Art. XIII); DomainError codes map to HTTP status via error-mapping.
//
// GUARDRAIL (Art. XIII, HITL before public action): POST /alerts/:id/approve is the ONLY path that promotes
// a DRAFT → ACTUAL and emits it. It requires VERIFIER+ AND a human approver (approvedBy = the actor); a
// non-DRAFT, an unauthorized actor, or a missing approver is REJECTED — a DRAFT can never reach emit.
import type { AppUserRole } from '@/domain/app-user.js';
import { roleRank } from '@/domain/app-user.js';
import { DomainError, Unauthorized } from '@/domain/errors.js';
import type { Alert } from '@/domain/alert.js';
import { approveAlert, buildAllClear } from '@/domain/alert.js';
import type { ResourceTask } from '@/domain/resource-task.js';
import type { SitRep } from '@/domain/sitrep.js';
import type { AlertId, AppUserId } from '@/domain/value-objects/ids.js';
import type { Envelope, SourceRef, CitationView, NotificationPort } from '@/ports/interaction.js';
import type { SubscriberRegistry } from '@/adapters/channels/messaging/subscriber-registry.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { edxlRmToResourceTask, resourceTaskToEdxlRm } from '@/adapters/interop/edxl-rm-mapper.js';
import type { EdxlRmMessage } from '@/adapters/interop/edxl-rm-mapper.js';
import { sitRepToEdxlSitRep } from '@/adapters/interop/edxl-sitrep-mapper.js';
import type { SitRepOptions } from '@/adapters/interop/edxl-sitrep-mapper.js';
import { asEmittable } from '@/adapters/alerting/alert-sink.js';
import type { AlertSink } from '@/adapters/alerting/alert-sink.js';
import { statusForError } from '../error-mapping.js';
import { alertHeadlineFor } from '../../messaging/digest-i18n.js';

// ── Transport-neutral result + store seams (self-contained; the root wires real repos) ─────────

/** A transport-neutral response: an HTTP status + an Envelope body (identical shape on every channel). */
export interface InteropHttpResult {
  readonly status: number;
  readonly body: Envelope;
}

/** Alert persistence seam — list the DRAFT queue, load a DRAFT to approve, persist the promoted ACTUAL. */
export interface AlertStore {
  list(): Promise<readonly Alert[]>;
  get(id: AlertId): Promise<Alert | null>;
  save(alert: Alert): Promise<void>;
}

/** EDXL-RM correlation store — persists the canonical task under its round-trip correlation id. */
export interface EdxlRmStore {
  get(id: string): Promise<ResourceTask | null>;
  save(id: string, task: ResourceTask): Promise<void>;
}

/** Everything the interop handlers need — all behind seams so the root injects real adapters, tests fakes. */
export interface InteropDeps {
  readonly clock: () => string; // injected — never a wall-clock read in a handler (deterministic tests)
  readonly alerts: AlertStore;
  readonly edxlRm: EdxlRmStore;
  readonly sink: AlertSink;
  /**
   * Optional HITL alert broadcast (Art. XIII/XIV). When BOTH are wired (Telegram live composition), an
   * approved+emitted ACTUAL alert is fanned out to `subscribers` via the `notifier` — the EXISTING
   * NotificationPort (PII-redact + output-firewall + hash-chained audit), NEVER a raw transport. Absent
   * (the offline default), handleAlertApprove is byte-identical to before: NO broadcast, no behavior change.
   */
  readonly notifier?: NotificationPort;
  readonly subscribers?: SubscriberRegistry;
  /**
   * The NAME of the channel `notifier` fans out on, for the per-channel delivery tally (FR-WARN-2 / V5).
   * A name, not a transport handle: the tally must be attributable to a channel without the handler knowing
   * anything about the transport. Defaults to `DEFAULT_BROADCAST_CHANNEL` when a notifier is wired.
   */
  readonly broadcastChannel?: string;
  /**
   * Mint the identifier of a follow-up (Update / Cancel / all-clear) alert (D3.2). A follow-up is a NEW CAP
   * message — CAP requires a distinct `<identifier>` and the original's identifier in `<references>` — so
   * the handler cannot reuse the original's id. Injected because a handler never reads a clock or a
   * random source itself (deterministic tests). Defaults to `all-clear-of-<originalId>`, which is stable,
   * unique per original, and self-describing in an audit trail.
   */
  readonly newAlertId?: (original: AlertId) => AlertId;
}

// ── Request shapes (parsed + authenticated by the transport BEFORE the handler) ────────────────

export interface ApproveAlertRequest {
  readonly alertId: AlertId;
  readonly actorRole: AppUserRole;
  readonly approvedBy: AppUserId; // the human approver recorded on the ACTUAL alert (Art. XIII)
  /** The approver's UI locale (optional). Drives the BILINGUAL broadcast headline — localized + English.
   *  Coerced through the locale allowlist downstream; absent ⇒ English-only, exactly the old behaviour. */
  readonly lang?: string;
}
export interface AllClearRequest {
  /** The already-emitted ACTUAL alert being cleared — becomes the new message's CAP `<references>`. */
  readonly alertId: AlertId;
  readonly actorRole: AppUserRole;
  /** Optional operator wording. Absent ⇒ the emitted document carries the original's text unchanged. */
  readonly headline?: string;
  readonly description?: string;
  readonly instruction?: string;
}
export interface EdxlRmPostRequest {
  readonly actorRole: AppUserRole;
  readonly message: EdxlRmMessage;
}
export interface EdxlRmGetRequest {
  readonly actorRole: AppUserRole;
  readonly id: string; // the OriginatingMessageID / correlation id
}
export interface EdxlSitrepPostRequest {
  readonly actorRole: AppUserRole;
  readonly sitrep: SitRep;
  readonly options?: SitRepOptions;
}

// ── Shared helpers ─────────────────────────────────────────────────────────────────────────────

/**
 * Default follow-up identifier: derived from the original's, so the relationship is legible in an audit
 * trail and the id is stable (re-authoring an all-clear for the same alert does not mint a second draft).
 * CAP requires only that `<identifier>` be unique for the sender and carry no whitespace/`,<&'`.
 */
function defaultFollowUpId(original: AlertId): AlertId {
  return `all-clear-of-${original}` as AlertId;
}

/** RBAC gate by rank (identical to the command-router MIN_ROLE policy, Art. XIII). */
function requireRole(actor: AppUserRole, min: AppUserRole): DomainError | null {
  return roleRank(actor) < roleRank(min) ? new Unauthorized(`requires ${min}, actor is ${actor}`) : null;
}

/** Render a typed failure as { status, body } — reuses errorEnvelope; maps the DomainError code to a status. */
function fail(error: DomainError): InteropHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

/** The interop sink's provenance: a MOCK boundary source (no real external send — honest labeling, F1). */
function interopProvenance(at: string): readonly SourceRef[] {
  return [{ sourceId: 'beacon-interop', mode: 'MOCK', fetchedAt: at }];
}

/** Assemble the universal Envelope (non-empty provenance + freshness, F1/F2). */
function envelope<T>(
  data: T,
  provenance: readonly SourceRef[],
  opts: { readonly citations?: readonly CitationView[]; readonly meta?: Readonly<Record<string, unknown>> } = {},
): Envelope<T> {
  const first = provenance[0];
  return {
    data,
    provenance,
    ...(first ? { freshness: first.fetchedAt } : {}),
    ...(opts.citations ? { citations: opts.citations } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
  };
}

// ── Handlers ─────────────────────────────────────────────────────────────────────────────────

/**
 * A concise, PII-free broadcast headline for an approved+emitted ACTUAL alert (the NotificationPort
 * redacts too). BILINGUAL when the approver's UI locale is not English: the localized line FIRST (the
 * audience the operator chose to address), then the English line (the lingua-franca copy every
 * responder can read) — both from catalog ICU templates, never an LLM (Art. XII: enum tokens and ids
 * are engine facts and stay verbatim inside both lines).
 */
async function alertDigest(alert: Alert, lang: string | undefined): Promise<string> {
  const params = {
    severity: alert.severity,
    category: alert.category,
    incidentId: String(alert.incidentId),
    alertId: String(alert.id),
  };
  const english = await alertHeadlineFor(undefined, params);
  const localized = await alertHeadlineFor(lang, params);
  return localized === english ? english : `${localized}\n${english}`;
}

/** The channel name used for the delivery tally when the composition does not name one explicitly. */
export const DEFAULT_BROADCAST_CHANNEL = 'telegram';

/**
 * Per-channel DISSEMINATION feedback for one broadcast (FR-WARN-2 / FEV-16; ADR-036 §2).
 *
 * COUNTS PER CHANNEL, NEVER PER RECIPIENT (Art. XIV, ADR-026 §1). There is deliberately no recipient list,
 * no id, no per-destination status and no field that could carry one: the shape itself is the privacy
 * guarantee, so no reviewer has to trust that a redaction step ran. `attempted` is the number of
 * destinations the channel was asked to reach — the registry holds opaque chat ids only, and its LENGTH is
 * the only thing read here.
 *
 * HONEST SCOPE: `delivered` means THE CHANNEL ACCEPTED the message for that many destinations. It is not a
 * receipt, not a read confirmation, and not proof a person saw anything. That is the whole of what a
 * dissemination path can honestly report, and the WMO-checklist gap it closes ("verify warnings reached
 * people") is closed only to that depth.
 */
export interface ChannelDeliveryTally {
  readonly channel: string;
  readonly attempted: number;
  readonly delivered: number;
  readonly failed: number;
}

/**
 * HITL broadcast side-effect (Art. XIII): fan the approved+emitted alert out to every subscribed chat id
 * via the NotificationPort (PII-redact + firewall + audit are structural). AUDITED-NOT-FATAL: any per-send
 * failure (typed err or a thrown transport) is swallowed here — a broadcast problem must NEVER 5xx the
 * approval response nor block the other subscribers. No-op unless BOTH notifier + subscribers are wired.
 *
 * CHANGE (D3.3, finding F-30): the loop no longer DISCARDS its results. `notify` already returned a typed
 * `Result<void>`; every one of them was thrown away, so no delivery count existed anywhere in the system.
 * They are now tallied — which needed no port signature change, no new dependency and no new stored data.
 * Returns one tally per channel (today exactly one channel is wireable), or `[]` when no broadcast is wired.
 */
async function broadcastApproval(
  deps: InteropDeps,
  alert: Alert,
  at: string,
  lang?: string,
): Promise<readonly ChannelDeliveryTally[]> {
  const { notifier, subscribers } = deps;
  if (notifier === undefined || subscribers === undefined) return [];
  const digest = envelope({ headline: await alertDigest(alert, lang) }, interopProvenance(at));
  const audience = subscribers.list();
  let delivered = 0;
  for (const chatId of audience) {
    try {
      const sent = await notifier.notify(chatId, digest); // audits the intent BEFORE send (tamper-evident)
      if (sent.ok) delivered += 1;
    } catch {
      // audited-not-fatal (Art. XVI): never let a broadcast side-effect break the approval response.
    }
  }
  return [
    {
      channel: deps.broadcastChannel ?? DEFAULT_BROADCAST_CHANNEL,
      attempted: audience.length,
      delivered,
      failed: audience.length - delivered,
    },
  ];
}

/**
 * POST /alerts/:id/approve — the HITL emit gate (Art. XIII). Loads a DRAFT alert, requires VERIFIER+,
 * promotes DRAFT → ACTUAL with approvedBy = the actor, emits the approved alert via the AlertSink (CAP
 * serialized + schema-validated + audited), and returns the CAP. REJECTS a non-DRAFT (409), an
 * unauthorized actor (403), or a missing alert (404) — a DRAFT or unverified alert never reaches emit.
 */
export async function handleAlertApprove(
  req: ApproveAlertRequest,
  deps: InteropDeps,
): Promise<InteropHttpResult> {
  const denied = requireRole(req.actorRole, 'VERIFIER');
  if (denied) return fail(denied);

  const existing = await deps.alerts.get(req.alertId);
  if (existing === null) return fail(new DomainError('NOT_FOUND', `alert not found: ${req.alertId}`));
  if (existing.capStatus !== 'DRAFT') {
    return fail(new DomainError('CONFLICT', `alert ${req.alertId} is not DRAFT (was ${existing.capStatus})`));
  }

  const approved = approveAlert(existing, req.approvedBy); // DRAFT → ACTUAL (throws if not DRAFT; guarded above)
  const emittable = asEmittable(approved);
  if (emittable === null) return fail(new DomainError('CONFLICT', 'approved alert is not emittable (Art. XIII)'));

  const emitted = await deps.sink.emit(emittable);
  if (!emitted.ok) return fail(emitted.error);
  await deps.alerts.save(approved);

  // HITL broadcast (Art. XIII): STRICTLY a downstream side-effect of a successfully-emitted approved ACTUAL —
  // never an alternate emit path. Audited-not-fatal; the 201 below is returned regardless of broadcast outcome.
  const provenance = interopProvenance(deps.clock());
  const delivery = await broadcastApproval(deps, approved, provenance[0]?.fetchedAt ?? deps.clock(), req.lang);

  const record = deps.sink.emissions.at(-1);
  return {
    status: 201, // SPEC §2.2/§2.3 — POST /alerts created an emission
    body: envelope({ alert: approved, cap: record?.cap }, provenance, {
      meta: approvalMeta(record?.auditHash, delivery),
    }),
  };
}

/**
 * The approval response's `meta`. `delivery` is OMITTED ENTIRELY when no channel is wired — an empty array
 * would read as "we tried and reached nobody", which is a different (and false) claim from "no channel is
 * configured". Silence about dissemination is the honest answer when nothing was disseminated.
 */
function approvalMeta(
  auditHash: string | undefined,
  delivery: readonly ChannelDeliveryTally[],
): Readonly<Record<string, unknown>> {
  return {
    emitted: true,
    sink: 'MOCK',
    auditHash,
    ...(delivery.length > 0 ? { delivery } : {}),
  };
}

/**
 * POST /alerts/:id/all-clear — author the first-class ALL-CLEAR for an emitted alert (FR-WARN-2, ADR-036 §2).
 *
 * This handler creates a **DRAFT**, and that is the whole point (Art. XIII). An all-clear is a PUBLIC
 * message: telling people a hazard is over can send them back into it, so it is exactly as consequential as
 * the warning was and travels the SAME path — this route authors it, `POST /alerts/:id/approve` above is
 * still the only thing that can promote it to ACTUAL and emit it. There is no shortcut and no second emit
 * path; the type system enforces it (`buildAllClear` returns `DraftAlert`, which is not an `EmittableAlert`).
 *
 * The reference to the original cannot be forgotten: `buildAllClear` derives `references` from the original's
 * identifier, and both the domain factory and the CAP schema reject a reference-less CANCEL.
 * VERIFIER+ (same rank as approval — authoring a public draft is not a responder action).
 */
export async function handleAlertAllClear(
  req: AllClearRequest,
  deps: InteropDeps,
): Promise<InteropHttpResult> {
  const denied = requireRole(req.actorRole, 'VERIFIER');
  if (denied) return fail(denied);

  const original = await deps.alerts.get(req.alertId);
  if (original === null) return fail(new DomainError('NOT_FOUND', `alert not found: ${req.alertId}`));
  if (original.capStatus !== 'ACTUAL') {
    return fail(
      new DomainError(
        'CONFLICT',
        `alert ${req.alertId} was never made public (cap_status=${original.capStatus}) — there is nothing to clear`,
      ),
    );
  }

  const draft = buildAllClear({
    id: (deps.newAlertId ?? defaultFollowUpId)(req.alertId),
    original,
    ...(req.headline !== undefined ? { headline: req.headline } : {}),
    ...(req.description !== undefined ? { description: req.description } : {}),
    ...(req.instruction !== undefined ? { instruction: req.instruction } : {}),
  });
  await deps.alerts.save(draft);

  return {
    status: 201,
    body: envelope({ alert: draft }, interopProvenance(deps.clock()), {
      meta: {
        // Spelled out in the response because a caller must not have to infer it: nothing has been sent.
        emitted: false,
        requiresApproval: true,
        references: [...(draft.references ?? [])],
      },
    }),
  };
}

/**
 * POST /edxl/rm — import an EDXL-RM mutual-aid message: parse it into a canonical ResourceTask via the
 * mapper (anti-corruption inbound), persist it under its correlation id, and echo the re-serialized
 * message (round-trip proof). RESPONDER/EM (SPEC §2.2). A malformed/unmappable message → typed 400.
 */
export async function handleEdxlRmPost(
  req: EdxlRmPostRequest,
  deps: InteropDeps,
): Promise<InteropHttpResult> {
  const denied = requireRole(req.actorRole, 'RESPONDER');
  if (denied) return fail(denied);

  const parsed = edxlRmToResourceTask(req.message);
  if (!parsed.ok) return fail(parsed.error);
  const task = parsed.value;
  const correlationId = task.edxlRmRef ?? task.id;
  await deps.edxlRm.save(correlationId, task);

  const echo = resourceTaskToEdxlRm(task, { sentDateTime: req.message.sentDateTime });
  if (!echo.ok) return fail(echo.error);
  const provenance = interopProvenance(deps.clock());
  return {
    status: 201,
    body: envelope({ task, edxlRm: echo.value }, provenance, { meta: { correlationId } }),
  };
}

/**
 * GET /edxl/rm/:id — export a stored canonical task as a schema-valid EDXL-RM message (round-trip). Returns
 * the canonical task + the serialized message. RESPONDER/EM (SPEC §2.2). Unknown id → 404.
 */
export async function handleEdxlRmGet(
  req: EdxlRmGetRequest,
  deps: InteropDeps,
): Promise<InteropHttpResult> {
  const denied = requireRole(req.actorRole, 'RESPONDER');
  if (denied) return fail(denied);

  const task = await deps.edxlRm.get(req.id);
  if (task === null) return fail(new DomainError('NOT_FOUND', `EDXL-RM message not found: ${req.id}`));

  const serialized = resourceTaskToEdxlRm(task, { sentDateTime: deps.clock() });
  if (!serialized.ok) return fail(serialized.error);
  const provenance = interopProvenance(deps.clock());
  return { status: 200, body: envelope({ task, edxlRm: serialized.value }, provenance) };
}

/**
 * POST /edxl/sitrep — emit an EDXL-SitRep from a cited SitRep: serialize + schema-validate the document and
 * preserve its field-level citations[] across the boundary (grounding is structural, Art. XI/XII).
 * VERIFIER/EM (SPEC §2.2). A malformed document / ungrounded citation → typed 400.
 */
export async function handleEdxlSitrepPost(
  req: EdxlSitrepPostRequest,
  deps: InteropDeps,
): Promise<InteropHttpResult> {
  const denied = requireRole(req.actorRole, 'VERIFIER');
  if (denied) return fail(denied);

  const res = sitRepToEdxlSitRep(req.sitrep, req.options ?? {});
  if (!res.ok) return fail(res.error);
  const citations: readonly CitationView[] = res.value.citations.map((c) => ({
    field: c.field,
    sourceId: c.sourceId,
  }));
  const provenance = interopProvenance(deps.clock());
  return {
    status: 201,
    body: envelope({ sitrep: res.value.sitrep }, provenance, { citations }),
  };
}

// ── In-memory store impls (self-contained defaults; the root may swap for repo-backed stores) ──

/** In-memory AlertStore seeded with DRAFT alerts (deterministic; no DB). */
export function makeInMemoryAlertStore(seed: readonly Alert[] = []): AlertStore {
  const byId = new Map<string, Alert>(seed.map((a) => [a.id, a]));
  return {
    list: () => Promise.resolve([...byId.values()]),
    get: (id) => Promise.resolve(byId.get(id) ?? null),
    save: (alert) => {
      byId.set(alert.id, alert);
      return Promise.resolve();
    },
  };
}

/** In-memory EDXL-RM correlation store (deterministic; no DB). */
export function makeInMemoryEdxlRmStore(): EdxlRmStore {
  const byId = new Map<string, ResourceTask>();
  return {
    get: (id) => Promise.resolve(byId.get(id) ?? null),
    save: (id, task) => {
      byId.set(id, task);
      return Promise.resolve();
    },
  };
}
