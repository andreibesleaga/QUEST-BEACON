// BEACON — `npm run demo:reset` — reset the demo to a clean, reproducible baseline.
//   • OFFLINE (FEATURE_STORE=memory, the default): the in-memory seed (CA wildfire + RO flood) is fresh on
//     every boot — nothing to reset; prints the demo guide.
//   • POSTGRES (FEATURE_STORE=postgres + a real DATABASE_URL): clears the MUTABLE demo state (public reports +
//     their triage audit) so the verifier queue starts from the seeded baseline, then (re)applies the
//     deterministic reference seed (regions/sources/users/shelters) idempotently.
// A dev tool — not a test. See docs/VISUAL_LIVE_TEST_PLAN.md §10 and docs/audit/LIVE_VERIFICATION.md.
export {}; // module marker (top-level await)

import { loadConfig } from '@/config/index.js';

const config = loadConfig(process.env);

if (config.FEATURE_STORE !== 'postgres') {
  console.log('BEACON demo:reset — OFFLINE (FEATURE_STORE=memory).');
  console.log(
    '  The in-memory demo seed (CA wildfire + RO flood) is fresh on every boot — nothing to reset.',
  );
  console.log(
    '  Start:         npm run dev                                   → http://localhost:3000',
  );
  console.log(
    '  Live sources:  DATA_SOURCE_COMPOSITION=adapters SOURCE_NWS_MODE=live … npm run dev',
  );
  console.log('  Durable store: FEATURE_STORE=postgres DATABASE_URL=… npm run demo:reset');
  process.exit(0);
}

const { like } = await import('drizzle-orm');
const { makeDb } = await import('@/adapters/persistence/client.js');
const { seed } = await import('@/adapters/persistence/seed.js');
const { publicReport, auditEvent } = await import('@/adapters/persistence/schema.js');

const masked = config.DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
console.log(`BEACON demo:reset — POSTGRES (${masked})`);

const db = makeDb(config.DATABASE_URL);
// Clear the mutable demo state so the verifier queue starts from the seeded baseline (durable reports/audit
// are the only mutable demo tables; reference data is reapplied below).
await db.delete(auditEvent).where(like(auditEvent.target, 'public_report:%'));
await db.delete(publicReport);
const data = await seed(db); // idempotent (ON CONFLICT DO NOTHING on the fixed demo UUIDs)

console.log(
  `  cleared public reports + triage audit; reseeded regions=${data.regions.length} ` +
    `sources=${data.sourceRecords.length} users=${data.appUsers.length} shelters=${data.shelters.length}`,
);
console.log(
  '  Demo ready. Start the app with FEATURE_STORE=postgres, then POST /reports → GET /reports (VERIFIER).',
);
process.exit(0);
