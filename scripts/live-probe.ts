// BEACON — Phase-B live probe (dev tool; NOT a test — makes real network calls, so it never runs in CI).
// Drives the real live composition in-process: createHttpDepsLive() → handleHttp for /status + the region
// maps with DATA_SOURCE_COMPOSITION=adapters and the keyless sources LIVE. Prints the provenance modes so a
// human can see real LIVE fetches vs cached/mock fallbacks. Run: `npm run live:probe` (see docs/VISUAL_LIVE_TEST_PLAN.md).
// Load .env EXACTLY as the Next.js app does (found 2026-08-04): tsx does NOT auto-load .env, so until
// this line every doc that said "set it in .env and run this script" was wrong — the script saw only the
// shell environment, which is a large part of why live settings "didn't get picked up". @next/env is the
// same parser the app boots with (strips inline comments and quotes), so script and app can never again
// disagree about what a value is. Pre-set shell vars still win, so the documented inline-override usage
// (`CHANNEL_TELEGRAM_MODE=live npm run telegram:poll`) keeps working unchanged.
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

export {}; // module marker (enables top-level await under tsc)

// DEFAULTS, never overrides (changed 2026-08-04): the probe used to Object.assign a hardcoded keyless
// profile OVER whatever .env said — so the operator's real posture (their keys, their per-source modes)
// was invisible to the very tool meant to verify it. Now anything .env (or the shell) sets WINS, and
// these keyless-live defaults apply only on a box with no .env at all, preserving the original
// "probe the keyless LIVE rung" behaviour for a fresh clone.
const PROBE_DEFAULTS: Record<string, string> = {
  DATA_SOURCE_COMPOSITION: 'adapters',
  SOURCE_NWS_MODE: 'live',
  SOURCE_NWPS_MODE: 'live',
  SOURCE_OPEN_METEO_MODE: 'live',
  SOURCE_GDACS_MODE: 'live',
  SOURCE_FIRMS_MODE: 'mock',
  SOURCE_GLOFAS_MODE: 'cached',
  SOURCE_METEOALARM_RO_MODE: 'cached',
  SOURCE_USGS_WATER_MODE: 'mock',
  // Phase-D keyless sources — probe their LIVE rung too (a 429/timeout degrades honestly to CACHED/MOCK,
  // which the printed mode label makes visible; that degradation is itself the Art. XVI proof).
  SOURCE_GDELT_MODE: 'live',
  SOURCE_AGENCYRSS_MODE: 'live',
  SOURCE_NIFC_MODE: 'live',
  SOURCE_WORLDPOP_MODE: 'live',
  NWS_USER_AGENT: 'BEACON (contact: test@example.org)',
  AUTH_DEV_TRUST_HEADER: 'on',
};
for (const [k, v] of Object.entries(PROBE_DEFAULTS)) process.env[k] ??= v;

const { createHttpDepsLive, handleHttp } =
  await import('@/adapters/channels/http/http-dispatcher.js');

const deps = await createHttpDepsLive();

async function probe(path: string, role?: string): Promise<void> {
  const headers: Record<string, string> = role ? { 'x-beacon-role': role } : {};
  const res = await handleHttp({ method: 'GET', path, query: {}, headers }, deps);
  const body = res.body as {
    provenance?: Array<{ sourceId: string; mode: string; fetchedAt: string }>;
    freshness?: string;
  };
  console.log(`\n${path} → ${res.status}`);
  console.log('  freshness:', body.freshness);
  for (const p of body.provenance ?? [])
    console.log(`  ${p.sourceId.padEnd(14)} ${p.mode.padEnd(7)} ${p.fetchedAt}`);
}

await probe('/api/v1/status');
await probe('/api/v1/regions/us-ca/map', 'RESPONDER');
await probe('/api/v1/regions/ro/map', 'RESPONDER');
process.exit(0);
