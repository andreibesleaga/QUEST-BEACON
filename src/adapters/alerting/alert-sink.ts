// BEACON — AlertSink adapter (E1·T-089 P10; ADR-010, Art. XIII). The DRIVEN outbound interop sink that
// implements AlertSinkPort.emit. It accepts ONLY an approved ACTUAL alert (EmittableAlert — capStatus
// 'ACTUAL' + approvedBy enforced at the type level), serializes it to a CAP v1.2 document via the EXISTING
// interop mapper (validate-before-emit: the mapper Ajv-validates against schemas/cap-v1.2.schema.json),
// appends the emission to a hash-chained, append-only in-memory audit log (reusing the compliance
// AuditChain), and records the emission. This is a MOCK sink — it performs NO real external network send;
// a live IPAWS/broker origination is a documented FUTURE stub (IPAWS_ENABLED=off, CAP_EMIT_MODE=draft;
// ADR-010, §C C6) — BEACON produces + validates CAP, it does not originate to IPAWS (Art. XIII).
import type { Alert, DraftAlert, EdxlKind } from '@/domain/alert.js';
import type { AlertSinkPort, EmittableAlert } from '@/ports/logistics.js';
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { alertToCap } from '@/adapters/interop/cap-mapper.js';
import type { CapAlert, CapMessageRef, CapOptions } from '@/adapters/interop/cap-mapper.js';
import { DEFAULT_CAP_PROFILE } from '@/adapters/interop/cap-profile.js';
import type { CapProfileId } from '@/adapters/interop/cap-profile.js';
import { makeAuditChain } from '@/adapters/compliance/audit-chain.js';
import type { AuditSink } from '@/adapters/compliance/audit-chain.js';

/** A recorded outbound emission: the schema-valid CAP document + its tamper-evident audit-chain link. */
export interface EmissionRecord {
  readonly alertId: string;
  readonly edxlKind: EdxlKind;
  readonly cap: CapAlert;
  readonly emittedAt: string; // ISO-8601 UTC — the CAP <sent> instant (from the injected clock)
  readonly auditHash: string; // the append-only chain link committing this emission (THREAT §9)
  readonly sink: 'MOCK'; // honest labeling — no real external send happened (Art. XVI)
}

/**
 * The AlertSink: AlertSinkPort plus read-only inspection surface (the recorded emissions + the audit
 * chain). `emit` conforms EXACTLY to the port (Result<void>); the CAP document is read back from
 * `emissions` by the caller (the HTTP handler returns it). Keeps the port signature intact.
 */
export interface AlertSink extends AlertSinkPort {
  readonly emissions: readonly EmissionRecord[];
  readonly audit: AuditSink;
  /** Verify the whole append-only emission chain is intact (fail-closed on any tamper). */
  verify(): boolean;
}

export interface AlertSinkDeps {
  /** Injected clock (ISO-8601 now) — the one source of the CAP <sent> instant when the alert has none. */
  readonly clock: () => string;
  /** Default CAP options (sender/scope/event/language …) applied to every emission (12-factor config). */
  readonly capOptions?: CapOptions;
  /**
   * PER-ALERT CAP options, merged OVER `capOptions` (finding F-53 — the structural half).
   *
   * `capOptions` is a single GLOBAL object, but the two things ADR-036 needs at emit time are per-alert:
   *   • the LANGUAGES of the emitted `<info>` blocks, which follow the alert's REGION
   *     (region.languages → regionAlertLocales → capTranslationsFor → CapOptions.translations), and
   *   • the `references` triplets of an Update/Cancel, which name that specific original message.
   * A constant cannot express either, which is why `capTranslationsFor()` had no production caller at all:
   * the seam it needed did not exist. This is that seam. Absent ⇒ byte-identical to the previous behaviour.
   */
  readonly capOptionsFor?: (alert: Alert) => CapOptions;
  /**
   * The CAP profile rule set every emission must ALSO satisfy (`CAP_PROFILE`; ADR-036 §1, ADR-012).
   * Defaults to `base` — CAP v1.2 and nothing more. A profile failure BLOCKS the emission.
   */
  readonly capProfile?: CapProfileId;
  /** Share an existing audit chain (e.g. the compliance chain) — defaults to a fresh in-memory chain. */
  readonly audit?: AuditSink;
}

/**
 * Type-safe narrowing of an Alert to an EmittableAlert (ACTUAL + approver). Returns null when the alert is
 * not emittable — the caller maps that to a CONFLICT (Art. XIII, defense in depth over the compile-time type).
 *
 * The first overload closes the one remaining hole in the type-level guarantee: `DraftAlert` (what a
 * threshold-rule fire produces, `buildDraftAlert`) is already unassignable to `EmittableAlert`, so
 * `sink.emit(draft)` will not compile — but a caller could still have TRIED to launder it through this
 * narrowing and then `if (e !== null)`. Typed as returning `null`, that laundering is dead code the compiler
 * itself rejects: there is no branch in which a DRAFT becomes emittable (Art. XIII).
 */
