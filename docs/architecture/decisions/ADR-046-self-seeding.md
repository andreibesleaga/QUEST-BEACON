# ADR-046 — The app seeds its own database when it finds it unseeded

**Status:** Accepted · 2026-09-14

## Context

The reference seed (`scripts/seed.mjs`, built from `src/adapters/persistence/seed.ts`) writes the region
natural keys, the demo accounts, the operators' resource roster, the shelter directory, the threshold
rules and the operator-panel rows. Its documented home is the platform's pre-deploy command, beside the
migrator. On the live deployment that command was configured, two redeploys ran, and the region rows
still carried no natural key — the seed's first statement. Nothing in the app said so: `resolveRegionRowId`
answered null, every mirror skipped every row, logistics listed no resources, routing found three demo
shelters, and the checker's "seed has run" failed with no error anywhere in the app.

## Decision

1. **The composition root probes and seeds.** Under `FEATURE_STORE=postgres`, before assembling the live
   picture, `seedIfNeeded` asks one question in one round trip — are there region rows without a natural
   key, or is the `resource` table empty? — and, if so, runs the seed in-process and logs what it wrote.
   A seeded database costs one count and no write.
2. **The seed stays idempotent and non-destructive.** Every insert is do-nothing on conflict; only a
   region's natural key is ever backfilled; operator-edited rows are never reverted. Running it twice —
   from the pre-deploy command and from the app — is harmless by construction.
3. **Failure is logged, never fatal** (Art. XVI). The line names the pre-deploy command as the fallback
   path; the COP composes regardless.

## Consequences

- A deployment whose pre-deploy step never ran, or ran against the wrong database, still serves its
  roster, rules and shelters after one boot. The deploy log says either `[beacon] seeded …` or
  `[beacon] seed failed: …`.
- The pre-deploy command remains documented and preferred: migrations are NOT run by the app.
- The `seed` module is now part of the server bundle (a dynamic import, resolved only when needed).

Related: ADR-039 (durable mirrors), ADR-041 (operator-editable rows).
