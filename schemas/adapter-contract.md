# BEACON — SourceAdapter Port Contract (S03)

*The TypeScript contract every data-source adapter MUST satisfy. This is the anti-corruption boundary
(ADR-001): an adapter normalizes one external format (CSV/XML/GeoJSON/ArcGIS/RSS/JSON) into the canonical
domain model and never lets a raw format leak inward (AGENTS.md §3). Every adapter carries a
last-known-good cache + recorded-mock fallback + circuit breaker so a flaky/gated source degrades
gracefully and never dead-ends the COP (Art. XV/XVI, UW2). Live/cached/mock is a config flag
(`SOURCE_<NAME>_MODE`, CONFIGURATION §6/§11). Adapters are registered via a manifest with zero core
change (FR-10, OP2/OP3).*

> Companion JSON Schemas in this directory: `source-ref.schema.json` (provenance/SourceRecord/Citation +
> API envelope), `cap-v1.2.schema.json`, `edxl-rm.schema.json`, `edxl-sitrep.schema.json`.

---

## 1. Result type (no raw throws cross the boundary)

Adapters NEVER throw upstream errors into the domain (AGENTS.md §4 error handling). They return a typed
`Result` carrying either canonical records or a typed failure, always with provenance + freshness so the
UI can render "unavailable + freshness".

```ts
export type Ok<T>  = { ok: true;  value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = AdapterError> = Ok<T> | Err<E>;

export type AdapterErrorKind =
  | "UPSTREAM_UNAVAILABLE"   // network / 5xx / timeout
  | "RATE_LIMITED"           // 429 / quota
  | "AUTH"                   // missing/invalid key
  | "PARSE"                  // ACL mapping / schema failure
  | "NOT_COVERED"            // region outside adapter coverage (OP4)
  | "CIRCUIT_OPEN"           // breaker is open; served fallback
  | "CONFIG";                // invalid/missing required config (fail-fast)

export interface AdapterError {
  kind: AdapterErrorKind;
  message: string;
  retryable: boolean;
  cause?: unknown;
}
```

## 2. Canonical record envelope (provenance is structural)

Every record an adapter emits is wrapped with its `SourceRecord` (→ `source-ref.schema.json`). Grounding
is not optional (Art. XI/XII): an adapter that returns data without provenance fails the contract test.

```ts
import type { SourceMode } from "./source-ref"; // "LIVE" | "CACHED" | "MOCK"

export interface SourceRecord {
  id: string;          // uuid
  source: string;      // "OSM Overpass"
  adapter: string;     // "osm-overpass"
  fetchedAt: string;   // ISO 8601 — the freshness anchor
  license: string;     // "ODbL"
  mode: SourceMode;    // LIVE | CACHED | MOCK
  url?: string;
  attribution?: string;
}

/** A canonical domain entity (HazardGeometry, Gauge, InfrastructureNode, …) carrying its provenance. */
export interface CanonicalRecord<T = unknown> {
  entity: T;                 // already mapped to the canonical domain model (ACL output)
  provenance: SourceRecord;  // mandatory
}

export interface FetchResult<T = unknown> {
  records: CanonicalRecord<T>[];
  freshness: string;         // newest fetchedAt across records (ISO 8601)
  mode: SourceMode;          // effective mode actually served (may differ from requested after fallback)
  degraded: boolean;         // true when served from cache/mock or a fallback rung
}
```

## 3. The SourceAdapter port

