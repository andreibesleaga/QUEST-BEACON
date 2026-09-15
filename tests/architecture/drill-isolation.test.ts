// BEACON — DRILL ISOLATION, structurally (MW-D/D4; ADR-034 §7 Layer 3, FR-GOV-3 / FUW-7,
// acceptance test 4 in docs/requirements/EARS_FINAL_VERSION.md).
//
// FUW-7 is explicit that convention is not acceptable: enforcement must be structural (type-level or
// composition-level), not a runtime `if` a future edit can invert. This file is the executable proof of all
// three layers, and NONE of the three is a behavioural assertion about one input:
//
//   Layer 1 (TYPE)        — `sink.emit(exercise)` does not compile. Pinned below by a `@ts-expect-error`,
//                           which Gate 2 (`tsc --noEmit`) enforces in BOTH directions: if the emit gate ever
//                           stopped rejecting an exercise, tsc fails with "Unused '@ts-expect-error'".
//                           The runtime half of the same guard (`asEmittable` → null, and `emit`'s
//                           fail-closed re-check, the F-79 fix) is asserted too — REUSED, never duplicated.
//   Layer 2 (COMPOSITION) — the resolved MODULE GRAPH from `src/main/build-drill.ts` contains zero modules
//                           under `src/adapters/channels/messaging/`. This is about the import graph, not
//                           about behaviour under one input, which is what makes it structural.
//   Layer 3 (EGRESS)      — a full drill episode runs with `globalThis.fetch` replaced by a spy that THROWS.
//                           An accidental live call would therefore fail loudly rather than silently
//                           succeed, and the assertion is that the spy was never called AND the episode
//                           completed.
//
// Deterministic and offline: the module graph is computed by the same `depcruise` binary and the same gate
// config the build uses; no network is contacted (the fetch spy proves it).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { makeDrillAlert } from '@/domain/drill.js';
import { asEmittable, makeAlertSink } from '@/adapters/alerting/alert-sink.js';
import type { Alert } from '@/domain/alert.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import { buildDrillDeps } from '@/main/build-drill.js';

const T0 = '2026-07-05T22:00:00.000Z';
const em = asId<AppUserId>('u-em-1');
const exercise = makeDrillAlert({
  id: asId<AlertId>('al-drill-1'),
  incidentId: asId<IncidentId>('inc-ro-1'),
  category: 'Met',
  severity: 'SEVERE',
  at: T0,
});

// ── Layer 1 — the type gate, and the runtime guard it is paired with ─────────────────────────────────
describe('Layer 1 — an EXERCISE artifact cannot be emitted', () => {
  it('does not COMPILE: capStatus "EXERCISE" is not assignable to EmittableAlert\'s "ACTUAL" literal', async () => {
    const sink = makeAlertSink({ clock: () => T0 });
    // @ts-expect-error — THE GUARANTEE. Gate 2 fails if this line ever starts type-checking.
    const attempt = sink.emit(exercise);
    // It is also refused at runtime, by the EXISTING HITL guard rather than a parallel one: `emit`
    // re-checks `asEmittable` before any serialization or audit append (alert-sink.ts:79, the F-79 fix).
    const res = await attempt;
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('CONFLICT');
    // Nothing was serialized and nothing was recorded — the refusal precedes both.
    expect(sink.emissions).toHaveLength(0);
    expect(sink.audit.events).toHaveLength(0);
  });

  it('is refused by `asEmittable`, the same narrowing the real approval path uses', () => {
    expect(asEmittable(exercise as unknown as Alert)).toBeNull();
    // Control: a genuinely approved ACTUAL alert IS emittable, so the guard is discriminating, not blanket.
    const real = { ...exercise, capStatus: 'ACTUAL', approvedBy: em } as unknown as Alert;
    expect(asEmittable(real)).not.toBeNull();
  });
});

