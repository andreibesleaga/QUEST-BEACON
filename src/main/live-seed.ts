// BEACON — adapter→derivation-input bridge (Phase-B B1 → MW-B B1.8; ADR-031 region-generic composition;
// Art. XVI redundancy ladder, F1 provenance, Art. XII). The OPT-IN live path: it takes the hand-seeded
// CoreSeed / map-input seed (the offline default) and swaps in the slices a wired source adapter can
// actually supply, RETAINING every slice no adapter serves (hybrid scope — the honest one).
//
// ONE GENERIC, COVERAGE-DRIVEN PATH (B1.8 — no per-region code). Three config inputs replace what used to
// be four hand-written per-region functions and a region-id dispatch:
//   1. WHICH adapters a region consults = its config/regions.json `enabled_adapters` allowlist, and the
//      ARRAY ORDER IS THE PRECEDENCE ORDER (ADR-012: a region's source precedence is region CONFIG data,
//      not a literal in a use-case). First-serving wins each single-value slot; every consulted adapter is
//      still cited in provenance, in that same order.
//   2. WHICH domain slot a slice merges into = the adapter's `port` in config/adapters.json, routed by the
//      EXHAUSTIVE SLOT_BY_PORT table below (`Record<PortName, Slot>` — the EXPOSURE_BEARING_BY_KIND
//      mechanism: an unrouted port is a compile error, never silent droppage), and SLOT_PATHS says which
//      assembly (SitRep incident / COP map) consumes that slot.
//   3. COVERAGE does the filtering, not an `if`: an adapter that does not cover the region returns
//      NOT_COVERED and is skipped (never labelled), and the enforced allowlist (B1.3) keeps it out of the
//      region's registry entirely — two independent reasons the wrong region's data can never appear.
// Adding a zone is therefore ONE regions.json entry — zero code (FR-ZONE-3). Provenance is rebuilt from
// each adapter's FetchResult (mode-labelled LIVE/CACHED/MOCK, never fabricated); a primary-down adapter
// keeps its slice seeded/cached + degraded and NEVER empties it (Art. XVI).
// Called only by build-core's opt-in buildCoreLive/buildInteractionLive (DATA_SOURCE_COMPOSITION=adapters).
import type { HazardGeometry } from '@/domain/hazard-geometry.js';
import type { CameraFeed } from '@/domain/camera-feed.js';
import type { Gauge } from '@/domain/gauge.js';
import type { InfrastructureNode } from '@/domain/infrastructure-node.js';
import type { FloodZone } from '@/domain/flood-zone.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { CitationId, InfrastructureNodeId, SourceId } from '@/domain/value-objects/ids.js';
import type { BBox, Geometry, Position } from '@/domain/value-objects/geo.js';
import type { WeatherObservation } from '@/ports/data-sources.js';
import type { AirQualityReading } from '@/ports/air-quality.js';
import type { NewsItem } from '@/ports/intel.js';
import type { OutageRecord, PopulationEstimate, TelecomCoverage } from '@/ports/infrastructure-sources.js';
import type { SourceRef } from '@/ports/interaction.js';
import type { SourceView } from '@/application/interaction/command-router.js';
import type { FetchResult, Region, SourceAdapterPort } from '@/adapters/_shared/index.js';
import type { LoadedRegion, RegionRegistry } from '@/adapters/persistence/region-registry.js';
import { findRegion } from '@/adapters/persistence/region-registry.js';
import type { CoreSeed, IncidentSeed } from '@/adapters/memory/memory-core.js';
import type { MapInputsSeed } from '@/adapters/memory/memory-map.js';
import type {
  AirQualityFactInput,
  FactGrounding,
  CrestFactInput,
  CrestReading,
  IncidentDerivationInput,
  MapDerivationInput,
  WeatherFactInput,
} from '@/application/derivation/derive-cop.js';
import { loadManifest } from './adapter-registry.js';

type Registry = ReadonlyMap<string, SourceAdapterPort>;
type Bbox = readonly [number, number, number, number];

// ISO codes and bounding boxes come from config/regions.json ONLY (ADR-031). The hardcoded ISO map and the
// duplicated fallback bboxes that used to live here were removed: they made "add a region by config" untrue
// for any third country, and the bbox fallback silently substituted CALIFORNIA's geography for an unknown
// region — i.e. it would have drawn one region's hazards over another's map (finding F-06). The per-region
// source-id lists (CA_NEWS_IDS/RO_NEWS_IDS, the camera priority arrays, the four enrich* fetch sequences)
// went the same way in B1.8: they are `enabled_adapters`, in order.

/** One adapter slice: mapped entities + a mode-labelled provenance ref, plus whether it served / is covered. */
interface Slice<T> {
  readonly entities: readonly T[];
  readonly ref?: SourceRef; // present only when the adapter served a response
  readonly covered: boolean; // false ⇒ NOT_COVERED (skip + do not label)
  readonly served: boolean; // true ⇒ real data returned (may be a degraded rung)
}

interface NamedSlice {
  readonly id: string;
  readonly slice: Slice<unknown>;
}

/** Build a SourceRef from a served FetchResult (F1): the effective mode + newest freshness, keyed by adapter id. */
function toRef(id: string, fr: FetchResult): SourceRef {
  return { sourceId: id, mode: fr.mode, fetchedAt: fr.freshness };
}

/**
 * Newest fetchedAt across the assembled provenance (the slice's freshness); falls back to the assembly clock.
 * Compares PARSED instants (not raw ISO strings) so a differing offset/precision can't misorder timestamps.
 */
function freshnessOf(refs: readonly SourceRef[], fallback: string): string {
  let newest: string | undefined;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const r of refs) {
    const ms = Date.parse(r.fetchedAt);
    if (Number.isFinite(ms) && ms > newestMs) {
      newestMs = ms;
      newest = r.fetchedAt;
    }
  }
  return newest ?? fallback;
}