```ts
export type Region = {
  id: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat] (WGS-84)
};

export type Coverage =
  | { kind: "GLOBAL" }
  | { kind: "BBOX"; bbox: [number, number, number, number] }
  | { kind: "COUNTRIES"; iso: string[] };       // ISO-3166-1 alpha-2

export type HealthState = "CLOSED" | "OPEN" | "HALF_OPEN"; // circuit-breaker state

export interface AdapterHealth {
  state: HealthState;
  lastSuccessAt?: string;
  consecutiveFailures: number;
  lastError?: AdapterError;
}

/**
 * P1–P7,P12,P13 source ports (HazardSource, Weather, FloodGauge, Infrastructure, Outage, NewsIntel,
 * PublicReport, Population, Telecom) all extend this base contract. <T> is the canonical entity type.
 */
export interface SourceAdapterPort<T = unknown> {
  /** Stable adapter id; matches the manifest entry and SourceRecord.adapter. */
  readonly id: string;

  /** Where this adapter has data (drives OP4 "not available in this region"). */
  readonly coverage: Coverage;

  /** Effective mode for this adapter, resolved from SOURCE_<NAME>_MODE (+ region overrides). */
  readonly mode: SourceMode;

  /**
   * Fetch + anti-corruption-map records for a region. MUST:
   *  - return NOT_COVERED (not empty) when region ∉ coverage (OP4),
   *  - never throw upstream errors (return a typed Result),
   *  - go through the redundancy ladder: live → cache (last-known-good) → mock → unavailable,
   *  - stamp every record with provenance and set degraded/freshness/effective mode.
   */
  fetch(region: Region): Promise<Result<FetchResult<T>>>;

  /** Circuit-breaker + last-success snapshot for observability and the "stale" UI badge. */
  health(): AdapterHealth;

  /** Cheap liveness probe used by the breaker's HALF_OPEN trial (no full fetch). */
  ping?(): Promise<Result<true>>;
}
```

### 3.1 Mandatory redundancy behavior (every adapter)

The base behavior is provided by a shared wrapper (extracted per Rule of Three, ADR-001) so each concrete
adapter only implements `mapUpstream()` (the ACL) + the live call. The wrapper enforces:

1. **Live attempt** (`mode=LIVE`): call upstream with timeout (`LLM`/HTTP timeout analog) + bounded retry
   (exponential backoff) on retryable errors.
2. **Circuit breaker**: after N consecutive failures the breaker trips `OPEN`; calls short-circuit to the
   cache/mock path for a cooldown, then `HALF_OPEN` lets one trial through (`ping`/`fetch`).
3. **Last-known-good cache** (`CACHED` / fallback): on live failure or `mode=CACHED`, serve the most
   recent cached `FetchResult` within `CACHE_TTL_SEC`; mark `degraded=true`, keep original `freshness`.
4. **Recorded-mock fallback** (`MOCK` / final fallback): on cache miss or `mode=MOCK`, serve the recorded
   fixture from `MOCK_FIXTURES_DIR/<adapter-id>/...`; `mode=MOCK`, `degraded=true`.
5. **Unavailable**: if all rungs fail, return `Err(UPSTREAM_UNAVAILABLE)` — the API envelope then emits
   empty `provenance[]` + `meta.status="unavailable"` + last-known `freshness`. **Never a UI dead-end.**

> This realizes the Article XVI data ladder: `live → cached → mock → "unavailable + freshness"`
> (CONFIGURATION §11). The three mandatory acceptance tests (offline / primary-down / AI-off) assert it.

## 4. Anti-corruption mapping contract

The ACL is the only place a raw upstream shape exists. Contract tests (S03/S06) assert every mapped
record validates as a canonical entity with provenance (ADR-001 risk mitigation).

```ts
export interface AntiCorruptionMapper<RawShape, T> {
  /** Map ONE raw upstream element to a canonical domain entity. Pure; no I/O. */
  toCanonical(raw: RawShape, ctx: { fetchedAt: string; sourceRecordId: string }): T;
  /** Must throw/return PARSE error (never silently drop) on a shape it cannot map. */
}
```

Rules (enforced by agentic-linter + contract tests):
- The mapper output type is a **domain entity** (`src/domain/*`), never a raw DTO.
- No raw format (ArcGIS/CSV/RSS field names) appears above `src/adapters/`.
- Numbers/geometry are produced by deterministic code, never an LLM (Art. XII).
- Every emitted entity is paired with a `SourceRecord` (license + mode + fetchedAt).

