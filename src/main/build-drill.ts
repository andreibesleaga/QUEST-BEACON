// BEACON — DRILL composition root (MW-D/D4; ADR-034 §7 Layer 2, FR-GOV-3 / FOP-4 / FUW-7).
//
// LAYER 2 OF THE THREE-LAYER DRILL GUARANTEE: a COMPOSITION-LEVEL PARTITION, not a runtime `if`.
// A drill run is assembled here, and this function **never calls `makeBroadcastDeps`**
// (`src/main/feature-seed.ts:158`) — the notifier/subscriber pair and every messaging transport are absent
// BY CONSTRUCTION, so there is no flag to mis-set and no falsy branch to get wrong. The exercise artifact
// goes to `makeDrillRecorder`, which appends to the governance ledger and performs no I/O whatsoever.
//
// The partition is machine-enforced, twice:
//   • `.dependency-cruiser.cjs` rule `drill-never-reaches-a-live-channel` (error severity) fails the
//     `boundaries` gate if anything in the drill subgraph ever imports `src/adapters/channels/messaging/**`;
//   • `tests/architecture/drill-isolation.test.ts` asserts on the resolved MODULE GRAPH from THIS file that
//     the reachable set contains zero `channels/messaging` modules, and runs a full episode with a throwing
//     `fetch` spy to prove that even an accidental live call would fail loudly instead of silently working.
//
// Deliberately NOT imported here, and each omission is the mechanism rather than an oversight:
//   `@/main/feature-seed.js` · `@/adapters/channels/**` · `@/adapters/alerting/**` · `@/ports/logistics.js`.
// Layer 1 covers the remaining direction: a `DrillAlert` carries `capStatus: 'EXERCISE'`, which is not
// assignable to `EmittableAlert`'s `'ACTUAL'` literal, so `AlertSinkPort.emit(exercise)` does not compile
// even if a future edit did wire a sink in here.
import type { DrillMode } from '@/domain/drill.js';
import { DRILL_MODES } from '@/domain/drill.js';
import type { SopChainConfig } from '@/domain/governance.js';
import type { AuditSink } from '@/adapters/compliance/audit-chain.js';
import type { GovernanceLedger } from '@/adapters/governance/ledger.js';
import { makeGovernanceLedger } from '@/adapters/governance/ledger.js';
import type { DrillRecorder } from '@/adapters/governance/drill-recorder.js';
import { makeDrillRecorder } from '@/adapters/governance/drill-recorder.js';
import type { GovernanceConfig } from '@/application/governance/governance-config.js';
import { DEFAULT_GOVERNANCE_CONFIG } from '@/application/governance/governance-config.js';
import type {
  DrillEpisodeInput,
  DrillEpisodeResult,
} from '@/application/governance/drill-episode.js';
import { runDrillEpisode } from '@/application/governance/drill-episode.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';

export interface BuildDrillDepsOptions {
  /** Injected clock — a drill is replayable, so every governance instant comes from here (Art. XII). */
  readonly clock: () => string;
  /** Raw env for the mode read; defaults to `process.env`. The SERVER value is authoritative. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Share the live chain so exercise records and real emissions are ONE verifiable sequence (ADR-034 §5).
   * Sharing the LEDGER is safe precisely because the exercise cannot reach a channel: what is shared is the
   * audit writer, never a transport.
   */
  readonly audit?: AuditSink;
  readonly governance?: GovernanceConfig;
}

export interface DrillDeps {
  readonly mode: DrillMode;
  readonly clock: () => string;
  readonly ledger: GovernanceLedger;
  readonly recorder: DrillRecorder;
  readonly sopChain: SopChainConfig;
  /** Run one exercise episode against this composition. The only thing a drill run can do. */
  readonly episode: (input: DrillEpisodeInput) => Result<DrillEpisodeResult, DomainError>;
}

/**
 * The effective exercise mode. The SERVER variable `DRILL_MODE` is authoritative; `NEXT_PUBLIC_DRILL_MODE`
 * is the browser banner's mirror and is never consulted here (`loadConfig` refuses to boot if the two
 * disagree, `src/config/index.ts`). An unrecognised value degrades to `off` — failing safe means NOT being
 * in drill mode is never the surprising outcome, and `loadConfig` has already rejected a bad value at boot.
 */
export function resolveDrillMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DrillMode {
  const raw = env.DRILL_MODE;
  return (DRILL_MODES as readonly string[]).includes(raw ?? '') ? (raw as DrillMode) : 'off';
}

/**
 * Compose an exercise run: a governance ledger, a drill recorder over it, the SOP chain parameters, and an
 * `episode` entry point. No channel, no notifier, no subscriber registry, no alert sink — see the header.
 */
export function buildDrillDeps(options: BuildDrillDepsOptions): DrillDeps {
  const governance = options.governance ?? DEFAULT_GOVERNANCE_CONFIG;
  const ledger = makeGovernanceLedger(options.audit !== undefined ? { audit: options.audit } : {});
  const recorder = makeDrillRecorder({ ledger });
  const deps = { ledger, recorder, clock: options.clock, sopChain: governance.approval };
  return {
    mode: resolveDrillMode(options.env ?? process.env),
    clock: options.clock,
    ledger,
    recorder,
    sopChain: governance.approval,
    episode: (input: DrillEpisodeInput) => runDrillEpisode(deps, input),
  };
}
