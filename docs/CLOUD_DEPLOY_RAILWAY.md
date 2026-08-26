# BEACON — Cloud deploy (Railway) + judge access

**Written 2026-08-04.** The internet-reachable deployment judges can open in a browser, with **real
auth**: the spoofable demo paths are hard-off in cloud, and privileged roles come only from signed
bearer tokens minted offline. Local/docker instructions live in
[FINAL_LIVE_TEST_AND_DEMO.md](FINAL_LIVE_TEST_AND_DEMO.md); this file is only the cloud lane.

---

## 1. Auth & authorization — named accounts, per persona

On `DEPLOY_MODE=cloud` the server — deliberately, finding F-344 —
- **ignores** the `x-beacon-role` demo header (`rbac.ts` returns PUBLIC unconditionally), and
- **404s** `POST /auth/dev-login` (the arbitrary-role minter never runs on an internet-reachable host).

The real auth surface is **`POST /auth/login`**, which works in *every* posture (local, docker, cloud)
because it grants only the role its **configured account** already carries — a request cannot ask for a
role at all. That is the structural difference from dev-login, and the reason this one is cloud-safe.

| Persona | How you become it | What it can do |
|---|---|---|
| **PUBLIC** | nothing — the default for every anonymous visitor | aggregate COP, submit a consented SOS report. **No** precise locations, no queue, no approvals |
| **RESPONDER** | sign in with a RESPONDER account | + precise report geometry (Art. XIV), logistics tasking, routing, pre-positioning |
| **VERIFIER** | sign in with a VERIFIER account | + the triage queue: read a claim, TRIAGE → VERIFY / REJECT |
| **EM** | sign in with an EM account | + approve a DRAFT alert → ACTUAL CAP + Telegram broadcast (HITL, Art. XIII) |

**Accounts are config** (`AUTH_USERS`, `id:ROLE:password` triples), so the same mechanism works
air-gapped with `FEATURE_STORE=memory` and on a cloud deploy with no DB seeding step. A production
system would use a real IdP — that is recorded in `docs/features/ROADMAP-POST-V1.md`, not pretended.

**How the password is handled:** never stored or compared as plaintext. Each is stretched with **scrypt**
(memory-hard, node stdlib — no new dependency) under a salt bound to `AUTH_SECRET`, and compared with
`timingSafeEqual`. An unknown user still runs a full derivation before failing, so response timing cannot
enumerate accounts, and 401 is byte-identical for "no such user" and "wrong password". Because the salt
includes `AUTH_SECRET`, the same password on two deployments derives two different keys.

**The token:** a 12-hour HS256 bearer (≈ one operational shift) whose `sub` is the **real account id** —
so the hash-chained triage audit records *a person*, not `role:EM`.

**Verified end-to-end 2026-08-04 in `DEPLOY_MODE=cloud`:** correct password → `200 {role: EM, userId:
em@beacon.demo}` · wrong password → `401` · unknown user → the *same* `401` · `dev-login` → `404` ·
token on `GET /reports` → `200` · spoofed `x-beacon-role: EM` → `403` · `GET /me` → `{role: EM, sub:
em@beacon.demo}`.

**Rotation / revocation:** change `AUTH_SECRET` on Railway → every outstanding token AND every derived
account key is invalidated at once. **Cost exposure:** an anonymous visitor is PUBLIC, and PUBLIC is
refused the cloud LLM tier by the compliance proxy (verified live: `403 role 'PUBLIC' may not use model
tier CLOUD`), with per-role rate limits and ADR-018 budget caps (`BUDGET_PER_*_USD`) behind it.

> The offline token minter (`npm run auth:mint-tokens`) still exists for headless/API use — it signs the
> same bearer. Interactive users should sign in instead.

## 2. Deploy steps (Railway)

1. **New project → Deploy from GitHub repo.** Select this repository.
2. **Service settings:**
   - Root directory: the repository root
   - Builder: **Dockerfile**, path `infra/Dockerfile` (multi-stage, non-root, pinned digest).