/**
 * Fetch one adapter's slice through the redundancy ladder. NEVER throws: an Err — or an adapter that throws
 * an unexpected runtime error (parse failure, etc.) — degrades to an unserved slice, so the seeded/cached
 * provenance is retained and the whole live assembly is never broken by one flaky source (Art. XVI).
 */
async function fetchSlice<T>(registry: Registry, id: string, region: Region): Promise<Slice<T>> {
  const adapter = registry.get(id) as SourceAdapterPort<T> | undefined;
  if (adapter === undefined) return { entities: [], covered: false, served: false };
  try {
    const res = await adapter.fetch(region);
    if (res.ok) {
      return { entities: res.value.records.map((r) => r.entity), ref: toRef(id, res.value), covered: true, served: true };
    }
    return { entities: [], covered: res.error.kind !== 'NOT_COVERED', served: false };
  } catch {
    // Unexpected throw ⇒ treat as covered-but-unserved (primary down) → keep the seeded/cached slice.
    return { entities: [], covered: true, served: false };
  }
}

/**
 * Rebuild provenance from the attempted slices (F1, Art. XVI): a served slice contributes its mode-labelled
 * ref; a covered-but-unserved slice (primary down) falls back to the seeded ref for that source (degraded
 * label); a NOT_COVERED slice is skipped. Never returns empty — falls back to the seed's provenance.
 */
function collectProvenance(named: readonly NamedSlice[], baseRefs: readonly SourceRef[]): readonly SourceRef[] {
  const out: SourceRef[] = [];
  for (const { id, slice } of named) {
    if (slice.ref !== undefined) {
      out.push(slice.ref);
    } else if (slice.covered) {
      const fallback = baseRefs.find((r) => r.sourceId === id);
      if (fallback !== undefined) out.push(fallback); // primary down → keep seeded/cached label (degraded)
    }
  }
  return out.length > 0 ? out : baseRefs;
}

/**
 * The adapter-query view of a configured region: its id, its bbox, and its ISO code — all read from the
 * region registry, never invented. Substituting another region's bounding box would query the wrong part of
 * the planet and render the result as if it were local (finding F-06), so an unconfigured region has no
 * honest default: `findRegion` returns undefined and the caller keeps the hand-seeded, labelled picture
 * (Art. XVI: degrade, never mislead). The config-id lookup itself lives ONCE, in the region registry
 * (`findRegion`) — this module used to carry a private duplicate of it (finding F-55).
 */
function regionQuery(loaded: LoadedRegion): Region {
  const { bbox, iso } = loaded.region;
  return { id: loaded.configId, bbox: bbox as Bbox, ...(iso !== undefined ? { iso } : {}) };
}

/**
 * Surface the winning weather source's wind reading in the (seeded, grounded) weather fact; keep the labels.
 * The fact is RE-ATTRIBUTED to the source that actually supplied the number: `grounding.sourceId` becomes the
 * GroundedFact's `sourceId`, i.e. the citation the SitRep shows (derive-cop.ts weatherFact), so leaving the
 * seeded attribution in place while a FALLBACK source supplies the figure would cite Open-Meteo for an NWS
 * reading — a fabricated attribution (Art. XII, F1). Before B1.8 only one weather source was ever consulted
 * per region, so the seeded label happened to be right; now that a secondary weather source can step in for a
 * downed primary (Art. XVI), the label has to follow the data. `citationId` is the stable id of the weather
 * field's citation, not a source identifier, so it is retained. Nothing served ⇒ the seeded fact is untouched.
 */
function updateWeather(weather: WeatherFactInput | undefined, wx: NamedSlice | undefined): WeatherFactInput | undefined {
  if (weather === undefined || wx === undefined) return weather;
  const entities = wx.slice.entities as readonly WeatherObservation[];
  if (!wx.slice.served || entities.length === 0) return weather;
  const ms = entities[0]!.windSpeedMs;
  if (ms === undefined) return weather;
  return {
    ...weather,
    input: { ...weather.input, speedKmh: Math.round(ms * 3.6) },
    grounding: { ...weather.grounding, sourceId: asId<SourceId>(wx.id) },
  };
}

/**
 * The served gauge's reading, in the shape the crest fact states it. Every figure is carried ONLY when the
 * source published it, and the two unit-bearing ones (`stage`/`crestForecast`) only when the adapter's
 * `gaugeUnit` is configured too: `Gauge` carries plain numbers whose unit differs per source (NWPS/USGS
 * publish feet, GloFAS a peak discharge in m³/s), and a figure without its unit is not a labeled figure
 * (Art. XII). `returnPeriodLabel` is NOT carried forward from the seed — no `Gauge` has a return period, so
 * keeping the seed's "2-year" beside another source's category would attach a threshold the server never
 * stated. The claim simply loses that clause (derive-cop `crestHeadline`).
 */
function crestReadingOf(gauge: Gauge, unit: string | undefined): CrestReading {
  const unitBearing = unit === undefined ? {} : {
    ...(gauge.stage !== undefined ? { stage: gauge.stage } : {}),
    ...(gauge.crestForecast !== undefined ? { crestForecast: gauge.crestForecast } : {}),
    readingUnitLabel: unit,
  };
  return {
    floodCategory: gauge.floodCategory.toLowerCase(),
    ...unitBearing,
    ...(gauge.crestTime !== undefined ? { crestTime: gauge.crestTime } : {}),
    ...(gauge.exceedanceProbability !== undefined ? { exceedanceProbability: gauge.exceedanceProbability } : {}),
  };
}

