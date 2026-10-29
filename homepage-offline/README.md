# BEACON — always-on front (`homepage-offline`)

A very small service that owns the public address of the BEACON deployment,
**https://quest-beacon.up.railway.app**, so that the address always answers:

- **When the full deployment is running**, every request is passed through to it unchanged. Visitors
  see BEACON itself; this service is invisible.
- **When the full deployment is switched off**, the same address shows one page: what BEACON is,
  where the contest stands, and how to have the deployment brought online. API paths answer a small
  JSON `503` instead of HTML.

Nothing has to be switched by hand. Start or stop the deployment's services; this front notices
within a few seconds.

## How it decides

Every few seconds (`PROBE_TTL_MS`, default 5000) it asks the deployment
`GET {UPSTREAM_URL}/api/v1/health`. The deployment is **up** only if that answers `200` with
`{"status":"ok"}` within `PROBE_TIMEOUT_MS` (default 2500). A stopped Railway service answers
`404 Application not found` on its domain, which reads as **down**. Between probes the verdict is
cached, so a busy page costs one probe per interval. The check is liveness, not readiness: the
deployment serves pages as soon as it listens, while its `ready` flag only says the data composition
has finished warming up, so visitors are handed to the real app as early as possible.

## Files

| File                        | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `server.mjs`                | The service: probe, pass-through proxy, fallback page. Node core only. |
| `server.test.mjs`           | Tests against a stub deployment (`node --test homepage-offline/server.test.mjs`).     |
| `index.html` + `offline-assets/` | The one-screen page, its stylesheet, logo and screenshot. No script. |
| `Dockerfile`                | `node:24-alpine`, copy and run. No build step, no `npm install`.       |
| `railway.json`              | Build/deploy settings Railway reads from this directory.                |

## Settings (environment variables of this service)

| Variable                     | Default | Meaning                                                                  |
| ---------------------------- | ------- | ------------------------------------------------------------------------ |
| `PORT`                       | `3000`  | Set by Railway.                                                          |
| `UPSTREAM_URL`               | unset   | The deployment's own address, e.g. `https://quest-beacon-live.up.railway.app`. Unset → page only, never proxies. |
| `PROBE_TTL_MS`               | `5000`  | How long one up/down verdict is reused.                                  |
| `PROBE_TIMEOUT_MS`           | `2500`  | How long a health probe may take.                                        |
| `UPSTREAM_CONNECT_TIMEOUT_MS`| `10000` | How long a passed-through request may wait for the deployment to answer. Streams (server-sent events) are never cut once they have started. |

Own endpoint, always answered here: `GET /healthz` → `{"status":"ok","service":"beacon-front","upstream":"up"|"down"|"none"}`.

## Run locally

```bash
node homepage-offline/server.mjs                                   # page only, http://localhost:3000
UPSTREAM_URL=http://localhost:3001 node homepage-offline/server.mjs  # in front of a local BEACON
npm run test:front                                                 # tests (also part of `npm run test:coverage`, the CI gate)
```

## Railway setup (one time)

The service lives in the same Railway project as the deployment (`sunny-stillness`) and builds from
this directory. The front (`beacon-front`) builds from this repository's `main` branch; the deployment service
builds from the private monorepo this repository is exported from.

1. Create the service from the repository with **root directory `/homepage-offline`** in this
   repository (`/Phase3/homepage-offline` in the monorepo). Railway finds the `Dockerfile` and
   `railway.json` there; the `watchPatterns` in `railway.json` redeploy the front only when a file
   under `homepage-offline/` changes.
2. Give the deployment service (`Quest-BEACON`) a new generated domain name, for example
   `quest-beacon-live`, which frees the name `quest-beacon`.
3. Give this service the generated domain `quest-beacon`, so it owns
   `https://quest-beacon.up.railway.app`.
4. Set `UPSTREAM_URL=https://quest-beacon-live.up.railway.app` on this service.

The deployment keeps `APP_BASE_URL=https://quest-beacon.up.railway.app`: that is still its public
address, only now the front answers it.

Both modes work without touching this service again:

| Deployment services (Postgres, Quest-BEACON, directus) | Address shows             |
| ------------------------------------------------------ | ------------------------- |
| stopped                                                | the page                  |
| starting (database up, app migrating)                  | the page, until healthy   |
| running                                                | BEACON itself             |

If this front is itself stopped, the address answers Railway's "Application not found" page, exactly
as before this service existed.