## 5. Registry / manifest format (zero-core-change onboarding)

Adapters are discovered from a JSON manifest (`config/adapters.json`) at the composition root
(`src/main`), wired by the registry, and gated per region (`REGIONS_CONFIG.enabled_adapters`). Adding a
source = add a manifest entry + an adapter file implementing the port. No core edit (FR-10, OP2/OP3).

```jsonc
// config/adapters.json
{
  "$schemaVersion": "1.0",
  "adapters": [
    {
      "id": "osm-overpass",               // == SourceAdapterPort.id == SourceRecord.adapter
      "port": "Infrastructure",            // which port interface it implements (P4)
      "entity": "InfrastructureNode",      // canonical entity it produces
      "source": "OSM Overpass",            // SourceRecord.source / display name
      "license": "ODbL",                   // SourceRecord.license (tracked in NOTICE)
      "attribution": "© OpenStreetMap contributors",
      "module": "@/adapters/osm-overpass-adapter",  // dynamic import path
      "coverage": { "kind": "GLOBAL" },
      "configPrefix": "OVERPASS",          // reads SOURCE_OVERPASS_MODE / _INTERVAL_SEC / endpoint
      "defaultMode": "live",               // live | cached | mock (overridable per region)
      "intervalSecOverride": 600,          // optional poll cadence override
      "circuitBreaker": { "failureThreshold": 5, "cooldownSec": 120, "halfOpenTrials": 1 },
      "cache": { "ttlSec": 900 },
      "mock": { "fixture": "osm-overpass/lifelines.json" },
      "verifiedTier": "LIVE"               // per audit/DATA_SOURCE_VERIFICATION.md
    }
  ]
}
```

The registry validates this manifest against its own JSON Schema at boot (fail-fast, U5): every `module`
must export an adapter implementing `SourceAdapterPort`; every `port` must be a known port id; every
`configPrefix` must resolve required keys/URLs for its `defaultMode`.

## 6. Worked example — OSM Overpass adapter (Infrastructure port, P4)

Overpass returns lifeline nodes (hospitals, shelters, power, etc.) as Overpass-JSON. The adapter maps
them to canonical `InfrastructureNode` entities, stamps ODbL provenance, and degrades via cache → mock.

### 6.1 Manifest entry

See the `osm-overpass` entry in §5 above (`port: "Infrastructure"`, `coverage: GLOBAL`, `license: ODbL`,
`configPrefix: OVERPASS`).

### 6.2 Interface impl sketch