/**
 * Surface the winning FloodGauge source's reading in the (seeded, grounded) crest fact — the crest twin of
 * `updateWeather`, and the closure of findings F-66(a)/F-93: the `gauges` slot was already consulted and
 * CITED on the incident path (SLOT_PATHS.gauges.incident), while the stage/crest it served never reached the
 * SitRep at all. Romania's gauge was cited for a fact none of its numbers had entered.
 *
 * F-64 is binding here exactly as it was for the weather fact: `grounding.sourceId` becomes the SitRep
 * `GroundedFact`'s `sourceId` (derive-cop `crestFact`), so leaving the seeded attribution in place while a
 * FALLBACK rung supplies the reading would cite NWPS for a USGS number — a wrong citation on a right number,
 * which is the precise failure the provenance guarantee exists to prevent. The fact is therefore
 * RE-ATTRIBUTED to whichever adapter actually served (unchanged when the primary serves). `citationId` is
 * retained: it is the stable id of the crest field's citation, not a source identifier.
 *
 * Nothing served ⇒ the seeded fact is untouched (Art. XVI). No seeded crest fact ⇒ nothing is invented: a
 * wildfire incident does not gain a crest claim because a global gauge source happened to answer.
 */
function updateCrest(crest: CrestFactInput | undefined, gauge: NamedSlice | undefined): CrestFactInput | undefined {
  if (crest === undefined || gauge === undefined) return crest;
  const entities = gauge.slice.entities as readonly Gauge[];
  if (!gauge.slice.served || entities.length === 0) return crest;
  return {
    input: crestReadingOf(entities[0]!, manifestIndex().gaugeUnits.get(gauge.id)),
    grounding: { ...crest.grounding, sourceId: asId<SourceId>(gauge.id) },
  };
}

// ── Phase-D slice helpers (Art. XVI: an unserved/NOT_COVERED slice retains the seeded value; a served slice
//    replaces it — never a dead-end). All deterministic (no clock/network); the LLM never touches them. ──────

/** Flatten the served news slices' items — the region-scoped batch handed to the deterministic news-grounding
 *  pass (W2c) via IncidentSeed.news → IncidentView.news → SitRepFacts.news. Only NewsIntel-port slices are
 *  ever routed to the `news` slot (SLOT_BY_PORT), so the entity cast is contained here. */
function newsItemsOf(named: readonly NamedSlice[]): readonly NewsItem[] {
  return named.flatMap((n) => (n.slice.served ? (n.slice.entities as readonly NewsItem[]) : []));
}

/** Replace a base value with a served slice's mapped output; retain the base when the slice did not serve. */
function servedOr<T, U>(slice: Slice<T>, map: (entities: readonly T[]) => U, base: U): U {
  return slice.served && slice.entities.length > 0 ? map(slice.entities) : base;
}

/**
 * Merge a HOTSPOT source (FIRMS — global fire hotspots, never perimeters) with a PERIMETER source
 * (NIFC US / EFFIS EU-global — official fire perimeters, never hotspots) into one hazards slice, so the
 * COP carries BOTH (closing the "FIRMS ≠ perimeters" gap). Art. XVI: neither seeded portion is dropped —
 * a served source REPLACES its own kind's seeded geometries; an unserved/down/NOT_COVERED source RETAINS
 * them. The seed's PERIMETER portion is replaced only by the perimeter source (never silently by FIRMS),
 * and its non-perimeter portion (hotspots on CA, FLOOD_REACH on RO) only by the hotspot source. Perimeters
 * are placed first to preserve the seed's ordering (perimeter → hotspots).
 */
function mergeHazards(
  base: readonly HazardGeometry[],
  hotspots: Slice<HazardGeometry>,
  perimeters: Slice<HazardGeometry>,
): readonly HazardGeometry[] {
  const perims = servedOr(perimeters, (e) => e, base.filter((h) => h.kind === 'PERIMETER'));
  const rest = servedOr(hotspots, (e) => e, base.filter((h) => h.kind !== 'PERIMETER'));
  return [...perims, ...rest];
}

/** A [lon,lat] from a Point geometry, else undefined (non-point nodes are skipped, not faked). */
function pointOf(geom: Geometry): Position | undefined {
  return geom.type === 'Point' ? geom.coordinates : undefined;
}

/** Whether a point lies within a [minLon,minLat,maxLon,maxLat] bbox (inclusive) — used for outage∩infra. */
function bboxContains(area: BBox, pos: Position): boolean {
  return pos[0] >= area[0] && pos[0] <= area[2] && pos[1] >= area[1] && pos[1] <= area[3];
}

/**
 * EAGLE-I OutageRecord[] → the ids of infra nodes falling inside an outage area, marked ASSUMED offline
 * (an INFERENCE — hazard/outage ∩ infra — not an observed node status; labelled honestly downstream).
 * Retains any seeded `base` ids when EAGLE-I did not serve (US-only ⇒ skipped for RO).
 */
function pickOutageNodeIds(
  nodes: readonly InfrastructureNode[],
  outages: Slice<OutageRecord>,
  base: readonly InfrastructureNodeId[] | undefined,
): readonly InfrastructureNodeId[] {
  if (!outages.served || outages.entities.length === 0) return base ?? [];
  const ids: InfrastructureNodeId[] = [];
  for (const node of nodes) {
    const pos = pointOf(node.geom);
    if (pos !== undefined && outages.entities.some((o) => bboxContains(o.area, pos))) ids.push(node.id);
  }
  return ids;
}

/** WorldPop/Census PopulationEstimate → a single exposed-population count. */
function sumPopulation(slice: Slice<PopulationEstimate>): number | undefined {
  if (!slice.served || slice.entities.length === 0) return undefined;
  return Math.round(slice.entities.reduce((sum, p) => sum + p.count, 0));
}

/**
 * The exposed-population count: the HIGHEST-PRECEDENCE served population source, else the seeded planning
 * number (Art. XVI — never a dead-end). Precedence is the region's `enabled_adapters` order, which is how
 * "US Census before WorldPop" stopped being a hardcoded preference in this use-case and became region
 * config (ADR-012): `us-ca` lists `census` ahead of `worldpop`, a region with only WorldPop just lists it.
 */
