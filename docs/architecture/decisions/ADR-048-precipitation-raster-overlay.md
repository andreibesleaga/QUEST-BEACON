# ADR-048 — Precipitation as a browser-fetched satellite raster overlay

**Status:** Accepted · 2026-11-21

## Context

The map had a weather layer with one observation point (wind) and no precipitation. Rain reached the
picture only indirectly: official warnings, river gauges and forecast crests. A common operating
picture for floods needs to show where it is raining, and the contest brief lists "current weather and
precipitation" among the things the interface must show.

Three constraints shaped the choice:

1. **No key, no cost, every region.** The five regions sit on three continents; a national radar
   mosaic covers one of them.
2. **Honest about what it is** (Art. XII, XVI). A satellite estimate that is hours old must not look
   like radar or like a forecast.
3. **No request from a deployment declared offline.** The air-gapped build makes no outside request,
   and the basemap already follows that rule (`style.ts`).

## Decision

1. **A fifteenth toggleable layer, `precipitation`, off by default**, drawn as a raster overlay under
   the operational layers and above the basemap.
2. **Source: NASA GPM IMERG half-hourly precipitation rate, served by NASA EOSDIS GIBS** as keyless
   Web-Mercator tiles (`IMERG_Precipitation_Rate_30min`, WMTS REST, `Access-Control-Allow-Origin: *`).
   The time slot in the tile address is `default`, which GIBS resolves to the latest half-hour it
   holds. Level 6 (about 10 km cells) is the deepest the product is published at; MapLibre over-zooms.
3. **The operator's browser fetches the tiles**, exactly as it fetches the basemap. The host is named
   in the content-security policy (`OVERLAY_HOSTS` in `next.config.mjs`). There is no server adapter
   and no row in `config/adapters.json`: the server never sees this data, computes nothing from it and
   cites it in no report, so the 45-adapter count is unchanged.
4. **A fixed caveat on every surface that names the layer**, in all 14 locales: satellite estimate,
   half-hour average, typically several hours behind, not radar, not a forecast. The required credit
   is in the map's attribution control and in `NOTICE`.
5. **Offline builds emit no descriptor** (`buildPrecipitationLayers('offline')` returns none). The
   toggle stays in the panel with its caveat and draws nothing.
6. **The overlay lives in the MapLibre style, not in the deck.gl overlay**, and is re-applied on every
   `style.load`: the basemap ladder replaces the style, which discards every source of the old one.

## Consequences

- The map shows rain for every region with no credential.
- The field is coarse and late. Measured on 2026-11-21: the newest tile was about six and a half hours
  old. For "is it raining on this street now" an agency needs its national radar; that would be a
  region-specific source behind the same layer.
- The layer has no freshness badge. The badge system describes server-side source records, and this
  layer has none; the time of the image is not known to the page. The caveat states the delay instead.
- The feature list (the keyboard and screen-reader alternative to the map) lists features, and a
  continuous field has none. The layer contributes no row there by design; its text alternative is its
  name and caveat in the layer panel (`MapFeatureList.test.tsx` records the exception).
- One more third-party host is reachable from the browser. It is the same host the satellite-imagery
  references of the vision feature already use on the server side.

## Alternatives considered

- **A precipitation value at the weather point** (Open-Meteo, MET Norway, NWS). Deterministic and
  citable, and worth adding to the report; one number at one point is not a picture of where it rains.
- **A radar mosaic** (national services, or an aggregator). Closer to real time, but regional, or
  licensed for personal use only.
- **A server adapter that proxies or caches the tiles.** It would give the layer a source record and a
  badge, at the cost of carrying imagery through the server for no computation. Left for a deployment
  that needs the tiles inside its own network.
