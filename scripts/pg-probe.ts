// BEACON — Phase-B Postgres durability probe (dev tool; needs a live Postgres). Proves the HTTP composition
// (createHttpDepsLive) serves the DURABLE pg store under FEATURE_STORE=postgres: intake a report, then read
// it back via a SECOND, independently-built deps instance (simulating a process restart) — it must still be
// there (read from the DB, not in-memory). Run with a live DB: DATABASE_URL=... npm run pg:probe
export {};

Object.assign(process.env, {
  FEATURE_STORE: 'postgres',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://beacon:beacon@127.0.0.1:5432/beacon',
  AUTH_DEV_TRUST_HEADER: 'on',
});

const { createHttpDepsLive, handleHttp } = await import('@/adapters/channels/http/http-dispatcher.js');

type Envelope = { data?: unknown; provenance?: unknown[] };
async function req(deps: Awaited<ReturnType<typeof createHttpDepsLive>>, method: string, path: string, role: string, body?: unknown) {
  const headers: Record<string, string> = { 'x-beacon-role': role, 'content-type': 'application/json' };
  return handleHttp({ method, path, query: {}, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, deps);
}

// Instance A: intake an SOS as PUBLIC, then read the verifier queue as VERIFIER.
const a = await createHttpDepsLive();
const before = await req(a, 'GET', '/api/v1/reports', 'VERIFIER');
const beforeN = ((before.body as Envelope).data as { reports?: unknown[] })?.reports?.length ?? 'n/a';
const created = await req(a, 'POST', '/api/v1/reports', 'PUBLIC', { source: 'WEB', consent: true, text: 'smoke near ridge' });
console.log('POST /reports →', created.status);

// Instance B: a fresh composition (new store instance, same DB) — durability check across "restart".
const b = await createHttpDepsLive();
const after = await req(b, 'GET', '/api/v1/reports', 'VERIFIER');
const afterN = ((after.body as Envelope).data as { reports?: unknown[] })?.reports?.length ?? 'n/a';
console.log(`GET /reports (VERIFIER): before=${beforeN} after(fresh deps)=${afterN}  → durable=${Number(afterN) > Number(beforeN)}`);
console.log('PUBLIC GET /reports →', (await req(b, 'GET', '/api/v1/reports', 'PUBLIC')).status, '(expect 403)');
process.exit(0);
