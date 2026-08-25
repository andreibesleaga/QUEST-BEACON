# BEACON — Planned (not-yet-implemented) data sources

> Companion to `config/adapters.json`. **Phase-D W1 (2026-07-15) implemented all four sources that used
> to be listed here** (`osm-overpass`, `eagle-i`, `reliefweb`, `camara-gsma`) — each now has a real
> `src/adapters/sources/<id>/<id>-adapter.ts`, a manifest row in `config/adapters.json`, and a registered
> factory in `src/main/adapter-registry.ts` (see `ADAPTER_FACTORIES` + the passing
> `adapter-registry.test.ts` boot-validation assertions). They are documented alongside the other 18 wired
> adapters in `docs/architecture/CONFIGURATION.md` §6a and `NOTICE`, not here.

## Why sources land here

`schemas/adapter-manifest.schema.json` is intentionally strict:

- `adapterEntry.mode` is an enum of exactly `LIVE | CACHED | MOCK` — there is **no `planned` value**.
- `adapterEntry` sets `"additionalProperties": false` — no `status`/`note`/`planned` field may be added.
- the manifest root sets `"additionalProperties": false` — no top-level `planned` key may be added.

The composition root also validates every manifest row at boot (F10/U5) and requires each row's
`module` to export a real `SourceAdapterPort`. Listing a source with no adapter would either be a
dishonest "this source is live" claim or a fail-fast boot error.

**Disposition (honest):** keep the manifest 1:1 with real, implemented adapters (every row maps to a
file that exists), and track genuinely-planned sources here until their adapter lands. When an adapter is
implemented, add its manifest row (one row + one file, zero core change — FR-10) and remove it below.

## What actually remains planned (genuine roadmap, as of the live-demo increment S3, 2026-08-08)

**`config/adapters.json` now carries 44 registered adapters.** The live-demo increment (S2) implemented
and registered eleven more on top of the 30 above — `mastodon`, `metno`, `anm`, `hdxpop`, `hifld`,
`eonet`, `cemsrm`, `openfema`, `caphub`, `lanceflood`, `nri` — and session 3 (S3) registered the final
three built-but-held rows (`openaq`, `airnow`, `sensorcommunity`; see the resolved hold below) — each
with a real `src/adapters/sources/<id>/<id>-adapter.ts`, a manifest row, a registered factory, and its
own acl + adapter test pair. They are documented with the other wired adapters in
`docs/architecture/CONFIGURATION.md` §6a and `NOTICE`, not here.

Three entries remain, in two distinct categories — **genuinely-planned** and **rejected** (the third
category, **built-but-held**, emptied on 2026-08-08 and its record is kept below). Only the first
category is "not done yet".

### Built-but-held — RESOLVED 2026-08-08 (S3): the AirQuality trio is now registered AND consulted

The `openaq` · `airnow` · `sensorcommunity` trio (AirQuality port, P17) sat here from S2 because fitness
function **F-52** forbids enabling a manifest port that no assembly consults ("nothing is enabled that no
assembly consults"), and nothing consumed an AirQuality slice. **The consumer now exists**: `derive-cop`'s
deterministic, cited air-quality threshold fact (`airQualityFact` — a source-published AQI at/above
UNHEALTHY-FOR-SENSITIVE-GROUPS, or a concentration-only PM2.5 reading at/above the fixed 35.5 µg/m³
constant, never a derived category), fed by `live-seed.ts`'s new incident-only `airQuality` slot. The
trio registered the same day the consumer landed — one manifest row each plus their `ADAPTER_FACTORIES`
entries — exactly as this file promised. Enablement is coverage-honest: `airnow` (North America BBOX) on
`us-ca` only; `sensorcommunity` (dense EU) leads on `ro`/`es`/`gr`; `openaq` (global aggregator, CACHED —
LIVE needs `OPENAQ_API_KEY`) is the fallback rung everywhere and `ph`'s only rung.

### Genuinely planned (no adapter written)

| id | port | source | verified tier | catalog ref | notes |
|---|---|---|---|---|---|
| `ipaws` | AlertSink | FEMA IPAWS | — | audit §10 | Live origination needs FEMA authority/MOU — out of scope for this program (`IPAWS_ENABLED=off` documents the gate). Not a data-availability problem; a legal-authority one. |
| `floodhub` | FloodGauge | Google FloodHub | MOCK | audit §10 | Waitlist-gated; demo-mocked until access is granted. |

### Rejected on licence (will not be implemented)

| id | port | source | disposition |
|---|---|---|---|
| `outageproxy` | Outage | Cloudflare Radar outages + Georgia Tech **IODA** | **REJECTED 2026-08-08.** The adapter was written and unit-tested, then **deleted unregistered**. IODA is a public, keyless API, but every response carries "Copyright © 2021-2025 Georgia Tech Research Corporation. All Rights Reserved." with **no open-licence grant** — failing the free/open-data-with-compatible-terms rule (Art. IX; AGENTS §9 makes an unconfirmed source licence an explicit HITL trigger, and the entrant's ruling was to drop it). Its `SOURCE_OUTAGEPROXY_MODE` / `CLOUDFLARE_RADAR_TOKEN` env rows were removed rather than left inert, so no flag survives implying a rung that does not exist. Consequence, stated honestly: **non-US regions have no feed-based outage signal at all** — Romania's outage layer carries only the hazard∩infrastructure "derived / assumed-offline" computation and says "no live power-outage feed for this region" (`docs/SPEC.md` §4.2). |

Neither planned entry blocks a Phase-2 portal claim. Each `.env.example` `SOURCE_<ID>_MODE` line for a
still-planned id stays an **inert placeholder** (documented, no adapter) until its adapter lands; ids that
are now wired carry a `WIRED` comment instead, and rejected ids carry no flag at all.

## NOT a source adapter (by design)

**Sentinel-2 burn-area NBR** (portal claim: satellite burn-severity) is deliberately **not** implemented
as a `SourceAdapterPort` — it lands as a `VisionPort` task instead (`VisionRequest.task = 'burn-area'` in
`src/ports/intel.ts`), analyzing a consented imagery fixture via the vision ladder
(`src/adapters/ai/vision/vision-adapter.ts`), advisory-only and cited (never auto-alerts, Article XII).
See `../docs/audit/PHASE3-FULL-DELIVERY-PLAN.md` W4c (implemented, archived). `SOURCE_SENTINEL2_MODE` in `.env.example` stays a documented,
inert placeholder for this reason, not because an adapter is missing.

Each newly-implemented row above will register with the same field set as the existing rows once built
(module path `@/adapters/sources/<id>/<id>-adapter`, coverage, mode, `intervalSec`, `license`,
cache/breaker/mock blocks, `verifiedTier`) — one row + one file, zero core change (FR-10).