// ── Layer 2 — the module graph ───────────────────────────────────────────────────────────────────────
describe('Layer 2 — the drill composition cannot REACH a live channel', () => {
  /** Cruise the real gate config from the real entry point; returns every reachable module path. */
  function reachableFrom(entry: string): readonly string[] {
    const raw = execFileSync(
      './node_modules/.bin/depcruise',
      ['--output-type', 'json', '--config', '.dependency-cruiser.cjs', entry],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const parsed = JSON.parse(raw) as { modules: Array<{ source: string }> };
    return parsed.modules.map((m) => m.source);
  }

  // Both graphs are cruised ONCE, in a hook with a timeout sized for a real subprocess: `depcruise`
  // resolves the whole transitive graph through the tsconfig `@/` aliases, which takes seconds, and a
  // 5 s default would make a correct assertion look like a failure on a loaded machine.
  let reachable: readonly string[] = [];
  let live: readonly string[] = [];
  beforeAll(() => {
    reachable = reachableFrom('src/main/build-drill.ts');
    live = reachableFrom('src/main/feature-seed.ts');
  }, 300_000);

  it('reaches ZERO modules under src/adapters/channels/messaging/', () => {
    // Guard against a vacuous assertion: the cruise must have actually resolved a real graph.
    expect(reachable.length).toBeGreaterThan(10);
    expect(reachable).toContain('src/main/build-drill.ts');
    expect(reachable).toContain('src/adapters/governance/drill-recorder.ts');
    expect(reachable.filter((m) => m.startsWith('src/adapters/channels/'))).toEqual([]);
    expect(reachable.filter((m) => m.includes('channels/messaging'))).toEqual([]);
    // …and it never reaches the live composition root that DOES build a broadcast path.
    expect(reachable).not.toContain('src/main/feature-seed.ts');
  });

  it('CONTROL: the live composition root does reach the messaging channel', () => {
    // Without this the previous assertion could pass simply because nothing resolves. It also documents
    // exactly what the drill composition is being kept away from.
    expect(live.filter((m) => m.includes('channels/messaging')).length).toBeGreaterThan(0);
  });

  it('the gate config carries the `drill-never-reaches-a-live-channel` rule at error severity', () => {
    // The test-time graph assertion above and this build-time rule are complementary: the rule fails the
    // build for ANY future module in the drill subgraph, not only the entry point asserted here.
    const config = readFileSync('.dependency-cruiser.cjs', 'utf8');
    expect(config).toContain('drill-never-reaches-a-live-channel');
    expect(config).toContain("to: { path: '^src/adapters/channels/messaging' }");
    // Whitespace-tolerant: the formatter may lay the rule object out on one line or several.
    expect(config).toMatch(/drill-never-reaches-a-live-channel',\s*severity:\s*'error'/);
  });
});

// ── Layer 3 — egress ─────────────────────────────────────────────────────────────────────────────────
describe('Layer 3 — a full drill episode makes no network call', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('completes an episode with a THROWING fetch spy that is never called', () => {
    // A spy that throws rather than one that records: if any code path did reach the network, the episode
    // would fail loudly instead of quietly "passing" against a stub that happens to return undefined.
    const spy = vi.fn(() => {
      throw new Error('LIVE NETWORK CALL FROM A DRILL — this must be impossible (ADR-034 §7)');
    });
    globalThis.fetch = spy as unknown as typeof fetch;

    const deps = buildDrillDeps({ clock: () => T0, env: { DRILL_MODE: 'on' } });
    const res = deps.episode({
      episodeId: 'ep-1',
      incidentId: asId<IncidentId>('inc-ro-1'),
      alertId: asId<AlertId>('al-drill-1'),
      category: 'Met',
      severity: 'SEVERE',
      approvalAttempt: { actorId: em, role: 'EM', at: T0 },
    });

    expect(spy).not.toHaveBeenCalled();
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.artifact.capStatus).toBe('EXERCISE');
    expect(res.value.record?.sink).toBe('DRILL_RECORDER');
    expect(deps.ledger.verify().intact).toBe(true);
    expect(deps.ledger.entries.map((e) => e.action)).toEqual([
      'DRILL_START',
      'SOP_APPROVE',
      'DRILL_ARTIFACT',
      'DRILL_END',
    ]);
  });
});
