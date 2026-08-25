// BEACON — E2E_TESTING_PLAYBOOK capture probe (dev tool; NOT a test). Drives the REAL HTTP composition
// (createHttpDepsLive → handleHttp) in-process to capture the actual JSON envelopes, the CAP v1.2 document
// emitted by the HITL approve gate, the EDXL-RM round-trip + EDXL-SitRep emission, and the RBAC negatives —
// so docs/E2E_TESTING_PLAYBOOK.md is built from real captured output. Offline default (deterministic seed);
// with AI_MODE=cloud + LLM_TIER_DEFAULT_{MODEL,BASE,KEY} the SitRep capture shows real narration.
// Run: npm run dev is NOT needed — this is in-process. `tsx scripts/capture-playbook.ts` (see the playbook).
export {}; // module marker (enables top-level await)

process.env.AUTH_DEV_TRUST_HEADER = 'on'; // honour the dev role header for this in-process capture

const { createHttpDepsLive, handleHttp } = await import('@/adapters/channels/http/http-dispatcher.js');
const { makeResourceTask } = await import('@/domain/resource-task.js');
const { makeSitRep } = await import('@/domain/sitrep.js');
const { resourceTaskToEdxlRm } = await import('@/adapters/interop/edxl-rm-mapper.js');
const { asId } = await import('@/domain/value-objects/ids.js');

const deps = await createHttpDepsLive();

type Res = { status: number; body: unknown };
async function call(method: string, path: string, role?: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-beacon-role'] = role;
  const res = await handleHttp(
    { method, path, query: {}, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
    deps,
  );
  return { status: res.status, body: res.body };
}

function hr(title: string): void {
  console.log(`\n\n========== ${title} ==========`);
}
function dump(label: string, r: Res): void {
  console.log(`# ${label} → HTTP ${r.status}`);
  console.log(JSON.stringify(r.body, null, 2));
}

// ── 4a. JSON envelopes ──────────────────────────────────────────────────────
hr('GET /api/v1/status');
dump('status', await call('GET', '/api/v1/status'));

hr('GET /api/v1/regions/us-ca/incidents');
dump('us-ca incidents', await call('GET', '/api/v1/regions/us-ca/incidents'));

hr('GET /api/v1/incidents/us-ca-wildfire-demo/sitrep (aiMode reflects env)');
dump('us-ca sitrep', await call('GET', '/api/v1/incidents/us-ca-wildfire-demo/sitrep', 'VERIFIER'));

hr('GET /api/v1/regions/us-ca/map (RESPONDER — precise geom)');
dump('us-ca map', await call('GET', '/api/v1/regions/us-ca/map', 'RESPONDER'));

hr('GET /api/v1/reports (VERIFIER — verifier queue)');
dump('reports VERIFIER', await call('GET', '/api/v1/reports', 'VERIFIER'));

hr('GET /.well-known/sustainability');
dump('sustainability', await call('GET', '/.well-known/sustainability'));

// ── RO region (portability) ─────────────────────────────────────────────────
hr('GET /api/v1/regions/ro/incidents');
dump('ro incidents', await call('GET', '/api/v1/regions/ro/incidents'));

hr('GET /api/v1/incidents/ro-flood-demo/sitrep (VERIFIER)');
dump('ro sitrep', await call('GET', '/api/v1/incidents/ro-flood-demo/sitrep', 'VERIFIER'));

// ── 4b. CAP v1.2 alert (HITL approve gate, Art. XIII) ────────────────────────
hr('POST /api/v1/alerts/ca-alert-draft-1/approve (VERIFIER) → CAP v1.2 document');
dump('cap approve', await call('POST', '/api/v1/alerts/ca-alert-draft-1/approve', 'VERIFIER'));

// ── 4b. EDXL-RM round-trip (FR-9) ────────────────────────────────────────────
hr('POST /api/v1/edxl/rm (RESPONDER) → import EDXL-RM → canonical task (round-trip echo)');
const task = makeResourceTask({
  id: asId('task-mutualaid-1'),
  resourceId: asId('res-engine-7'),
  incidentId: asId('us-ca-wildfire-demo'),
  status: 'PROPOSED',
  edxlRmRef: 'urn:beacon:rm:corr-42',
});
const ser = resourceTaskToEdxlRm(task, { sentDateTime: deps.clock() });
if (!ser.ok) throw new Error('fixture serialize failed');
dump('edxl-rm post', await call('POST', '/api/v1/edxl/rm', 'RESPONDER', ser.value));

hr('GET /api/v1/edxl/rm/urn:beacon:rm:corr-42 (RESPONDER) → export stored task as EDXL-RM');
dump('edxl-rm get', await call('GET', '/api/v1/edxl/rm/urn:beacon:rm:corr-42', 'RESPONDER'));

// ── 4b. EDXL-SitRep emission (FR-9; citations preserved) ─────────────────────
hr('POST /api/v1/edxl/sitrep (VERIFIER) → EDXL-SitRep with preserved citations');
const sitrep = makeSitRep({
  id: asId('sitrep-demo-1'),
  incidentId: asId('us-ca-wildfire-demo'),
  generatedAt: deps.clock(),
  summary: 'Fire has grown to 1,200 acres; 3 shelters open; 1 substation OFFLINE.',
  trend: 'ESCALATING',
  aiMode: 'deterministic-only',
  fields: [
    {
      field: 'summary.executiveSummary',
      claim: 'Fire has grown to 1,200 acres',
      citations: [{ sourceId: asId('11111111-1111-4111-8111-111111111111') }],
    },
  ],
});
dump('edxl-sitrep post', await call('POST', '/api/v1/edxl/sitrep', 'VERIFIER', { sitrep, options: { incidentType: 'WILDFIRE' } }));

// ── 4c. RBAC negatives ───────────────────────────────────────────────────────
hr('RBAC — /reports PUBLIC vs VERIFIER; PATCH with body actorId → 400');
const pub = await call('GET', '/api/v1/reports', 'PUBLIC');
console.log('GET /reports PUBLIC   →', pub.status, '(expect 403)');
const ver = await call('GET', '/api/v1/reports', 'VERIFIER');
console.log('GET /reports VERIFIER →', ver.status, '(expect 200)');
const forge = await call('PATCH', '/api/v1/reports/some-id', 'VERIFIER', { decision: 'VERIFIED', actorId: 'attacker' });
console.log('PATCH /reports {actorId} VERIFIER →', forge.status, '(expect 400)');
console.log(JSON.stringify(forge.body));
const alertPub = await call('POST', '/api/v1/alerts/ca-alert-draft-1/approve', 'PUBLIC');
console.log('POST /alerts/:id/approve PUBLIC →', alertPub.status, '(expect 403)');
console.log(JSON.stringify(alertPub.body));

process.exit(0);
