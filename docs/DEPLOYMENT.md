# BEACON — Deployment Guide (every target, one page)

> How to run BEACON anywhere: your laptop, one Docker host, Railway (the reference deployment judges
> can open), Kubernetes, or any container platform. One image, one configuration surface, four postures.
> For *using* it once it runs, see [`OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md); for turning every data
> source live, [`LIVE_PRODUCTION_GUIDE.md`](LIVE_PRODUCTION_GUIDE.md).

## 0. The one thing to understand first — postures

BEACON is the **same artifact** in every posture; only environment variables differ.

| Posture | `FEATURE_STORE` | `AI_MODE` | Sources | Needs | Use for |
|---|---|---|---|---|---|
| **Air-gapped** | `memory` | `off` | cached/mock | nothing — no keys, no egress | judges' one-command reproduction, field laptops |
| **Demo (as deployed)** | `memory` | `off` | live where keyless/keyed | free keys | the hosted demo — fast, every feature works, fresh seed each boot |
| **Durable** | `postgres` | `off` | live | Postgres + keys | an agency pilot: logistics/reports/audit survive restarts |
| **Full production** | `postgres` | `cloud`/`local` | all live-capable | + LLM key or Ollama | see the latency note in §6 before enabling `cloud` |

Every number is deterministic in all four; `AI_MODE=off` only removes the narrated prose and labels
the SitRep `deterministic-only`. That label is honest, not a failure.

## 1. Local — one command, zero keys (the judges' path)

```bash
docker compose -f infra/docker-compose.yml up -d --build   # Postgres → migrations → app
open http://localhost:3000
docker compose -f infra/docker-compose.yml down -v          # tear down
```
`-f` is required (the compose file lives in `infra/`). No `.env` is needed — every value has a safe
air-gapped default. To run the **live** profile from a local `.env`, use `npm run docker:up` instead:
it renders `.env` into a comment-free `infra/.env.docker` first (Docker's env-file parser does not strip
inline comments; Next.js's does — two parsers, one file, and the render is the bridge).

Without Docker: `nvm use && npm install && npm run dev`.

## 2. Any single Docker host (VPS, on-prem box, edge device)

```bash
docker build -f infra/Dockerfile --target runner -t beacon:1.0 \
  --build-arg NEXT_PUBLIC_AUTH_TOKEN_LOGIN=on \
  --build-arg NEXT_PUBLIC_DEPLOY_POSTURE=live .
docker run -d --name beacon -p 3000:3000 --env-file /etc/beacon/env beacon:1.0
```
The image is multi-stage, non-root, digest-pinned, with a built-in `HEALTHCHECK` on
`GET /api/v1/health`. Put a reverse proxy with TLS in front (Caddy/nginx); for SSE push, disable
proxy buffering and raise the read timeout (see the Ingress annotations in `infra/k8s/50-app.yaml`).
With `FEATURE_STORE=postgres`, run `node scripts/migrate.mjs` once against `DATABASE_URL` before start.

## 3. Railway — the reference cloud deployment

This is exactly how https://quest-beacon.up.railway.app runs. Full runbook, judge accounts and the
posture hard-offs: [`CLOUD_DEPLOY_RAILWAY.md`](CLOUD_DEPLOY_RAILWAY.md). The admin-UI companion
(Directus over the same Postgres) and the three gotchas that cost real time:
[`DEMO_INFRA_RAILWAY.md`](DEMO_INFRA_RAILWAY.md).

The four settings that matter, in order:
1. Builder = Dockerfile at `infra/Dockerfile`; set every `NEXT_PUBLIC_*` variable **before** the first build.
2. Pre-deploy command = `node scripts/migrate.mjs` (the runtime image has no `drizzle-kit`).
3. `DATABASE_URL=${{Postgres.DATABASE_URL}}` — a service reference, never a copied secret.
4. Leave `AUTH_DEV_TRUST_HEADER`, `AUTH_DEV_LOGIN` unset — cloud must never trust the spoofable role header.

## 4. Kubernetes — `infra/k8s/` (kustomize)

```bash
cp infra/k8s/20-secrets.example.yaml infra/k8s/20-secrets.yaml   # fill in; gitignored
kubectl apply -k infra/k8s
kubectl -n beacon get pods,job,ingress
```
What it gives you: namespace · ConfigMap (all non-secret config) · Secret template · Postgres
StatefulSet (evaluation only — point `DATABASE_URL` at a managed database for production and drop
`30-postgres.yaml`) · a **migration Job** the app waits for via an initContainer · a 2-replica
Deployment with liveness/readiness on `/api/v1/health`, non-root, resource limits · Service · Ingress
with the **SSE-friendly** timeout/buffering annotations · HPA (2–6 pods on CPU).

Build and push the image first (`docker build … --target runner`), then set `images:` in
`kustomization.yaml`. The manifests are plain YAML — they translate 1:1 into a Helm chart or Terraform
if your platform team prefers.

**Scaling beyond one instance:** switch `FEATURE_QUEUE=bullmq`, `FEATURE_EVENTBUS=redis`,
`FEATURE_CACHE=redis` and set `REDIS_URL`, so replicas share one ingest schedule and fan SSE deltas
out to every connected browser.

## 5. Other platforms

The image runs unchanged anywhere that runs a container and injects environment variables:

| Platform | Notes |
|---|---|
| **Fly.io / Render / Koyeb** | Dockerfile deploy; add a release/pre-deploy command `node scripts/migrate.mjs`; attach managed Postgres |
| **Google Cloud Run** | set request timeout ≥ 300 s and min-instances ≥ 1 for SSE; Cloud SQL via `DATABASE_URL` |
| **AWS ECS/Fargate · Azure Container Apps** | task/app definition from the same image; run the migration as a one-off task before rollout |
| **Bare `docker compose` on a server** | §1 as-is, plus a TLS proxy |

## 6. Build-time vs runtime variables — the one trap on every platform

`NEXT_PUBLIC_*` flags are **inlined by `next build`**, so they must reach the *build* (Docker
`--build-arg`, or the platform's build-time variables), and changing one requires a rebuild. Everything
else is read at runtime. `infra/Dockerfile` declares every `NEXT_PUBLIC_*` flag as an `ARG`.

**Installable / offline COP (ADR-047).** `NEXT_PUBLIC_PWA=on` (build-time, default off) links the web-app
manifest and registers the service worker, so a browser keeps the app shell and the last public picture
when the network drops and says when that picture was saved. It needs HTTPS (or `localhost`) — a browser
refuses a worker on a plain-http origin — and a rebuild to change. Off builds retire a previously
registered worker on the next visit. Details: `docs/architecture/CONFIGURATION.md` §10.

**AI narration latency.** With `AI_MODE=cloud`, the SitRep read path narrates synchronously through the
compliance gateway; a large-context model call can take 30–90 s. Behind an edge with a hard request
timeout (Railway: 60 s) that surfaces as a hanging `/status`. A short-TTL narration memo
(`src/adapters/compliance/narration-memo.ts`) collapses repeat calls, but the *first* narration per
fact-set still pays the full round trip. Until narration is moved off the read path (roadmap), run
`AI_MODE=off` behind short-timeout edges, or `AI_MODE=local` (Ollama) where latency is yours to control.

## 7. Verify any deployment in 30 seconds

```bash
B=https://<your-host>
curl -s $B/api/v1/health                                          # {"status":"ok"}
curl -s "$B/api/v1/sources?regionId=us-ca" | jq '.data.sources[] | {sourceId, mode}'   # effective modes
curl -s -H 'x-beacon-role: EM' -o /dev/null -w '%{http_code}\n' $B/api/v1/reports      # 403 — spoof dead
curl -s $B/.well-known/sustainability | head -c 200                # the disclosure endpoint
```
First request per region after a cold start performs real upstream fetches (~30–60 s); everything after
is sub-second. Warm both regions once before a demo.
