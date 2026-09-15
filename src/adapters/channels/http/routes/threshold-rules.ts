// BEACON — threshold-rule listing HTTP handler (E7·routes; SPEC §2.2, ADR-014, CLARIFICATIONS §B.Q6, F1).
// The configuration read openapi.yaml declared and nothing served (UNIMPLEMENTED_REGISTER row 17):
// GET /threshold-rules.
//
// It lists the rules the running app ACTUALLY evaluates — the observed rules plus the forecast rules the
// composition root feeds to `deriveDraftAlerts` (src/main/feature-seed.ts) — not a parallel description of
// them. That distinction is the whole point of the row it closes: a route that answered from its own copy
// of the rule set would be a second declaration free to drift from the one that fires alerts.
//
// EM-only, per the RBAC matrix (CLARIFICATIONS §B.Q6 "Configure threshold rules / regions / adapters" — EM;
// SPEC §2.2 and openapi.yaml both already stated EM for this path). Firing a rule creates a DRAFT alert and
// nothing else (Art. XIII); this endpoint only READS, and has no mutation counterpart in v1.
import type { AppUserRole } from '@/domain/app-user.js';
import { roleRank } from '@/domain/app-user.js';
import type { DomainError } from '@/domain/errors.js';
import { Unauthorized } from '@/domain/errors.js';
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import type { Envelope, SourceRef } from '@/ports/interaction.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { statusForError } from '../error-mapping.js';

/** The transport-neutral result this handler returns (mirrors HttpResponse's {status, body}). */
export interface ThresholdRulesHttpResult {
  readonly status: number;
  readonly body: Envelope | Envelope<null>;
}

export interface ThresholdRulesData {
  readonly rules: readonly ThresholdRule[];
  readonly count: number;
}

export interface ThresholdRulesRequest {
  readonly role: AppUserRole;
}

export interface ThresholdRulesDeps {
  /** The rules the composition root actually evaluates. Absent/empty ⇒ this deployment configures none. */
  readonly rules: readonly ThresholdRule[];
  readonly clock: () => string;
}

function fail(error: DomainError): ThresholdRulesHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

/**
 * GET /threshold-rules — the configured early-warning rules (FR-11). EM only.
 *
 * Provenance names the CONFIGURATION, not a feed: these rules come from the deployment's own threshold
 * configuration, so attributing them to an upstream source would misreport where they came from. `mode:
 * 'LIVE'` is literal (the real configured rules, never a recorded mock) and `fetchedAt` is the injected
 * clock — the same posture `handleRegions` takes for the region registry.
 */
export function handleThresholdRules(
  req: ThresholdRulesRequest,
  deps: ThresholdRulesDeps,
): Promise<ThresholdRulesHttpResult> {
  if (roleRank(req.role) < roleRank('EM')) {
    return Promise.resolve(
      fail(new Unauthorized(`GET /threshold-rules requires EM, actor is ${req.role}`)),
    );
  }
  const fetchedAt = deps.clock();
  const provenance: readonly SourceRef[] = [
    { sourceId: 'threshold-rule-config', mode: 'LIVE', fetchedAt },
  ];
  const data: ThresholdRulesData = { rules: deps.rules, count: deps.rules.length };
  return Promise.resolve({ status: 200, body: { data, provenance, freshness: fetchedAt } });
}