```ts
// src/adapters/osm-overpass-adapter.ts
import type {
  SourceAdapterPort, Result, FetchResult, CanonicalRecord, Region, Coverage, AdapterHealth,
} from "@/ports/source-adapter";
import type { SourceMode } from "@/domain/source-record";
import type { InfrastructureNode } from "@/domain/infrastructure-node";
import { withRedundancy } from "@/adapters/_shared/with-redundancy"; // breaker+cache+mock wrapper
import { config } from "@/main/config";

// --- Anti-corruption mapping: Overpass-JSON element -> canonical InfrastructureNode ---
type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const TAG_TO_TYPE: Record<string, InfrastructureNode["type"]> = {
  hospital: "HOSPITAL", clinic: "HOSPITAL", nursing_home: "NURSING_HOME",
  fire_station: "SHELTER", power: "POWER", tower: "CELL",
};

function mapElement(el: OverpassElement, ctx: { sourceRecordId: string }): InfrastructureNode {
  const t = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) throw { kind: "PARSE", message: `no geom for ${el.id}`, retryable: false };
  const kind = TAG_TO_TYPE[t.amenity] ?? TAG_TO_TYPE[t.power] ?? "ROAD";
  return {
    id: `osm:${el.type}/${el.id}`,
    type: kind,
    geom: { type: "Point", coordinates: [lon, lat] }, // GeoJSON, lon,lat (RFC 7946)
    status: "ONLINE",
    sourceId: ctx.sourceRecordId,
  };
}

export class OsmOverpassAdapter implements SourceAdapterPort<InfrastructureNode> {
  readonly id = "osm-overpass";
  readonly coverage: Coverage = { kind: "GLOBAL" };
  readonly mode: SourceMode = config.sourceMode("OVERPASS"); // SOURCE_OVERPASS_MODE

  async fetch(region: Region): Promise<Result<FetchResult<InfrastructureNode>>> {
    // withRedundancy supplies: timeout+retry, circuit breaker, last-known-good cache, recorded-mock,
    // provenance stamping, freshness + degraded flags. We only provide the live call + the ACL map.
    return withRedundancy<InfrastructureNode>({
      adapterId: this.id,
      source: "OSM Overpass",
      license: "ODbL",
      attribution: "© OpenStreetMap contributors",
      mode: this.mode,
      coverage: this.coverage,
      region,
      live: async (sourceRecordId): Promise<CanonicalRecord<InfrastructureNode>[]> => {
        const [s, w, n, e] = [region.bbox[1], region.bbox[0], region.bbox[3], region.bbox[2]];
        const ql = `[out:json][timeout:25];(
          node["amenity"~"hospital|clinic|nursing_home|fire_station"](${s},${w},${n},${e});
          node["power"](${s},${w},${n},${e});
        );out center;`;
        const res = await fetch(config.url("OVERPASS"), {            // endpoint from config, not hardcoded
          method: "POST", body: ql,
          signal: AbortSignal.timeout(config.timeoutMs("OVERPASS")),
        });
        if (!res.ok) throw { kind: res.status === 429 ? "RATE_LIMITED" : "UPSTREAM_UNAVAILABLE",
                             message: `overpass ${res.status}`, retryable: res.status >= 500 || res.status === 429 };
        const body = (await res.json()) as { elements: OverpassElement[] };
        return body.elements.map((el) => ({
          entity: mapElement(el, { sourceRecordId }),
          provenance: { id: sourceRecordId, source: "OSM Overpass", adapter: this.id,
                        fetchedAt: new Date().toISOString(), license: "ODbL", mode: "LIVE" },
        }));
      },
    });
  }

  health(): AdapterHealth { return withRedundancy.health(this.id); }
  async ping() { return withRedundancy.ping(this.id, config.url("OVERPASS")); }
}
```

### 6.3 Behavior under degradation (acceptance-test facing)

| Scenario | `mode` | `fetch()` result |
|---|---|---|
| Overpass up, `SOURCE_OVERPASS_MODE=live` | LIVE | mapped nodes, `degraded=false`, fresh `freshness` |
| Overpass times out (breaker still CLOSED) | LIVE→CACHED | cached nodes, `degraded=true`, original `freshness` |
| 5 consecutive failures | CIRCUIT_OPEN→CACHED/MOCK | breaker `OPEN`; serve cache then mock; `degraded=true` |
| `SOURCE_OVERPASS_MODE=mock` (offline/air-gapped) | MOCK | fixture nodes from `MOCK_FIXTURES_DIR/osm-overpass/lifelines.json` |
| Region ∉ coverage (N/A — Overpass is GLOBAL) | — | `Err(NOT_COVERED)` → layer "not available in this region" (OP4) |
| All rungs fail | — | `Err(UPSTREAM_UNAVAILABLE)` → envelope `meta.status="unavailable"` + last `freshness` |

> The offline acceptance test (`AI_MODE=off`, every `SOURCE_*_MODE=mock`, `DEPLOY_MODE=local`) drives the
> MOCK row for every adapter and must still render a usable COP with freshness labels (CONFIGURATION §11).