3. **Add Postgres** (Railway plugin) — it injects `DATABASE_URL`.
4. **Variables** (Service → Variables). Everything is env-driven; nothing is hardcoded:

   ```bash
   # Posture — cloud hard-offs the demo auth paths
   DEPLOY_MODE=cloud
   APP_BASE_URL=https://<your-app>.up.railway.app
   AUTH_SECRET=<64+ random chars — the token-verify secret; keep it OFF your local .env if you want distinct local/cloud tokens>
   AUTH_USERS=<id:ROLE:password triples — the judge accounts you provision (see §1); comma-separated>
   NEXT_PUBLIC_AUTH_TOKEN_LOGIN=on   # BUILD-time flag (inlined by `next build`) — reveals the toolbar sign-in
   NEXT_PUBLIC_DEPLOY_POSTURE=live   # BUILD-time flag — green LIVE chip; hides the DEV tag + role switcher
   # Store: memory = demo posture (fresh seed every boot, fastest); postgres = durable (needs step 5)
   FEATURE_STORE=memory
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   # Live data + AI — same values as the local live profile in .env:
   DATA_SOURCE_COMPOSITION=adapters
   AI_MODE=off       # cloud narration exceeds Railway's 60 s edge timeout on the SitRep read path — see docs/DEPLOYMENT.md §6
   COMPLIANCE_PROXY_ENABLED=on
   # …then copy every SOURCE_*_MODE, key (FIRMS_MAP_KEY, GLOFAS_CDS_KEY, OPENCELLID_API_KEY,
   # WINDY_WEBCAMS_API_KEY, RELIEFWEB_APPNAME, ORS_API_KEY), LLM_TIER_*, NWS_USER_AGENT,
   # TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_IDS from the working local .env.
   # Do NOT set: AUTH_DEV_TRUST_HEADER, AUTH_DEV_LOGIN, NEXT_PUBLIC_AUTH_DEV_LOGIN (dev-only paths).
   ```

   Secrets live **only** in Railway's variable store — never in a file, never in the image.

   > **Set the `NEXT_PUBLIC_*` variables BEFORE the first build.** They are inlined at `next build`
   > time, and two things must both hold for them to reach the build: the variable exists in Railway's
   > store, **and** `infra/Dockerfile` declares it as an `ARG` (it now does, for all five
   > `NEXT_PUBLIC_*` flags). A variable added after the first deploy needs a rebuild to take effect.
5. **Run migrations.** Set the service's pre-deploy command (Settings → **Deploy → Pre-deploy
   command**) to `node scripts/migrate.mjs` — it runs inside the runtime image before each deploy
   goes live. (`drizzle-kit` is a devDependency and is **not** in the runtime image; the runner image
   ships `drizzle/` + `scripts/migrate.mjs` instead.) Off-box fallback, from your machine:
   `DATABASE_URL=<the Railway url> npm run migrate`.
6. **Provision the judge accounts** — add one `id:ROLE:password` triple per judge persona to the
   `AUTH_USERS` variable (see §1) and hand each judge their account id + password. For headless/API
   use only, `npm run auth:mint-tokens` can still sign a bearer against the Railway `AUTH_SECRET`
   (sent as an `Authorization: Bearer` header):

   ```bash
   AUTH_SECRET=<the Railway value> npm run auth:mint-tokens        # 90-day tokens — headless/API only
   ```

7. **Smoke-check the deployed posture:**

   ```bash
   BASE=https://<your-app>.up.railway.app
   curl -s $BASE/api/v1/status | head -c 300                     # 200, provenance visible
   curl -s -H 'x-beacon-role: EM' $BASE/api/v1/reports -o /dev/null -w '%{http_code}\n'   # 403 — spoof dead
   curl -s -H "Authorization: Bearer $EM_TOKEN" $BASE/api/v1/reports -o /dev/null -w '%{http_code}\n'  # 200
   ```

**As deployed for judging (2026-08-26):** `FEATURE_STORE=memory`, `AI_MODE=off`, posture `live`,
named accounts on, 9 sources LIVE on `us-ca`. The Postgres service stays populated (migrated + seeded)
and is browsable through the Directus admin UI — [`DEMO_INFRA_RAILWAY.md`](DEMO_INFRA_RAILWAY.md).
Flip `FEATURE_STORE=postgres` to make the app write to it.

TLS: terminated by Railway's edge (automatic HTTPS on `*.up.railway.app`) — the app needs no TLS
config of its own.

## 3. Judge instructions (paste into the submission notes, with the account credentials)

> **Hosted demo:** `https://<your-app>.up.railway.app` — open it; you are the **PUBLIC** persona
> (aggregate view only — no precise SOS coordinates, by design, Art. XIV).
>
> **Privileged personas:** click the toolbar's **sign-in** control and enter one of the account
> ids + passwords below (the accounts the operator provisioned via `AUTH_USERS`); the server grants
> only the role that account carries:
> - `EM` — approve DRAFT alerts (HITL), see decision support, trigger the Telegram broadcast
> - `VERIFIER` — the verify queue: confirm/reject citizen SOS reports
> - `RESPONDER` — precise report locations on the map, logistics tasking
>
> **Everything numeric is deterministic** (the LLM narrates cited facts only — turn AI off and the
> COP still ranks); every response carries `provenance[]` + freshness; live sources degrade to
> labelled CACHED/MOCK, never a dead-end.
>
> **Fully-local reproduction (no keys, no account, ~$0):** see the README quickstart —
> `docker compose -f infra/docker-compose.yml up -d --build` renders the full COP air-gapped.
> **Full live reproduction:** [FINAL_LIVE_TEST_AND_DEMO.md](FINAL_LIVE_TEST_AND_DEMO.md).

## 4. What cloud deliberately does NOT have

| Capability | Cloud behaviour | Why |
|---|---|---|
| `x-beacon-role` header trust | Ignored → PUBLIC | Spoofable; F-344 hard-off |
| `POST /auth/dev-login` | 404 | Demo IdP never mints on the internet |
| Role switcher without signing in | Cosmetic (server stays PUBLIC); hidden when `NEXT_PUBLIC_DEPLOY_POSTURE=live` | Server is the only authority |
| Air-gapped guarantee | N/A (cloud has egress by definition) | The local lane proves Art. XVI |
