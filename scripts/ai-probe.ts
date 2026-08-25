// BEACON — Phase-B live AI probe (dev tool; makes a real LLM call via OpenRouter). Verifies AI_MODE=cloud
// drives SitRep narration THROUGH the compliance proxy → LLM ladder, and that the F3/F-340 guarantee holds
// (the prose carries NO figure at all — every number the operator sees is rendered from the deterministic
// record). Run:
//   AI_MODE=cloud LLM_TIER_DEFAULT_MODEL=… LLM_TIER_DEFAULT_BASE=https://openrouter.ai/api/v1 \
//     LLM_TIER_DEFAULT_KEY=$OPENROUTER_API_KEY npm run ai:probe
// Load .env EXACTLY as the Next.js app does (found 2026-08-04): tsx does NOT auto-load .env, so until
// this line every doc that said "set it in .env and run this script" was wrong — the script saw only the
// shell environment, which is a large part of why live settings "didn't get picked up". @next/env is the
// same parser the app boots with (strips inline comments and quotes), so script and app can never again
// disagree about what a value is. Pre-set shell vars still win, so the documented inline-override usage
// (`CHANNEL_TELEGRAM_MODE=live npm run telegram:poll`) keeps working unchanged.
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

export {};

const { createHttpDepsLive, handleHttp } = await import('@/adapters/channels/http/http-dispatcher.js');

// The compliance proxy's role-scope (Art. XV) restricts the CLOUD tier to em/verifier/responder — PUBLIC is
// denied by policy. Pass PROBE_ROLE (with AUTH_DEV_TRUST_HEADER=on) to exercise the LLM as an authorized role.
const role = process.env.PROBE_ROLE;
const headers: Record<string, string> = role ? { 'x-beacon-role': role } : {};
const deps = await createHttpDepsLive();
const res = await handleHttp(
  { method: 'GET', path: '/api/v1/incidents/us-ca-wildfire-demo/sitrep', query: {}, headers },
  deps,
);
const body = res.body as {
  data?: { aiMode?: string; summary?: string; fields?: Array<{ field: string; claim: string }> };
  citations?: unknown[];
};
const d = body.data ?? {};
console.log('status      :', res.status);
console.log('aiMode      :', d.aiMode);
console.log('citations   :', (body.citations ?? []).length);
console.log('summary     :', d.summary ?? '(none → deterministic-only)');
console.log('fields      :', JSON.stringify(d.fields));

// F3/F-340 spot-check — CALL the production validator rather than re-implementing it. The previous copy of
// the rule here drifted the moment the rule changed, which is precisely how a probe reports PASS on prose
// the shipped guard would reject (or the reverse).
const { narrationIsFigureFree } = await import('@/adapters/ai/llm/output-validator.js');
const prose = d.summary ?? '';
console.log('F3/F-340 (prose carries no figure):', narrationIsFigureFree(prose) ? 'PASS' : 'FAIL');
process.exit(0);