function choosePopulation(base: number, slices: readonly NamedSlice[]): number {
  for (const { slice } of slices) {
    const count = sumPopulation(slice as Slice<PopulationEstimate>);
    if (count !== undefined) return count;
  }
  return base;
}

/**
 * Population grounding, minted ONLY when a population source actually served (S3 sweep, 2026-08-08 —
 * F-66(b) had quietly reopened: `choosePopulation` swapped the figure while `populationGrounding` was
 * never set by ANY production path, so `populationFact` never fired and a served census/WorldPop number
 * rode UNCITED inside the exposure/impact claims — a wrong-citation-on-a-right-number provenance failure).
 * Mirrors `airQualityInputOf`: `sourceId` = the FIRST-SERVING adapter — by construction the same adapter
 * whose count `choosePopulation` returns, since both walk the same precedence-ordered slice list — and the
 * citation id is deterministic per adapter. A SEEDED figure stays ungrounded (no fact): the seed's
 * planning number is not a source observation, and minting a citation for it would be the F-64 defect in
 * reverse. (`populationEstimates`/the zonal-area ladder remain test-only — recorded in the register, not
 * silently wired here: feeding them would CHANGE the affected figure, which is its own reviewed change.)
 */
function populationGroundingOf(populations: readonly NamedSlice[]): FactGrounding | undefined {
  for (const { id, slice } of populations) {
    if (sumPopulation(slice as Slice<PopulationEstimate>) !== undefined) {
      return {
        field: 'population',
        sourceId: asId<SourceId>(id),
        citationId: asId<CitationId>(`cit-population-${id}`),
      };
    }
  }
  return undefined;
}

/** The first served observation (Open-Meteo/NWS wind), else the seeded observation — the raw W2b projects. */
function firstServedOr(wx: Slice<WeatherObservation>, base: WeatherObservation | undefined): WeatherObservation | undefined {
  return wx.served && wx.entities.length > 0 ? wx.entities[0] : base;
}

/** A layer→sourceId attribution stamped only when that source served (retains the seeded base otherwise). */
interface LayerStamp {
  readonly layer: string;
  readonly slice: Slice<unknown>;
  readonly id: string;
}

