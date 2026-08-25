// BEACON — judge-token minter (cloud auth; dev tool, never in the request path). Mints one long-lived
// HS256 bearer token per RBAC role, signed with AUTH_SECRET — the SAME secret the deployed server
// verifies with (rbac.ts resolvePrincipal), so these tokens work against ANY deployment that shares the
// secret (Railway, docker, local `next start`).
//
// WHY THIS IS THE WHOLE CLOUD-AUTH DESIGN (decision 2026-08-04): `DEPLOY_MODE=cloud` hard-offs the
// spoofable dev header AND hard-404s the dev-login minter (F-344) — deliberately, and this tool does not
// reopen either. The bearer-JWT verify path was ALREADY cloud-safe (fail-closed, pinned HS256, exp
// enforced); the only gap was issuance. Minting OFFLINE and handing tokens out-of-band (the private
// judge instructions) adds ZERO new server surface — there is no login endpoint to attack, and rotation
// is one env change (new AUTH_SECRET on the host invalidates every outstanding token at once).
//
// Run:  npm run auth:mint-tokens                      (reads AUTH_SECRET from .env; 90-day expiry)
//       TOKEN_TTL=30d npm run auth:mint-tokens        (custom expiry)
//       AUTH_SECRET=... npm run auth:mint-tokens      (explicit secret, e.g. the Railway one)
// SECURITY: prints tokens to stdout by design (that is its job). Treat the output as a credential sheet —
// paste into the private submission notes, never into a tracked file.
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

const { signDevToken } = await import('@/adapters/channels/http/rbac.js');
const { APP_USER_ROLES } = await import('@/domain/app-user.js');

const secret = process.env.AUTH_SECRET;
if (secret === undefined || secret === '') {
  console.error('AUTH_SECRET is not set. Set it in .env (or inline) — it must EQUAL the secret on the target deployment.');
  process.exit(1);
}
const ttl = process.env.TOKEN_TTL ?? '90d';

console.log(`BEACON judge tokens — HS256, exp ${ttl}, sub judge-<role>. Verify secret: AUTH_SECRET (${secret.length} chars).`);
// The toolbar token-paste field was REMOVED in dd8423e (2026-08-05) — interactive users sign in with a
// named AUTH_USERS account instead (docs/CLOUD_DEPLOY_RAILWAY.md §1). These tokens remain for HEADLESS use.
console.log('HEADLESS/API use only: send as `Authorization: Bearer <token>` on any API call.');
console.log('Interactive users: sign in via the toolbar (AUTH_USERS account) — there is no paste field.\n');
for (const role of APP_USER_ROLES) {
  if (role === 'PUBLIC') continue; // PUBLIC needs no token — it is the unauthenticated default
  const token = await signDevToken(role, secret, ttl, `judge-${role.toLowerCase()}`);
  console.log(`${role}:\n${token}\n`);
}
process.exit(0);
