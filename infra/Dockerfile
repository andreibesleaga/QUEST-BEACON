# BEACON — production image (E0·T-019 / S06 integration gate). Multi-stage, lean, non-root.
# Base pinned to an explicit version tag + digest for reproducible, supply-chain-safe builds
# (node 24.18.0 matches .nvmrc "24" / the project's pinned LTS). Alpine ⇒ small, key-less.
#
# Stages:
#   deps   — production-only node_modules (what the runtime needs)
#   build  — full deps + source → `next build`; ALSO the image used by the one-shot `migrate`
#            service in docker-compose (it ships drizzle-kit + drizzle/ migrations + src schema)
#   runner — minimal: prod node_modules + .next + public, runs as non-root user `beacon`

FROM node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* is inlined by `next build` — it must exist IN THIS STAGE or the browser flag is
# silently `off` no matter what the runtime environment says. Declared as ARG so both Railway
# (service variables are passed as build args for Dockerfile builds when declared) and compose
# (`build.args` in infra/docker-compose.yml) can set them; default empty = current behaviour.
ARG NEXT_PUBLIC_AUTH_TOKEN_LOGIN
ARG NEXT_PUBLIC_DEPLOY_POSTURE
ARG NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL
ARG NEXT_PUBLIC_FEATURE_CITIZEN_STREAM
ARG NEXT_PUBLIC_FEATURE_VISION
# Added with the live-demo increment: FEATURE_EXTERNAL_VIEWS now has a real browser consumer
# (app/_components/panels/sitrep-panel.tsx), so `off` set only in the runtime env_file would be inlined
# as unset — i.e. ON — in a docker-built bundle. Empty default preserves the server-side `on` default.
ARG NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS
ENV NEXT_PUBLIC_AUTH_TOKEN_LOGIN=$NEXT_PUBLIC_AUTH_TOKEN_LOGIN \
    NEXT_PUBLIC_DEPLOY_POSTURE=$NEXT_PUBLIC_DEPLOY_POSTURE \
    NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL=$NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL \
    NEXT_PUBLIC_FEATURE_CITIZEN_STREAM=$NEXT_PUBLIC_FEATURE_CITIZEN_STREAM \
    NEXT_PUBLIC_FEATURE_VISION=$NEXT_PUBLIC_FEATURE_VISION \
    NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS=$NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
# `public/` is optional in this app and may be absent from the context; guarantee it exists so the
# runner-stage COPY never fails (Next serves an empty static dir fine).
RUN mkdir -p public && npm run build

FROM node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Non-root runtime user (defence in depth).
RUN addgroup -S beacon && adduser -S beacon -G beacon
# Runtime assets only. `next start` needs .next, public/, prod node_modules, package.json. The app
# ALSO reads a few data dirs at runtime by cwd-relative path (validated fail-fast):
#   config/  — regions.json, policies.yml, adapters.json (12-factor config)
#   schemas/ — JSON-Schemas validated at request time (sustainability, CAP v1.2, EDXL-RM/SitRep)
#   fixtures/— MOCK_FIXTURES_DIR default (offline/air-gapped source data)
#   src/adapters/sources/*/__fixtures__/ — each source adapter's recorded-mock snapshot, resolved at
#     RUNTIME via `fileURLToPath(new URL('./__fixtures__', import.meta.url))` (recorded-mock.ts). Traced
#     directly against the compiled output (`next.config.mjs` sets `module.parser.javascript.url=false` so
#     webpack does NOT rewrite this into a bundled-asset reference): webpack still performs its normal
#     import.meta.url handling for a CJS/node target, which STATICALLY REPLACES the identifier with the
#     literal resolved file:// URL of the ORIGINAL SOURCE MODULE AT BUILD TIME (verified by grepping the
#     compiled `.next/server/chunks/*.js` — every adapter's fixturesDir line embeds a literal
#     `file:///app/src/adapters/sources/<id>/<id>-adapter.ts` string, NOT a `.next/...` chunk path). Since
#     both the `build` and `runner` stages use WORKDIR /app, copying the SAME relative path here reproduces
#     that literal absolute path exactly, so DATA_SOURCE_COMPOSITION=adapters + SOURCE_*_MODE=cached/mock
#     resolves real fixtures instead of CONFIG-erroring and silently falling back to the offline seed.
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/config ./config
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/fixtures ./fixtures
COPY --from=build /app/src/adapters/sources ./src/adapters/sources
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# Migrations must be runnable IN THIS IMAGE (Railway pre-deploy runs in the final stage, where
# drizzle-kit — a devDependency — does not exist). scripts/migrate.mjs uses drizzle-orm's
# programmatic migrator (a PROD dep) over the committed SQL + journal:
#   Pre-deploy command: node scripts/migrate.mjs
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
USER beacon
EXPOSE 3000
# Liveness/readiness probe target is GET /api/v1/health (static { status: 'ok' }, no DB needed).
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=10 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
CMD ["npm", "run", "start"]
