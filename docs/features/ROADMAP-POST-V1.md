# BEACON — Post-V1 Roadmap (scope-frozen ideas land here, not in the build)

Created 2026-08-04 at the scope-freeze decision. Each entry states
the trigger that would justify the work — nothing here blocks the contest deliverable.

## Data sources

- **GloFAS strict-WMS migration.** The JSON GetFeatureInfo façade at
  `global-flood.emergency.copernicus.eu/glofas-forecasting/wms` was decommissioned upstream (~2026-08:
  301s into the React SPA). `ows.globalfloods.eu/glofas-ows/ows.py` serves real WMS 1.3.0 — migrating
  means a proper GetFeatureInfo request (LAYERS/QUERY_LAYERS/CRS/WIDTH/HEIGHT/I/J) + a new ACL for its
  response shape. Until then: honest CACHED (`SOURCE_GLOFAS_MODE=cached`).
- **Bluesky authenticated search.** The public AppView `searchPosts` began returning 403 keyless
  (verified 2026-08-04). Live vetted-social would need an app-password session (`BLUESKY_IDENTIFIER` +
  `BLUESKY_APP_PASSWORD`) — new env, new auth flow, same corroboration-only Art. XIV posture. MOCK until then.
- **ReliefWeb live** — no code change needed: flips to `live` the day ReliefWeb approves the registered
  appname (request at apidoc.reliefweb.int/parameters#appname).
- **Census / DOT511 live** — no code change needed: flip modes once the free keys are filled in `.env`.
- **Overpass mirror ladder** — connections from some networks die mid-TLS on all public mirrors; a
  configurable mirror list (primary → kumi → lz4) inside the adapter would raise live availability.
- **WorldPop async task flow.** For region-scale polygons the stats API ignores `runasync=false` and
  returns a task handle — with raw PHP warnings appended after the JSON (verified 2026-08-04), so the
  sync LIVE rung can only ever serve small AOIs. Region-scale live needs submit → poll
  `GET /v1/tasks/{taskid}` across fetches (the adapter contract forbids an in-fetch polling loop). CACHED
  until then.
- **EAGLE-I operational feed** — `SOURCE_EAGLE_I_URL` accepts a gov/utility-supplied live endpoint;
  the public dataset remains historical-only.

## Platform

- **Cloud IdP** — the pre-minted judge-token flow (docs/CLOUD_DEPLOY_RAILWAY.md) is deliberate for the
  contest; a real OIDC IdP (per-user identities, revocation, audit-grade `sub`) is the production path.
- **PUBLIC per-IP rate buckets** — PUBLIC shares one role-keyed bucket today; per-IP needs an edge layer.
- **USGS OGC-API migration** — the partial query migration documented in the manifest notes.