function buildLayerSources(
  base: Readonly<Record<string, string>> | undefined,
  stamps: readonly LayerStamp[],
): Readonly<Record<string, string>> | undefined {
  const out: Record<string, string> = { ...(base ?? {}) };
  for (const s of stamps) {
    if (s.slice.served && s.slice.entities.length > 0) out[s.layer] = s.id;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Merge the served camera sets (multi-source layer) into one deduped slice, retaining the seeded pins when NO
 * source served (Art. XVI). Served sets are concatenated in priority order; a defensive dedupe-by-id drops any
 * collision (the same physical camera surfaced by two directories) so a pin is never plotted twice.
 * E11 Live Views: the `cameras` layer is MULTI-SOURCE (Caltrans + ALERTWildfire + 511 + Windy on CA; CNADNR +
 * Windy on RO) and its priority order is now the region's `enabled_adapters` order, not a literal here.
 */
function mergeCameras(base: readonly CameraFeed[] | undefined, sources: readonly NamedSlice[]): readonly CameraFeed[] | undefined {
  const served = sources.filter((s) => s.slice.served && s.slice.entities.length > 0);
  if (served.length === 0) return base; // every source unserved/NOT_COVERED ⇒ keep the seeded pins
  const seen = new Set<string>();
  const out: CameraFeed[] = [];
  for (const s of served) {
    for (const cam of s.slice.entities as readonly CameraFeed[]) {
      if (!seen.has(cam.id)) { seen.add(cam.id); out.push(cam); }
    }
  }
  return out;
}

// ── B1.8: port → slot routing (the table that replaced the four bespoke enrich* functions) ──────────────

/**
 * Every `port` declared in config/adapters.json. Closed union ⇒ SLOT_BY_PORT below MUST cover it (Gate 2).
 * A manifest row whose port is NOT listed here is not routed anywhere and is therefore never consulted —
 * that is loud, not silent: `live-seed.test.ts` asserts every port in the shipped manifest is routed.
 */
const PORT_NAMES = [
  'HazardSource', 'Weather', 'FloodGauge', 'NewsIntel', 'Infrastructure',
  'Population', 'FloodZone', 'Outage', 'Telecom', 'CameraDirectory', 'AirQuality',
] as const;
type PortName = (typeof PORT_NAMES)[number];

/** The domain slot a port's slices merge into (the seam the per-slot merge helpers above operate on). */
type Slot =
  | 'hazards' | 'weather' | 'gauges' | 'infrastructure' | 'population'
  | 'outages' | 'news' | 'cellSites' | 'floodZones' | 'cameras' | 'airQuality';

/**
 * PORT → SLOT. Exhaustive by type: a new port cannot be added to PORT_NAMES without deciding which domain
 * slot it feeds, so a slice can never be silently dropped (the mechanism B2.3 used for
 * EXPOSURE_BEARING_BY_KIND — make the unhandled case a compile error, not a runtime shrug).
 */
const SLOT_BY_PORT: Readonly<Record<PortName, Slot>> = {
  HazardSource: 'hazards',
  Weather: 'weather',
  FloodGauge: 'gauges',
  NewsIntel: 'news',
  Infrastructure: 'infrastructure',
  Population: 'population',
  FloodZone: 'floodZones',
  Outage: 'outages',
  Telecom: 'cellSites',
  CameraDirectory: 'cameras',
  AirQuality: 'airQuality',
};

/** The two assemblies a slot can feed. */
type PathKind = 'incident' | 'map';

/**
 * Which assembly consumes which slot — exhaustive, so a new slot must state both answers.
 *  • `incident` = the SitRep/CoreSeed path, whose provenance IS the per-region source list GET /status
 *    shows. It consults every slot that can change a SitRep fact, PLUS the two that only describe the
 *    region's data situation (`gauges`, and the hazard EVENT feeds inside `hazards`): they are consulted
 *    and cited, never silently used.
 *  • `map` = the COP map path, which consults exactly the slots that paint a map layer (or back one up).
 *    `news`/`population` are deliberately NOT consulted there — no map layer renders them, and citing a
 *    source the map does not use would inflate the map's source list (this is why the camera/telecom/
 *    floodzone slots are symmetrically absent from the incident path: /status stays SitRep-scoped).
 */
const SLOT_PATHS: Readonly<Record<Slot, Readonly<Record<PathKind, boolean>>>> = {
  hazards: { incident: true, map: true },
  weather: { incident: true, map: true },
  gauges: { incident: true, map: true },
  infrastructure: { incident: true, map: true },
  population: { incident: true, map: false },
  outages: { incident: true, map: true },
  news: { incident: true, map: false },
  cellSites: { incident: false, map: true },
  floodZones: { incident: false, map: true },
  cameras: { incident: false, map: true },
  // S3: air quality feeds ONE SitRep threshold fact (derive-cop airQualityFact) — no map layer renders it,
  // so citing it in the MAP's source list would claim provenance for a layer it does not back (the same
  // reasoning as news/population above). Incident-only, cited on GET /status.
  airQuality: { incident: true, map: false },
};

/**
 * The map LAYER each slot's chosen source badges (W3a per-layer freshness), in STAMP order; `null` = the
 * slot paints no layer. Exhaustive by type, and the declaration order is the stamp order, so one table
 * carries both facts. The `fire` badge is stamped from the HOTSPOT source specifically (see hazardBuckets):
 * the near-real-time hotspot feed is the freshest driver of fire-layer freshness, while perimeters lag
 * hours/days — the perimeter source's attribution is not lost, it rides on each PERIMETER geometry.
 */
const LAYER_BY_SLOT: Readonly<Record<Slot, string | null>> = {
  hazards: 'fire',
  gauges: 'flood',
  infrastructure: 'infra',
  outages: 'outage',
  cellSites: 'cell',
  floodZones: 'floodzone',
  weather: 'weather',
  cameras: 'cameras',
  population: null,
  news: null,
  airQuality: null, // SitRep fact only — paints no map layer (SLOT_PATHS: incident-only)
};

/**
 * The HazardSource adapters that supply hazard FOOTPRINTS (geometry the COP draws and exposure is computed
 * against). Everything else on that port — GDACS today — is an EVENT/ALERT feed whose geometry is an event
 * CENTROID, not a footprint: it is consulted and cited (so /status shows it was asked), but it never enters
 * the hazards slice, because a point rendered as a hazard extent would understate exposure and overstate
 * precision (Art. XII; the same advisory-vs-footprint distinction as finding F-48).
 *
 * This is the ONE place adapter ids still appear, and it is a per-ADAPTER classification, not a per-REGION
 * one: adding a zone needs no edit here. It exists only because `port` alone cannot distinguish a footprint
 * source from an advisory feed — ADR-031 §1 specifies a manifest `role` field that would move it into
 * config/adapters.json; until that lands, `live-seed.test.ts` fails if a new HazardSource row is unclassified.
 * An unlisted HazardSource defaults to EVENT (cited, never drawn) — the safe direction (Art. XII).
 */
const HAZARD_FOOTPRINT_SOURCES: ReadonlySet<string> = new Set(['firms', 'nifc', 'effis']);

/**
 * The two per-adapter lookups this module needs from config/adapters.json (ADR-012 — both are CONFIG, not
 * literals here): the port that routes a slice to its domain slot, and, for FloodGauge adapters, the unit
 * the source publishes its stage/crest figures in.
 */
interface ManifestIndex {
  readonly ports: ReadonlyMap<string, string>;
  readonly gaugeUnits: ReadonlyMap<string, string>;
}

let MANIFEST_INDEX: ManifestIndex | undefined;

/**
 * The id→port / id→gaugeUnit lookups, from config/adapters.json, read + validated once (config is immutable
 * at runtime). A manifest that cannot be read/validated yields EMPTY maps ⇒ nothing is routed ⇒ every slice
 * keeps its hand-seeded, honestly-labelled value rather than the assembly throwing (Art. XVI). In practice
 * buildAdapterRegistry has already failed fast by then and live-composition has fallen back to the offline
 * seed. An adapter with no `gaugeUnit` row is not defaulted to some plausible unit: its numeric readings are
 * carried as absent instead, because guessing feet-vs-metres on a river is worse than omitting the figure.
 */
function manifestIndex(): ManifestIndex {
  if (MANIFEST_INDEX === undefined) {
    const res = loadManifest();
    const rows = res.ok ? res.value.adapters : [];
    MANIFEST_INDEX = {
      ports: new Map<string, string>(rows.map((a) => [a.id, a.port])),
      gaugeUnits: new Map<string, string>(
        rows.flatMap((a) => (a.gaugeUnit !== undefined ? [[a.id, a.gaugeUnit] as const] : [])),
      ),
    };
  }
  return MANIFEST_INDEX;
}

function adapterPorts(): ReadonlyMap<string, string> {
  return manifestIndex().ports;
}

function isPortName(port: string): port is PortName {
  return (PORT_NAMES as readonly string[]).includes(port);
}

/** One adapter to consult, and the slot its slice feeds. */
interface Consultation {
  readonly id: string;
  readonly slot: Slot;
}

/**
 * Whether this adapter can fill this slot IN THIS ASSEMBLY. Exactly one case needs the distinction: the map
 * consults hazard FOOTPRINT sources (their geometry paints the hazard layer) but not the hazard EVENT feeds —
 * a GDACS event centroid paints nothing on the map, so citing it in the MAP's source list would claim
 * provenance for a layer it does not back. The SitRep path does consult it: that provenance IS the region's
 * source list behind GET /status, where "GDACS was asked, and here is its mode/freshness" is the honest entry.
 */
function fillsSlot(id: string, slot: Slot, path: PathKind): boolean {
  return !(path === 'map' && slot === 'hazards' && !HAZARD_FOOTPRINT_SOURCES.has(id));
}

/**
 * The region's consultation plan for one assembly: its `enabled_adapters`, IN ORDER (= precedence), each
 * mapped through port→slot and filtered to the slots this assembly consumes. An allowlisted id with no
 * manifest row grants nothing (it has no port, so it routes nowhere) — exactly as buildAdapterRegistry
 * treats it; the regions↔manifest drift-guard test is the enforcement point for that typo, not a crash.
 */
function consultationPlan(
  enabled: readonly string[],
  ports: ReadonlyMap<string, string>,
  path: PathKind,
): readonly Consultation[] {
  const out: Consultation[] = [];
  for (const id of enabled) {
    const port = ports.get(id);
    if (port === undefined || !isPortName(port)) continue;
    const slot = SLOT_BY_PORT[port];
    if (SLOT_PATHS[slot][path] && fillsSlot(id, slot, path)) out.push({ id, slot });
  }
  return out;
}

/** The fetched slices of one assembly: the full ordered list (provenance) + the per-slot precedence lists. */
interface Consulted {
  readonly named: readonly NamedSlice[];
  readonly bySlot: ReadonlyMap<Slot, readonly NamedSlice[]>;
}

/**
 * Fetch every planned adapter, IN PRECEDENCE ORDER. Sequential on purpose: one region's adapters share ONE
 * RedundancyEngine, so a concurrent fan-out would race its per-source breaker/last-known-good state (the
 * same reason live-composition assembles region-by-region). Never throws — fetchSlice degrades instead.
 */
async function consult(registry: Registry, region: Region, plan: readonly Consultation[]): Promise<Consulted> {
  const named: NamedSlice[] = [];
  const bySlot = new Map<Slot, NamedSlice[]>();
  for (const { id, slot } of plan) {
    const entry: NamedSlice = { id, slice: await fetchSlice(registry, id, region) };
    named.push(entry);
    const bucket = bySlot.get(slot);
    if (bucket === undefined) bySlot.set(slot, [entry]);
    else bucket.push(entry);
  }
  return { named, bySlot };
}

/** An adapter-less slot: nothing served, nothing covered ⇒ every consumer retains its seeded value. */
const UNSERVED: Slice<never> = { entities: [], covered: false, served: false };

function slotSlices(c: Consulted, slot: Slot): readonly NamedSlice[] {
  return c.bySlot.get(slot) ?? [];
}

/** The first slice that actually SERVED data for a slot — precedence order, so this is the winning source. */
function firstServing(slices: readonly NamedSlice[]): NamedSlice | undefined {
  return slices.find((n) => n.slice.served && n.slice.entities.length > 0);
}

/** A slot's winning slice, typed for its consumer (only that port's adapters are ever routed to the slot). */
function sliceOf<T>(named: NamedSlice | undefined): Slice<T> {
  return (named?.slice ?? UNSERVED) as Slice<T>;
}

/**
 * Split the hazard slot into the two buckets mergeHazards merges: the winning PERIMETER source and the
 * winning HOTSPOT source. Classification is by what the adapter actually RETURNED (a slice containing a
 * PERIMETER geometry is that region's perimeter source, everything else is a hotspot/extent source), which
 * keeps EFFIS honest: it serves polygons (perimeters) for one region and points (hotspots) for another and
 * is treated as what it served, not as what a table guessed. EVENT feeds are excluded entirely.
 */
function hazardBuckets(slices: readonly NamedSlice[]): {
  readonly hotspots: NamedSlice | undefined;
  readonly perimeters: NamedSlice | undefined;
} {
  const footprints = slices.filter(
    (n) => HAZARD_FOOTPRINT_SOURCES.has(n.id) && n.slice.served && n.slice.entities.length > 0,
  );
  const hasPerimeter = (n: NamedSlice): boolean =>
    (n.slice.entities as readonly HazardGeometry[]).some((h) => h.kind === 'PERIMETER');
  return { perimeters: footprints.find(hasPerimeter), hotspots: footprints.find((n) => !hasPerimeter(n)) };
}

/**
 * The winning AirQuality source's served readings as the raw fact input derive-cop consumes (S3 Lane A —
 * the P17 trio's consumer, closing F-52). UNLIKE `updateWeather`/`updateCrest` there is no seeded fact to
 * retain or re-attribute: the seeds carry no air-quality data, so unserved/absent/empty ⇒ `undefined` ⇒ no
 * fact at all (the fact degrades silently; the consulted slice itself stays cited in provenance). The
 * grounding is minted HERE because no seed supplies one: `sourceId` is the adapter that actually served
 * (F-64 — the citation follows the data by construction) and `citationId` is deterministic per adapter.
 */
function airQualityInputOf(air: NamedSlice | undefined): AirQualityFactInput | undefined {
  if (air === undefined) return undefined;
  const entities = air.slice.entities as readonly AirQualityReading[];
  if (!air.slice.served || entities.length === 0) return undefined;
  return {
    readings: entities,
    grounding: {
      field: 'airQuality',
      sourceId: asId<SourceId>(air.id),
      citationId: asId<CitationId>(`cit-air-quality-${air.id}`),
    },
  };
}

/** The adapter slices an incident/map enrichment fetches beyond the base hazard layers. */
interface IncidentFetch {
  readonly wx: NamedSlice | undefined; // the WINNING weather source (its id re-attributes the weather fact)
  readonly gauge: NamedSlice | undefined; // the WINNING flood-gauge source (its id re-attributes the crest fact)
  readonly air: NamedSlice | undefined; // the WINNING air-quality source (S3; mints the airQuality fact input)
  readonly infra: Slice<InfrastructureNode>;
  readonly populations: readonly NamedSlice[]; // precedence-ordered (census before worldpop on us-ca)
  readonly outages: Slice<OutageRecord>;
}

interface MapFetch {
  readonly haz: Slice<HazardGeometry>; // winning HOTSPOT source (FIRMS on CA; unserved on RO)
  readonly perim: Slice<HazardGeometry>; // winning PERIMETER source (NIFC on CA / EFFIS on RO) — merged with haz
  readonly gauge: Slice<Gauge>;
  readonly wx: Slice<WeatherObservation>;
  readonly infra: Slice<InfrastructureNode>;
  readonly outages: Slice<OutageRecord>;
  readonly cells: Slice<TelecomCoverage>;
  readonly zones: Slice<FloodZone>;
  readonly cameras: readonly NamedSlice[]; // E11 multi-source camera layer (link-out pins; priority-ordered)
}

/** Apply the served infra/population/outage/weather/gauge slices to an incident's derivation inputs
 *  (retain seeded else). */
function enrichDerivation(d: IncidentDerivationInput, f: IncidentFetch): IncidentDerivationInput {
  const infrastructure = servedOr(f.infra, (e) => e, d.infrastructure);
  const exposedPopulation = choosePopulation(d.exposedPopulation, f.populations);
  const populationGrounding = populationGroundingOf(f.populations);
  const outageNodeIds = pickOutageNodeIds(infrastructure, f.outages, d.outageNodeIds);
  const weather = updateWeather(d.weather, f.wx);
  const crest = updateCrest(d.crest, f.gauge);
  const airQuality = airQualityInputOf(f.air);
  return {
    ...d,
    infrastructure,
    exposedPopulation,
    ...(populationGrounding !== undefined ? { populationGrounding } : {}),
    ...(outageNodeIds.length > 0 ? { outageNodeIds } : {}),
    ...(weather !== undefined ? { weather } : {}),
    ...(crest !== undefined ? { crest } : {}),
    ...(airQuality !== undefined ? { airQuality } : {}),
  };
}

// ── Core seed (SitRep inputs) ───────────────────────────────────────────────────────────────────────

/**
 * Enrich ONE incident from its region's consultation plan. No region literals: the ids, their precedence
 * and the news set all come from `enabled_adapters`; the slots come from the ports; coverage skips what
 * does not apply. Every consulted adapter is cited (mode-labelled); every unserved slot keeps its seed.
 */
async function enrichIncidentSeed(
  registry: Registry,
  region: Region,
  enabled: readonly string[],
  ports: ReadonlyMap<string, string>,
  base: IncidentSeed,
): Promise<IncidentSeed> {
  const c = await consult(registry, region, consultationPlan(enabled, ports, 'incident'));
  const d = base.derivation;
  const { hotspots, perimeters } = hazardBuckets(slotSlices(c, 'hazards'));
  const hazards = mergeHazards(d.hazards, sliceOf<HazardGeometry>(hotspots), sliceOf<HazardGeometry>(perimeters));
  const derivation = enrichDerivation(
    { ...d, hazards },
    {
      wx: firstServing(slotSlices(c, 'weather')),
      gauge: firstServing(slotSlices(c, 'gauges')),
      air: firstServing(slotSlices(c, 'airQuality')),
      infra: sliceOf<InfrastructureNode>(firstServing(slotSlices(c, 'infrastructure'))),
      populations: slotSlices(c, 'population'),
      outages: sliceOf<OutageRecord>(firstServing(slotSlices(c, 'outages'))),
    },
  );
  const provenance = collectProvenance(c.named, base.provenance);
  const newsItems = newsItemsOf(slotSlices(c, 'news'));
  return { ...base, provenance, derivation, ...(newsItems.length > 0 ? { news: newsItems } : {}) };
}

function enrichIncident(
  registry: Registry,
  regions: RegionRegistry,
  ports: ReadonlyMap<string, string>,
  base: IncidentSeed,
): Promise<IncidentSeed> {
  const loaded = findRegion(regions, base.regionId);
  // An unconfigured region keeps its hand-seeded picture verbatim rather than being enriched from some other
  // region's geography — the COP stays honest (and labelled) instead of quietly wrong. A CONFIGURED region
  // needs no code here at all: this is the one path every region takes (the us-ca/ro dispatch is gone).
  if (loaded === undefined) return Promise.resolve(base);
  return enrichIncidentSeed(registry, regionQuery(loaded), loaded.region.enabledAdapters, ports, base);
}

/**
 * Assemble a live CoreSeed by enriching each incident with the slices a wired adapter can supply, retaining
 * every hand-seeded slice no adapter serves yet (hybrid scope). Deterministic given a deterministic registry;
 * `clock` is accepted for signature parity with the offline builder (freshness comes from each FetchResult).
 */
export async function assembleLiveCoreSeed(
  registry: Registry,
  regions: RegionRegistry,
  base: CoreSeed,
  clock: () => string,
): Promise<CoreSeed> {
  const ports = adapterPorts();
  const enriched = await Promise.all(base.incidents.map((i) => enrichIncident(registry, regions, ports, i)));
  const incidents = enriched.map((i) => ({ ...i, freshness: freshnessOf(i.provenance, clock()) }));
  // Refresh the per-region source projection (read by GET /status + the SitRep source list) from the
  // enriched incidents' live provenance — otherwise /status would still show the seeded MOCK source modes
  // while the derived COP/map already reflects the live fetch. A region with no enriched incident keeps its
  // seeded sources. SourceRef and SourceView share their shape (sourceId, mode, fetchedAt).
  const sources: Record<string, readonly SourceView[]> = { ...base.sources };
  for (const inc of incidents) {
    sources[inc.regionId] = inc.provenance.map((r): SourceView => ({ sourceId: r.sourceId, mode: r.mode, fetchedAt: r.fetchedAt }));
  }
  return { ...base, incidents, sources };
}

// ── Map seed (COP map inputs) ─────────────────────────────────────────────────────────────────────

/** The Phase-D map slices (outage/cell/weather/floodzone + assumed-offline node ids), served-replaces-seed. */
function phaseDMapSlices(
  base: MapDerivationInput,
  f: MapFetch,
  infrastructure: readonly InfrastructureNode[],
): Partial<MapDerivationInput> {
  const outageNodeIds = pickOutageNodeIds(infrastructure, f.outages, base.outageNodeIds);
  // Raw port DTOs pass through; W2b's deriveMapSource projects them into the honest map-layer slices.
  const outages = servedOr(f.outages, (e) => e, base.outages);
  const cellSites = servedOr(f.cells, (e) => e, base.cellSites);
  const floodZones = servedOr(f.zones, (e) => e, base.floodZones);
  const weatherObservation = firstServedOr(f.wx, base.weatherObservation);
  return {
    ...(outageNodeIds.length > 0 ? { outageNodeIds } : {}),
    ...(outages !== undefined ? { outages } : {}),
    ...(cellSites !== undefined ? { cellSites } : {}),
    ...(floodZones !== undefined ? { floodZones } : {}),
    ...(weatherObservation !== undefined ? { weatherObservation } : {}),
  };
}

function mergeMap(
  base: MapDerivationInput,
  f: MapFetch,
  named: readonly NamedSlice[],
  stamps: readonly LayerStamp[],
): MapDerivationInput {
  const hazards = mergeHazards(base.hazards, f.haz, f.perim); // hotspots + perimeters (both kept)
  const gauges = servedOr(f.gauge, (e) => e, base.gauges);
  const infrastructure = servedOr(f.infra, (e) => e, base.infrastructure);
  const cameras = mergeCameras(base.cameras, f.cameras); // multi-source link-out pins (served concat, seed-retained)
  const layerSources = buildLayerSources(base.layerSources, stamps);
  return {
    ...base,
    hazards,
    gauges,
    infrastructure,
    ...phaseDMapSlices(base, f, infrastructure),
    ...(cameras !== undefined ? { cameras } : {}),
    ...(layerSources !== undefined ? { layerSources } : {}),
    provenance: collectProvenance(named, base.provenance),
  };
}

/**
 * The per-layer source badges for one map assembly: for every slot that paints a layer, the source that
 * WON that slot (precedence order). The hazard layer is badged by the HOTSPOT source specifically — a
 * region with only a perimeter source (RO) gets no fire badge from the perimeter feed, exactly as before.
 * buildLayerSources still drops any stamp whose slice did not serve, so a seeded badge is never overwritten
 * by an unserved source.
 */
function mapLayerStamps(c: Consulted, hotspots: NamedSlice | undefined): readonly LayerStamp[] {
  const out: LayerStamp[] = [];
  for (const [slot, layer] of Object.entries(LAYER_BY_SLOT) as readonly (readonly [Slot, string | null])[]) {
    if (layer === null) continue;
    const winner = slot === 'hazards' ? hotspots : firstServing(slotSlices(c, slot));
    if (winner !== undefined) out.push({ layer, slice: winner.slice, id: winner.id });
  }
  return out;
}

/**
 * Enrich ONE region's map inputs from its consultation plan — the map twin of enrichIncidentSeed, and the
 * other half of what used to be enrichCaMap/enrichRoMap. Same three config inputs, no region literals.
 */
async function enrichMapInput(
  registry: Registry,
  region: Region,
  enabled: readonly string[],
  ports: ReadonlyMap<string, string>,
  base: MapDerivationInput,
): Promise<MapDerivationInput> {
  const c = await consult(registry, region, consultationPlan(enabled, ports, 'map'));
  const { hotspots, perimeters } = hazardBuckets(slotSlices(c, 'hazards'));
  const f: MapFetch = {
    haz: sliceOf<HazardGeometry>(hotspots),
    perim: sliceOf<HazardGeometry>(perimeters),
    gauge: sliceOf<Gauge>(firstServing(slotSlices(c, 'gauges'))),
    wx: sliceOf<WeatherObservation>(firstServing(slotSlices(c, 'weather'))),
    infra: sliceOf<InfrastructureNode>(firstServing(slotSlices(c, 'infrastructure'))),
    outages: sliceOf<OutageRecord>(firstServing(slotSlices(c, 'outages'))),
    cells: sliceOf<TelecomCoverage>(firstServing(slotSlices(c, 'cellSites'))),
    zones: sliceOf<FloodZone>(firstServing(slotSlices(c, 'floodZones'))),
    cameras: slotSlices(c, 'cameras'),
  };
  return mergeMap(base, f, c.named, mapLayerStamps(c, hotspots));
}

/**
 * Assemble a live map-input seed: replace each region's hazard/gauge layers with adapter records where a
 * wired source covers them, retaining the seeded prediction/infrastructure/shelters/reports/route (hybrid
 * scope). Region bbox/iso are read from the REGION REGISTRY (ADR-031) — the map seed used to carry its own
 * duplicated fallback bbox map, which is how an unknown region could inherit California's geography
 * (finding F-06). A region that is not configured passes through unchanged, hand-seeded and labelled; a
 * configured one goes through the SAME generic path as every other region (B1.8 — no id dispatch).
 * `clock` is accepted for signature parity (freshness comes from each FetchResult).
 */
export async function assembleLiveMapSeed(
  registry: Registry,
  base: MapInputsSeed,
  clock: () => string,
  regions: RegionRegistry,
): Promise<MapInputsSeed> {
  const ports = adapterPorts();
  const out: Record<string, MapDerivationInput> = {};
  for (const [id, input] of Object.entries(base)) {
    const loaded = findRegion(regions, id);
    const enriched =
      loaded === undefined
        ? input
        : await enrichMapInput(registry, regionQuery(loaded), loaded.region.enabledAdapters, ports, input);
    out[id] = { ...enriched, freshness: freshnessOf(enriched.provenance, clock()) };
  }
  return out;
}