export function asEmittable(alert: DraftAlert): null;
export function asEmittable(alert: Alert): EmittableAlert | null;
export function asEmittable(alert: Alert): EmittableAlert | null {
  return alert.capStatus === 'ACTUAL' && alert.approvedBy !== undefined
    ? (alert as EmittableAlert)
    : null;
}

/** Build the MOCK AlertSink. The composition root injects the clock (+ optional shared audit chain). */
export function makeAlertSink(deps: AlertSinkDeps): AlertSink {
  const audit = deps.audit ?? makeAuditChain();
  const emissions: EmissionRecord[] = [];

  /**
   * Resolve the CAP `sender,identifier,sent` triplets an Update/Cancel needs (D3.2) from THIS SINK'S OWN
   * emission log.
   *
   * CAP identifies a referenced message by triplet, so a Cancel needs the ORIGINAL's `<sent>` instant. That
   * instant is not on the persisted `Alert` at all — `approveAlert` does not stamp one; the emission is
   * where it is decided (`emittedAt` below). So the emission log is not a convenient cache here, it is the
   * only authoritative source, and it is exactly the right one: CAP `<references>` refers to *the sender's
   * own prior messages*, which is precisely what this array contains.
   *
   * A reference this sink never emitted resolves to NOTHING — and then `alertToCap` blocks the emission with
   * an actionable error. That is the correct outcome: BEACON must not claim to cancel a message it cannot
   * show it ever sent. (Consequence, stated rather than hidden: this in-memory MOCK sink cannot cancel
   * across a process restart. A durable sink overrides the triplets via `capOptionsFor`.)
   */
  function referencesFor(alert: Alert): readonly CapMessageRef[] {
    const refs: CapMessageRef[] = [];
    for (const id of alert.references ?? []) {
      const original = emissions.find((e) => e.alertId === String(id));
      if (original) refs.push({ identifier: original.cap.identifier, sent: original.cap.sent });
    }
    return refs;
  }

  async function emit(alert: EmittableAlert): Promise<Result<void, DomainError>> {
    // FAIL-CLOSED re-check of the type-level guarantee (Art. XIII). The compiler already makes a DRAFT
    // unpassable here, but `alertToCap` deliberately maps a DRAFT to a valid `status: Draft` CAP document
    // (ADR-010 — DRAFT alerts are CAP-shaped for preview/approval), so it is NOT a second gate: without this
    // line a cast, a DB read narrowed at a boundary, or a JS caller would get a DRAFT recorded as a real
    // emission. Emission is the one irreversible step in the pipeline, so it re-verifies rather than trusts.
    if (asEmittable(alert as Alert) === null) {
      return err(
        new DomainError(
          'CONFLICT',
          `Alert ${alert.id} is not emittable: cap_status must be ACTUAL with an approver (Art. XIII)`,
        ),
      );
    }
    // The CAP <sent> instant: the alert's own sentAt, else the injected clock (never a wall-clock read here).
    const emittedAt = alert.sentAt ?? deps.clock();
    // Serialize + Ajv-validate via the existing interop mapper (validate-before-emit, ADR-010). A malformed
    // document or an ACTUAL-without-approver never leaks: the mapper returns a typed PARSE_ERROR/CONFLICT.
    // Global config options, then the PER-ALERT (region-aware) options over the top, then the emission
    // instant. The blocking gate chain inside alertToCap now also runs the selected CAP_PROFILE rule set
    // (ADR-036 §1): a profile failure returns a typed PARSE_ERROR here and NOTHING is audited or recorded.
    const resolvedRefs = referencesFor(alert);
    const capRes = alertToCap(alert, {
      ...deps.capOptions,
      ...(resolvedRefs.length > 0 ? { references: resolvedRefs } : {}),
      ...deps.capOptionsFor?.(alert),
      profile: deps.capProfile ?? DEFAULT_CAP_PROFILE,
      sent: emittedAt,
    });
    if (!capRes.ok) return capRes;
    // Append-only, hash-chained audit BEFORE recording the emission (tamper-evident, THREAT §9).
    const event = audit.append({
      action: 'ALERT_EMIT',
      target: `alert:${alert.id}`,
      actorId: alert.approvedBy,
      at: emittedAt,
    });
    emissions.push({
      alertId: alert.id,
      edxlKind: alert.edxlKind,
      cap: capRes.value,
      emittedAt,
      auditHash: event.hash,
      sink: 'MOCK',
    });
    // MOCK sink — NO external network send. A live IPAWS/broker origination is a FUTURE stub that would go
    // here behind IPAWS_ENABLED (ADR-010, §C C6): produce + validate is done; origination is out of scope.
    return ok(undefined);
  }

  return {
    emit,
    get emissions(): readonly EmissionRecord[] {
      return emissions;
    },
    audit,
    verify: () => audit.verify(),
  };
}
