/** BEACON hexagonal boundary rules (E0·T-010; F9). Enforced in CI. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '^src/domain' },
      to: {
        path: '^(src/adapters|src/main|src/application|node_modules/(next|react|postgres|drizzle-orm))',
      },
    },
    {
      name: 'application-no-adapters',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^(src/adapters|src/main)' },
    },
    // MW-D/D4 — ADR-034 §7 Layer 2. The DRILL subgraph may not reach a live messaging transport. This is the
    // BUILD-TIME half of the exercise-isolation guarantee: src/main/build-drill.ts composes an exercise run
    // without ever calling makeBroadcastDeps, and this rule makes that partition unreachable-by-import rather
    // than a convention a future edit could quietly undo. The module-graph assertion in
    // tests/architecture/drill-isolation.test.ts is the test-time half; the type-level half is that a
    // DrillAlert's capStatus:'EXERCISE' is not assignable to EmittableAlert's 'ACTUAL' literal.
    // application/anticipatory* is included because an EAP activation may only SUGGEST (ADR-034 §4) and is
    // the other subgraph that must never acquire a send path — it costs nothing while that lane is in flight.
    {
      name: 'drill-never-reaches-a-live-channel',
      severity: 'error',
      comment:
        'Exercise/anticipatory code must not import a live messaging transport (ADR-034 §7; FUW-7).',
      from: {
        path: '^src/(main/build-drill|application/governance|application/anticipatory|adapters/governance)',
      },
      to: { path: '^src/adapters/channels/messaging' },
    },
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsConfig: { fileName: 'tsconfig.json' } },
};
