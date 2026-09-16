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
import type { Shelter } from '@/domain/shelter.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  CitationId,
  IncidentId,
  InfrastructureNodeId,
  PredictionId,
  SourceId,
} from '@/domain/value-objects/ids.js';
import type { BBox, Geometry, Position } from '@/domain/value-objects/geo.js';
import type { WeatherObservation } from '@/ports/data-sources.js';
import type { AirQualityReading } from '@/ports/air-quality.js';
import type { NewsItem } from '@/ports/intel.js';
import type {
  OutageRecord,
  PopulationEstimate,
  TelecomCoverage,
} from '@/ports/infrastructure-sources.js';
import type { SourceRef } from '@/ports/interaction.js';
import type { SourceView } from '@/application/interaction/command-router.js';
import type { FetchResult, Region, SourceAdapterPort } from '@/adapters/_shared/index.js';
import type { LoadedRegion, RegionRegistry } from '@/adapters/persistence/region-registry.js';
import { findRegion } from '@/adapters/persistence/region-registry.js';
import { loadShelterRegistry } from '@/adapters/persistence/shelter-registry.js';
import type { ShelterRegistry } from '@/adapters/persistence/shelter-registry.js';
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
  PredictionSpec,
} from '@/application/derivation/derive-cop.js';
import {
  INCIDENT_FORMING_KINDS,
  discoverIncidents,
} from '@/application/discovery/discover-incidents.js';
import { compass8 } from '@/application/shared/map-geometry.js';
import { HORIZON_MS } from './scenario-inputs.js';
import type { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { clipToRegion, positionsOf } from '@/application/shared/region-clip.js';
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
  /** Present when the adapter ANSWERED (it was consulted, and this is its mode label) — see `served`. */
  readonly ref?: SourceRef;
  readonly covered: boolean; // false ⇒ NOT_COVERED (skip + do not label)
  /**
   * Which ADAPTER minted each served record (SourceRecord id → adapter id). A `HazardGeometry.sourceId`
   * is a SourceRecord id, one per fetch; a `SourceRef.sourceId` is the adapter id. This is the map between
   * them, so a discovered incident can name the source that actually contributed its hazards rather than
   * the first source that was merely consulted (review, PR #29).
   */
  readonly adaptersByRecord?: ReadonlyMap<string, string>;
  /**
   * true ⇒ `entities` replace the seeded slice (a real answer, possibly a degraded rung). false with a
   * `ref` ⇒ CONSULTED BUT NOT SERVED: the adapter answered, nothing in the answer was about this region
   * (2026-09-13), so the seeded slice stays and the citation records that it was asked.
   */
  readonly served: boolean;
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
/**
 * One composition run's answers, keyed by region + adapter.
 *
 * The SitRep pass and the map pass consult overlapping sources for the SAME region in the SAME run —
 * FIRMS, NIFC, the gauges and the weather all feed both. Without this they were fetched twice, which on
 * the live deployment is twice the network, twice the upstream courtesy budget, and a composition that
 * measured 247 s. A memo is safe in a way that concurrency is not: the calls stay sequential and in
 * precedence order, and every rung of the redundancy ladder still runs — the second CONSUMER just reads
 * the first consumer's answer instead of asking the same question again a second apart.
 *
 * Scoped to ONE run and thrown away with it, so freshness is never stale by more than the run itself.
 */
export type SliceMemo = Map<string, Promise<Slice<unknown>>>;

/**
 * What the picture is made of (config `LIVE_PICTURE`, ADR-043). `hybrid`: the seeded demo enriched by
 * live slices — a served slice replaces its seeded counterpart, an unserved one keeps it. `live-only`:
 * nothing seeded is shown — incidents are only those discovered from live hazards, a layer holds only
 * what a LIVE or CACHED source served, and a MOCK answer is cited but never drawn.
 */
export type LivePicture = 'hybrid' | 'live-only';

export interface AssemblyOptions {
  readonly livePicture?: LivePicture;
}

/** live-only: a MOCK answer is consulted and cited, but its recording is not the region's picture. */
function withoutMock<T>(slice: Slice<T>): Slice<T> {
  return slice.served && slice.ref?.mode === 'MOCK'
    ? { ...slice, entities: [], served: false }
    : slice;
}

async function fetchSlice<T>(
  registry: Registry,
  id: string,
  region: Region,
  memo?: SliceMemo,
  livePicture: LivePicture = 'hybrid',
): Promise<Slice<T>> {
  const slice = await fetchSliceMemoised<T>(registry, id, region, memo);
  return livePicture === 'live-only' ? withoutMock(slice) : slice;
}

async function fetchSliceMemoised<T>(
  registry: Registry,
  id: string,
  region: Region,
  memo?: SliceMemo,
): Promise<Slice<T>> {
  if (memo === undefined) return fetchSliceOnce<T>(registry, id, region);
  const key = `${region.id}\u0000${id}\u0000${focusKey(region.focus)}`;
  const cached = memo.get(key);
  // The PROMISE is memoized, not the result: two consumers that ask before the first answer arrives share
  // the one in-flight request rather than racing a second one past the check.
  if (cached !== undefined) return (await cached) as Slice<T>;
  const pending = fetchSliceOnce<T>(registry, id, region) as Promise<Slice<unknown>>;
  memo.set(key, pending);
  return (await pending) as Slice<T>;
}

async function fetchSliceOnce<T>(
  registry: Registry,
  id: string,
  region: Region,
): Promise<Slice<T>> {
  const adapter = registry.get(id) as SourceAdapterPort<T> | undefined;
  if (adapter === undefined) return { entities: [], covered: false, served: false };
  try {
    const res = await adapter.fetch(region);
    if (res.ok) {
      // A recording from elsewhere is not a fact about this region. The coverage gate has already said the
      // SOURCE could know about the region; this asks whether each RECORD is about it. An answer that is
      // entirely somewhere else is CITED (the source was consulted, and its mode label says what it is)
      // but NOT SERVED, so every consumer keeps the hand-seeded slice exactly as it does when the primary
      // is down — never a dead-end (Art. XVI), and never California's cell sites on Romania's map. See
      // region-clip.ts for the live incident (2026-09-13).
      const { kept, spatial } = clipToRegion(
        res.value.records.map((r) => r.entity),
        region,
      );
      const ref = toRef(id, res.value);
      const adaptersByRecord = new Map(res.value.records.map((r) => [String(r.provenance.id), id]));
      if (spatial > 0 && kept.length === 0)
        return { entities: [], ref, adaptersByRecord, covered: true, served: false };
      return { entities: kept, ref, adaptersByRecord, covered: true, served: true };
    }
    return { entities: [], covered: res.error.kind !== 'NOT_COVERED', served: false };
  } catch {
    // Unexpected throw ⇒ treat as covered-but-unserved (primary down) → keep the seeded/cached slice.
    return { entities: [], covered: true, served: false };
  }
}

/**
 * Rebuild provenance from the attempted slices (F1, Art. XVI): a slice that ANSWERED contributes its
 * mode-labelled ref — whether its entities replaced the seed (served) or were all about somewhere else
 * (consulted but not served, see `Slice.served`); a covered-but-unanswered slice (primary down) falls
 * back to the seeded ref for that source (degraded label); a NOT_COVERED slice is skipped. Never returns
 * empty — falls back to the seed's provenance.
 */
function collectProvenance(
  named: readonly NamedSlice[],
  baseRefs: readonly SourceRef[],
): readonly SourceRef[] {
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
  const { bbox, iso, boundary } = loaded.region;
  return {
    id: loaded.configId,
    bbox: bbox as Bbox,
    ...(iso !== undefined ? { iso } : {}),
    ...(boundary !== undefined ? { boundary } : {}),
  };
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
/**
 * The weather facts that were built from a SERVED observation in this process. A discovered incident may
 * carry the region's weather only when it is one of these: a seeded fact left in place because the
 * weather rung fell over (or served nothing in the region) is the demo's weather, not today's, and it
 * must not travel to a live incident under that source's name (review, PR #32). Identity-keyed, like
 * HAZARD_RECORD_ADAPTERS; entries die with the fact.
 */
const SERVED_WEATHER = new WeakSet<WeatherFactInput>();

function updateWeather(
  weather: WeatherFactInput | undefined,
  wx: NamedSlice | undefined,
  incidentId: IncidentId,
): WeatherFactInput | undefined {
  const updated = servedWeather(weather, wx, incidentId);
  if (updated !== undefined && updated !== weather) SERVED_WEATHER.add(updated);
  return updated;
}

function servedWeather(
  weather: WeatherFactInput | undefined,
  wx: NamedSlice | undefined,
  incidentId: IncidentId,
): WeatherFactInput | undefined {
  if (wx === undefined) return weather;
  const entities = wx.slice.entities as readonly WeatherObservation[];
  if (!wx.slice.served || entities.length === 0) return weather;
  const obs = entities[0]!;
  // No seeded template (a blank live-only base, or a region seeded without a weather fact): the fact is
  // built from the observation itself, cited to the source that served it (2026-09-14).
  if (weather === undefined) return weatherFactFrom(obs, wx.id, incidentId);
  // A seeded template is REPLACED by the observation, labels included, so the direction the citation names
  // is the direction the source published; an observation without both wind fields (a speed-only report)
  // leaves the seeded fact and its seeded attribution untouched rather than citing the new source for
  // labels it never supplied (review, PR #32). The seeded citation id stays: it is the field's, not the source's.
  const fresh = weatherFactFrom(obs, wx.id, incidentId);
  if (fresh === undefined) return weather;
  return { ...fresh, grounding: { ...fresh.grounding, citationId: weather.grounding.citationId } };
}

/** The prose a spread direction is stated in — the seeded facts' own vocabulary ('south-westward'). */
const SPREAD_WORD: Readonly<Record<string, string>> = {
  N: 'northward',
  NE: 'north-eastward',
  E: 'eastward',
  SE: 'south-eastward',
  S: 'southward',
  SW: 'south-westward',
  W: 'westward',
  NW: 'north-westward',
};

/**
 * A weather fact from a served observation. `windDirDeg` is meteorological — the direction the wind
 * blows FROM (Open-Meteo, NWS, met.no all publish it so); the spread is the opposite bearing. Both labels
 * are the observation's own numbers turned into compass words; the figure is the observation's speed.
 */
function weatherFactFrom(
  obs: WeatherObservation,
  sourceId: string,
  incidentId: IncidentId,
): WeatherFactInput | undefined {
  if (obs.windSpeedMs === undefined || obs.windDirDeg === undefined) return undefined;
  const toward = (obs.windDirDeg + 180) % 360;
  return {
    input: {
      speedKmh: Math.round(obs.windSpeedMs * 3.6),
      fromLabel: compass8(obs.windDirDeg),
      spreadLabel: SPREAD_WORD[compass8(toward)] ?? compass8(toward),
    },
    grounding: {
      field: 'weather',
      sourceId: asId<SourceId>(sourceId),
      citationId: asId<CitationId>(`cit-weather-${String(incidentId)}`),
    },
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
  const unitBearing =
    unit === undefined
      ? {}
      : {
          ...(gauge.stage !== undefined ? { stage: gauge.stage } : {}),
          ...(gauge.crestForecast !== undefined ? { crestForecast: gauge.crestForecast } : {}),
          readingUnitLabel: unit,
        };
  return {
    floodCategory: gauge.floodCategory.toLowerCase(),
    ...unitBearing,
    ...(gauge.crestTime !== undefined ? { crestTime: gauge.crestTime } : {}),
    ...(gauge.exceedanceProbability !== undefined
      ? { exceedanceProbability: gauge.exceedanceProbability }
      : {}),
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
function updateCrest(
  crest: CrestFactInput | undefined,
  gauge: NamedSlice | undefined,
): CrestFactInput | undefined {
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
  // A recording never sits beside today's news (2026-09-14, owner: "the news are fake"): when any live or
  // cached source served, the MOCK fixtures (GDELT's 2024 headlines) are cited and not shown; they are
  // the picture only when nothing else answered (Art. XVI: the last rung, never a peer of the first).
  const served = named.filter((n) => n.slice.served);
  const current = served.filter((n) => n.slice.ref?.mode !== 'MOCK');
  return (current.length > 0 ? current : served).flatMap(
    (n) => n.slice.entities as readonly NewsItem[],
  );
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
  const perims = servedOr(
    perimeters,
    (e) => e,
    base.filter((h) => h.kind === 'PERIMETER'),
  );
  const rest = servedOr(
    hotspots,
    (e) => e,
    base.filter((h) => h.kind !== 'PERIMETER'),
  );
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
    if (pos !== undefined && outages.entities.some((o) => bboxContains(o.area, pos)))
      ids.push(node.id);
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
function firstServedOr(
  wx: Slice<WeatherObservation>,
  base: WeatherObservation | undefined,
): WeatherObservation | undefined {
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
function mergeCameras(
  base: readonly CameraFeed[] | undefined,
  sources: readonly NamedSlice[],
): readonly CameraFeed[] | undefined {
  const served = sources.filter((s) => s.slice.served && s.slice.entities.length > 0);
  if (served.length === 0) return base; // every source unserved/NOT_COVERED ⇒ keep the seeded pins
  const seen = new Set<string>();
  const out: CameraFeed[] = [];
  for (const s of served) {
    for (const cam of s.slice.entities as readonly CameraFeed[]) {
      if (!seen.has(cam.id)) {
        seen.add(cam.id);
        out.push(cam);
      }
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
  'HazardSource',
  'Weather',
  'FloodGauge',
  'NewsIntel',
  'Infrastructure',
  'Population',
  'FloodZone',
  'Outage',
  'Telecom',
  'CameraDirectory',
  'AirQuality',
  'ShelterDirectory',
] as const;
type PortName = (typeof PORT_NAMES)[number];

/** The domain slot a port's slices merge into (the seam the per-slot merge helpers above operate on). */
type Slot =
  | 'hazards'
  | 'weather'
  | 'gauges'
  | 'infrastructure'
  | 'population'
  | 'outages'
  | 'news'
  | 'cellSites'
  | 'floodZones'
  | 'cameras'
  | 'airQuality'
  | 'shelters';

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
  ShelterDirectory: 'shelters',
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
  // WP A4: a published shelter DIRECTORY (FEMA NSS) paints the COP's shelter layer — `MapDerivationInput.
  // shelters` → `deriveMapSource` → `ProjectedShelter` → the map's shelter points + capacity labels. So it
  // is map-bearing, and MAP-ONLY, for a reason stronger than symmetry with cameras/cellSites/floodZones:
  //   • It changes NO SitRep fact. The only SitRep figure shelters could feed is the shelter-demand
  //     quantification (derive-cop `IncidentDerivationInput.shelters` → shelter-demand.ts), whose supply
  //     term is `Σ(capacity − occupancy)` over EVERY shelter handed to it — `spareCapacityOf` is
  //     status-BLIND. A directory that is overwhelmingly CLOSED (California today: 1 open, thousands
  //     closed) would therefore publish closed buildings' spare halls as evacuee headroom and understate
  //     the deficit. A wrong number on a real feed is worse than no number, so the fact keeps its
  //     hand-seeded, labelled input and this slot does not enter the incident path (Art. XII).
  //   • Citing it on the incident path anyway would inflate /status's SitRep source list with a source
  //     backing no SitRep claim — the exact inflation the news/population/airQuality entries avoid.
  // Making the demand figure status-aware is a real, separate change to a published quantification (it
  // moves a number an operator may already have read), which is a reviewed decision, not a side effect of
  // wiring a feed. Recorded in PLAN-DELTA rather than done silently here.
  shelters: { incident: false, map: true },
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
  shelters: 'shelters',
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
async function consult(
  registry: Registry,
  region: Region,
  plan: readonly Consultation[],
  memo?: SliceMemo,
  livePicture: LivePicture = 'hybrid',
): Promise<Consulted> {
  // ADR-045 — the hazard sources are consulted FIRST, for the whole region; every other source is then
  // asked about the focus boxes around what they reported. `named` keeps the plan's precedence order so the
  // provenance list reads exactly as before.
  const fetched = new Map<string, NamedSlice>();
  const hazardPlan = plan.filter((c) => c.slot === 'hazards');
  for (const { id } of hazardPlan)
    fetched.set(id, { id, slice: await fetchSlice(registry, id, region, memo, livePicture) });
  // Only a LIVE/CACHED answer places the focus: a MOCK fixture's hotspots are a recording from another day
  // (drawn and labelled under hybrid, never drawn under live-only) and must not decide where the lifeline
  // sources look (review, PR #34).
  const focus = focusOf(
    hazardPlan.flatMap((c) => {
      const slice = fetched.get(c.id)?.slice;
      return slice === undefined || slice.ref?.mode === 'MOCK'
        ? []
        : (slice.entities as readonly HazardGeometry[]);
    }),
    region,
  );
  // The scoped region carries the focus in its ID as well: the redundancy engine keys its last-known-good
  // cache by adapter + region id, and an answer for one focus must never be re-served for another.
  const scoped: Region =
    focus.length > 0 ? { ...region, id: `${region.id}@${focusKey(focus)}`, focus } : region;
  for (const { id } of plan)
    if (!fetched.has(id))
      fetched.set(id, { id, slice: await fetchSlice(registry, id, scoped, memo, livePicture) });
  const named: NamedSlice[] = [];
  const bySlot = new Map<Slot, NamedSlice[]>();
  for (const { id, slot } of plan) {
    const entry = fetched.get(id)!;
    named.push(entry);
    const bucket = bySlot.get(slot);
    if (bucket === undefined) bySlot.set(slot, [entry]);
    else bucket.push(entry);
  }
  return { named, bySlot };
}

/** Padding around each incident cluster, in degrees (~10 km): the lifeline nodes a fire can reach. */
const FOCUS_PAD_DEG = 0.1;

/**
 * The focus boxes of a region (ADR-045): one padded rectangle per incident cluster the served hazards
 * form, clipped to the region's bbox. Empty when nothing was served — the adapters then query as before.
 */
export function focusOf(hazards: readonly HazardGeometry[], region: Region): readonly Bbox[] {
  const served = hazards.filter((h) => INCIDENT_FORMING_KINDS.has(h.kind));
  if (served.length === 0) return [];
  const [rw, rs, re, rn] = region.bbox;
  return discoverIncidents(served, { scope: region.id }).flatMap((cluster) => {
    const pts = cluster.hazards.flatMap((h) => positionsOf(h));
    if (pts.length === 0) return [];
    const w = Math.max(rw, Math.min(...pts.map((p) => p[0])) - FOCUS_PAD_DEG);
    const e = Math.min(re, Math.max(...pts.map((p) => p[0])) + FOCUS_PAD_DEG);
    const so = Math.max(rs, Math.min(...pts.map((p) => p[1])) - FOCUS_PAD_DEG);
    const n = Math.min(rn, Math.max(...pts.map((p) => p[1])) + FOCUS_PAD_DEG);
    return w < e && so < n ? [[w, so, e, n] as Bbox] : [];
  });
}

/** The focus, canonically: the same adapter asked about a different area is a different fetch. Full precision —
 *  two boxes that differ at all are two questions (review, PR #34). */
function focusKey(focus: Region['focus']): string {
  return (focus ?? []).map((b) => b.join(',')).join(';');
}

/** An adapter-less slot: nothing served, nothing covered ⇒ every consumer retains its seeded value. */
const UNSERVED: Slice<never> = { entities: [], covered: false, served: false };

function slotSlices(c: Consulted, slot: Slot): readonly NamedSlice[] {
  return c.bySlot.get(slot) ?? [];
}

/** The first slice that actually SERVED data for a slot — precedence order, so this is the winning source. */
function firstServing(slices: readonly NamedSlice[]): NamedSlice | undefined {
  // Precedence order among the sources that ANSWERED — a MOCK answer outranks nothing that is current.
  const serving = (n: NamedSlice): boolean => n.slice.served && n.slice.entities.length > 0;
  return slices.find((n) => serving(n) && n.slice.ref?.mode !== 'MOCK') ?? slices.find(serving);
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
  const answered = slices.filter(
    (n) => HAZARD_FOOTPRINT_SOURCES.has(n.id) && n.slice.served && n.slice.entities.length > 0,
  );
  // Current answers first (stable), so a recording is the footprint only when no live source has one.
  const footprints = [
    ...answered.filter((n) => n.slice.ref?.mode !== 'MOCK'),
    ...answered.filter((n) => n.slice.ref?.mode === 'MOCK'),
  ];
  const hasPerimeter = (n: NamedSlice): boolean =>
    (n.slice.entities as readonly HazardGeometry[]).some((h) => h.kind === 'PERIMETER');
  return {
    perimeters: footprints.find(hasPerimeter),
    hotspots: footprints.find((n) => !hasPerimeter(n)),
  };
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
  readonly shelters: Slice<Shelter>; // WP A4 published shelter directory (FEMA NSS on CA; NOT_COVERED elsewhere)
}

/** Apply the served infra/population/outage/weather/gauge slices to an incident's derivation inputs
 *  (retain seeded else). */
function enrichDerivation(d: IncidentDerivationInput, f: IncidentFetch): IncidentDerivationInput {
  const infrastructure = servedOr(f.infra, (e) => e, d.infrastructure);
  const exposedPopulation = choosePopulation(d.exposedPopulation, f.populations);
  const populationGrounding = populationGroundingOf(f.populations);
  const outageNodeIds = pickOutageNodeIds(infrastructure, f.outages, d.outageNodeIds);
  const weather = updateWeather(d.weather, f.wx, d.incidentId);
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
  memo?: SliceMemo,
  livePicture: LivePicture = 'hybrid',
): Promise<IncidentSeed> {
  const c = await consult(
    registry,
    region,
    consultationPlan(enabled, ports, 'incident'),
    memo,
    livePicture,
  );
  const d = base.derivation;
  const { hotspots, perimeters } = hazardBuckets(slotSlices(c, 'hazards'));
  const hazards = mergeHazards(
    d.hazards,
    sliceOf<HazardGeometry>(hotspots),
    sliceOf<HazardGeometry>(perimeters),
  );
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
  const enriched: IncidentSeed = {
    ...base,
    provenance,
    derivation,
    ...(newsItems.length > 0 ? { news: newsItems } : {}),
  };
  HAZARD_RECORD_ADAPTERS.set(enriched.derivation, adaptersOf(slotSlices(c, 'hazards')));
  return enriched;
}

/**
 * SourceRecord id → adapter id for every hazard record this enrichment fetched, remembered per enriched
 * DERIVATION so discovery — which runs after enrichment, over the merged hazards — can say which adapter
 * founded each incident. Keyed by the derivation object, not the seed: the composition re-wraps each seed
 * (to stamp freshness) but carries the derivation through by reference. A WeakMap, so no field is added
 * to any public shape and the entry dies with the derivation.
 */
const HAZARD_RECORD_ADAPTERS = new WeakMap<IncidentDerivationInput, ReadonlyMap<string, string>>();

function adaptersOf(slices: readonly NamedSlice[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const { slice } of slices)
    for (const [rec, adapter] of slice.adaptersByRecord ?? []) out.set(rec, adapter);
  return out;
}

function enrichIncident(
  registry: Registry,
  regions: RegionRegistry,
  ports: ReadonlyMap<string, string>,
  base: IncidentSeed,
  memo?: SliceMemo,
  livePicture: LivePicture = 'hybrid',
): Promise<IncidentSeed> {
  const loaded = findRegion(regions, base.regionId);
  // An unconfigured region keeps its hand-seeded picture verbatim rather than being enriched from some other
  // region's geography — the COP stays honest (and labelled) instead of quietly wrong. A CONFIGURED region
  // needs no code here at all: this is the one path every region takes (the us-ca/ro dispatch is gone).
  if (loaded === undefined) return Promise.resolve(base);
  return enrichIncidentSeed(
    registry,
    regionQuery(loaded),
    loaded.region.enabledAdapters,
    ports,
    base,
    memo,
    livePicture,
  );
}

/**
 * A derivation for an incident that is NOT the seeded one: its own hazards, the region's lifeline set
 * and buffers, the asset noun, zero population, no trend, the deterministic configuration — and
 * nothing observed for a different incident (Art. XI). Shared by discovered incidents and by the blank
 * per-region base the live-only picture enriches.
 */
function derivationFor(
  seeded: IncidentDerivationInput,
  own: {
    readonly incidentId: IncidentId;
    readonly hazards: readonly HazardGeometry[];
    readonly foundedBy: SourceId;
    /** The region's served weather, only when its source is cited on the incident. */
    readonly weather?: WeatherFactInput;
  },
): IncidentDerivationInput {
  const id = String(own.incidentId);
  return {
    incidentId: own.incidentId,
    hazards: own.hazards,
    infrastructure: seeded.infrastructure,
    buffers: seeded.buffers,
    exposedPopulation: 0,
    assetLabel: seeded.assetLabel,
    trendReadings: [],
    grounding: {
      exposure: {
        field: 'exposure',
        sourceId: own.foundedBy,
        citationId: asId<CitationId>(`cit-exposure-${id}`),
      },
      priorities: {
        field: 'priorities',
        sourceId: own.foundedBy,
        citationId: asId<CitationId>(`cit-priorities-${id}`),
      },
    },
    computedAt: seeded.computedAt,
    ...(own.weather !== undefined ? { weather: own.weather } : {}),
    ...(seeded.populationGrid !== undefined ? { populationGrid: seeded.populationGrid } : {}),
    ...(seeded.impactParams !== undefined ? { impactParams: seeded.impactParams } : {}),
    ...(seeded.priorityConfig !== undefined ? { priorityConfig: seeded.priorityConfig } : {}),
    ...(seeded.trendConfig !== undefined ? { trendConfig: seeded.trendConfig } : {}),
  };
}

/** The id of the blank base that drives a region's live-only enrichment. Never served. */
export function blankBaseId(regionId: string): IncidentId {
  return asId<IncidentId>(`region:${regionId}:live`);
}

/**
 * One blank incident per region, shaped from that region's first seeded incident: same region, same
 * configured provenance (the sources it may consult), the region-level derivation settings — and no
 * hazards, no headline, nothing of the demo. Enrichment fills it from live sources; discovery reads its
 * hazards; the blank itself is dropped (live-only picture, ADR-043).
 */
function blankBasesPerRegion(incidents: readonly IncidentSeed[]): readonly IncidentSeed[] {
  const seen = new Set<string>();
  const out: IncidentSeed[] = [];
  for (const template of incidents) {
    const regionId = String(template.regionId);
    if (seen.has(regionId)) continue;
    seen.add(regionId);
    const incidentId = blankBaseId(regionId);
    out.push({
      id: incidentId,
      regionId: template.regionId,
      type: template.type,
      status: 'ACTIVE',
      headline: '',
      provenance: template.provenance,
      derivation: derivationFor(template.derivation, {
        incidentId,
        hazards: [],
        foundedBy: template.derivation.grounding.exposure.sourceId,
      }),
    });
  }
  return out;
}

/**
 * The map input a live-only region starts from: the region's identity and derivation settings, the
 * agency shelter registry (`config/shelters.json` — the same rows the database is seeded with), and
 * nothing hand-seeded. Every layer is then what a live or cached source served, or absent.
 */
function blankMapInput(
  seeded: MapDerivationInput,
  registry: Result<ShelterRegistry, DomainError> | undefined,
): MapDerivationInput {
  const shelters =
    registry !== undefined && registry.ok
      ? (registry.value.regions.find((g) => g.regionId === String(seeded.regionId))?.shelters ?? [])
      : [];
  return {
    regionId: seeded.regionId,
    incidentId: seeded.incidentId,
    incidentType: seeded.incidentType,
    hazards: [],
    gauges: [],
    infrastructure: [],
    buffers: seeded.buffers,
    predictions: [],
    shelters,
    reports: [],
    provenance: seeded.provenance,
    computedAt: seeded.computedAt,
  };
}

/**
 * The incidents BEACON found in this region's own live hazards, as seeds the rest of the product already
 * knows how to render, rank and alert on.
 *
 * Three deliberate choices, each of which would be a lie if made the other way:
 *
 *  * **Provenance is narrowed to the sources that actually contributed.** A discovered fire cites FIRMS
 *    and NIFC — not the region's weather or population feeds, which had nothing to do with finding it.
 *  * **The region's news batch is NOT inherited.** Those articles are about the region, and possibly
 *    about the seeded incident; attaching them here would let the SitRep cite a story about one fire as
 *    evidence about another (Art. XI).
 *  * **The planning-seed population is dropped to zero.** Every other enriched slice is region-scoped and
 *    stays true for a smaller incident inside that region, but the seeded exposure figure is a planning
 *    estimate for the SEEDED incident. Inheriting it would print the same "residents exposed" number
 *    beside every discovered fire. At zero, the impact ladder falls through to the rungs that CLIP a real
 *    population to this incident's own footprint, and says so when none can.
 */
function discoveredIncidentSeeds(
  base: IncidentSeed,
  ports: ReadonlyMap<string, string>,
): readonly IncidentSeed[] {
  // NOTHING OBSERVED FOR A DIFFERENT INCIDENT TRAVELS. Until 2026-09-13 this spread the seeded incident's
  // whole derivation and only zeroed the population, so a discovered fire inherited the seeded fire's
  // acreage trend, its gauge crest, its weather and air-quality inputs, its outage-node selection and its
  // population grounding — and `deriveIncidentFacts` would have published each as a fact of the
  // discovered fire, cited to nothing (its provenance is narrowed to the hazard sources). The derivation
  // is now built from an ALLOWLIST: what is the discovered incident's own (its hazards), what is the
  // region's and needed to state the exposure claim (the lifeline set, its buffers, the asset noun), and
  // the deterministic configuration. Everything else is absent, and the derivation says so rather than
  // implying a reading it never had (Art. XI, Art. XII). The shipped population grid stays: it is
  // region-level and the impact ladder clips it to THIS incident's own footprint.
  const hazardSources = hazardSourcesOf(base.provenance, ports);
  const byRecord = HAZARD_RECORD_ADAPTERS.get(base.derivation) ?? new Map<string, string>();
  const seeded = base.derivation;
  // A record a MOCK rung minted is a recording, not an observation: under hybrid it is drawn and labelled,
  // but it never FOUNDS a live incident — a "discovered:" id is the claim that live sources saw something
  // (review, PR #34). Hand-seeded hazards carry no record mapping and are left to the seeded incident.
  const mockAdapters = new Set(
    base.provenance.filter((p) => p.mode === 'MOCK').map((p) => String(p.sourceId)),
  );
  const observed = seeded.hazards.filter((h) => {
    const adapter = byRecord.get(String(h.id));
    return adapter === undefined || !mockAdapters.has(adapter);
  });
  return discoverIncidents(observed, { scope: String(base.regionId) }).map((d) => {
    // The exposure/priority claims cite the adapter whose records FOUNDED this incident — the one that
    // contributed the most of its hazards — never the first source that was merely consulted. Provenance
    // is narrowed to the founding adapters. When no record can be mapped (a hand-seeded hazard), the
    // claim cites the first hazard-slot ADAPTER in provenance — never a per-fetch SourceRecord id, which
    // no provenance entry could resolve (review, PR #29) — and the hazard-slot list stands.
    const founders = foundersOf(d.hazards, byRecord);
    const foundedBy = asId<SourceId>(
      founders[0] ?? hazardSources[0]?.sourceId ?? String(seeded.grounding.exposure.sourceId),
    );
    const cited = hazardSources.filter((ref) => founders.includes(ref.sourceId));
    // The region's weather is region-scoped and served by a named source: a discovered fire may carry it
    // — and its fire cone needs it — as long as that source is cited beside the founders (Art. XI).
    const weatherRefs = weatherSourcesOf(base.provenance, ports, seeded.weather);
    const sources = [...(cited.length > 0 ? cited : hazardSources), ...weatherRefs];
    const derivation = derivationFor(seeded, {
      incidentId: d.id,
      hazards: d.hazards,
      foundedBy,
      ...(weatherRefs.length > 0 && seeded.weather !== undefined
        ? { weather: seeded.weather }
        : {}),
    });
    return {
      id: d.id,
      regionId: base.regionId,
      type: d.type,
      status: 'ACTIVE',
      headline: d.headline,
      provenance: sources,
      ...(base.freshness !== undefined ? { freshness: base.freshness } : {}),
      derivation,
    };
  });
}

/**
 * The weather-slot source refs a served weather fact can be attributed to — the ref whose adapter id the
 * fact's own grounding names, from the region's provenance. Empty when the weather was not SERVED this
 * run (see SERVED_WEATHER) or its source is not in the list, in which case the weather does not travel
 * (nothing uncited, Art. XI).
 */
function weatherSourcesOf(
  provenance: readonly SourceRef[],
  ports: ReadonlyMap<string, string>,
  weather: WeatherFactInput | undefined,
): readonly SourceRef[] {
  if (weather === undefined || !SERVED_WEATHER.has(weather)) return [];
  return provenance.filter((p) => {
    const port = ports.get(String(p.sourceId));
    return (
      port !== undefined &&
      isPortName(port) &&
      SLOT_BY_PORT[port] === 'weather' &&
      String(p.sourceId) === String(weather.grounding.sourceId)
    );
  });
}

/** Adapters that contributed a cluster's hazards, most records first; ties keep first-seen order. */
function foundersOf(
  hazards: readonly HazardGeometry[],
  byRecord: ReadonlyMap<string, string>,
): readonly string[] {
  const counts = new Map<string, number>();
  for (const h of hazards) {
    const adapter = byRecord.get(String(h.sourceId));
    if (adapter !== undefined) counts.set(adapter, (counts.get(adapter) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([adapter]) => adapter);
}

/**
 * The region's HAZARD sources, which are the ones that could have found this incident.
 *
 * Narrowed by SLOT, not by the individual geometries in the cluster, and the reason is worth stating: a
 * `HazardGeometry.sourceId` is a SourceRecord id (one per fetch), while a `SourceRef.sourceId` is the
 * ADAPTER id — they are different identifiers and the seed carries no map between them. Slot-level
 * narrowing is the strongest claim the data at this seam actually supports, and it is still the important
 * half: a discovered fire no longer cites the region's population or weather feeds, which had nothing to
 * do with finding it. The fallback keeps the full list rather than emitting an incident with no
 * provenance at all, which Art. XI would not allow.
 */
function hazardSourcesOf(
  provenance: readonly SourceRef[],
  ports: ReadonlyMap<string, string>,
): readonly SourceRef[] {
  const cited = provenance.filter((p) => {
    const port = ports.get(String(p.sourceId));
    return port !== undefined && isPortName(port) && SLOT_BY_PORT[port] === 'hazards';
  });
  return cited.length > 0 ? cited : provenance;
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
  memo?: SliceMemo,
  opts: AssemblyOptions = {},
): Promise<CoreSeed> {
  const ports = adapterPorts();
  const livePicture = opts.livePicture ?? 'hybrid';
  // live-only: the seeded incidents are not the picture. One BLANK base per region still drives the
  // enrichment (which is per incident) and the discovery that runs over its hazards; the blank itself is
  // never returned — only what was discovered is (ADR-043).
  const bases = livePicture === 'live-only' ? blankBasesPerRegion(base.incidents) : base.incidents;
  const enriched = await Promise.all(
    bases.map((i) => enrichIncident(registry, regions, ports, i, memo, livePicture)),
  );
  const seeded = enriched.map((i) => ({ ...i, freshness: freshnessOf(i.provenance, clock()) }));
  // V3 §3.1 — the live picture, not just live layers. Discovery runs over the hazards this region's own
  // enrichment just fetched, so it costs no extra request, and it only ever looks at geometries no
  // incident has claimed.
  const discovered = seeded.flatMap((i) => discoveredIncidentSeeds(i, ports));
  const incidents = livePicture === 'live-only' ? discovered : [...seeded, ...discovered];
  // Refresh the per-region source projection (read by GET /status + the SitRep source list) from the
  // enriched provenance — otherwise /status would still show the seeded MOCK source modes while the
  // derived COP/map already reflects the live fetch. A region with no enriched incident keeps its seeded
  // sources. SourceRef and SourceView share their shape (sourceId, mode, fetchedAt).
  const sources: Record<string, readonly SourceView[]> = { ...base.sources };
  for (const inc of seeded) {
    sources[inc.regionId] = inc.provenance.map((r): SourceView => ({
      sourceId: r.sourceId,
      mode: r.mode,
      fetchedAt: r.fetchedAt,
    }));
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
  // The directory REPLACES the seeded roster wholesale rather than merging into it: the two answer the same
  // question ("which buildings are shelters here, and what is each one's published state") and a publisher's
  // register is the authority on it. Concatenating would leave the hand-seeded demo hall standing beside the
  // real register as if FEMA had listed it. Unserved/NOT_COVERED keeps the seed, as every other slot does —
  // an empty shelter layer would read as "no shelters here", which is a different claim (Art. XVI).
  const shelters = servedOr(f.shelters, (e) => e, base.shelters);
  const layerSources = buildLayerSources(base.layerSources, stamps);
  return {
    ...base,
    hazards,
    gauges,
    infrastructure,
    shelters,
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
  for (const [slot, layer] of Object.entries(LAYER_BY_SLOT) as readonly (readonly [
    Slot,
    string | null,
  ])[]) {
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
  memo?: SliceMemo,
  livePicture: LivePicture = 'hybrid',
): Promise<MapDerivationInput> {
  const c = await consult(
    registry,
    region,
    consultationPlan(enabled, ports, 'map'),
    memo,
    livePicture,
  );
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
    shelters: sliceOf<Shelter>(firstServing(slotSlices(c, 'shelters'))),
  };
  return mergeMap(base, f, c.named, mapLayerStamps(c, hotspots));
}

/**
 * Assemble a live map-input seed: replace each region's hazard/gauge layers with adapter records where a
 * wired source covers them, retaining the seeded prediction/reports/route (hybrid scope; `shelters` left
 * this list in WP A4 — a wired ShelterDirectory now serves it on the regions that enable one). Region bbox/iso are read from the REGION REGISTRY (ADR-031) — the map seed used to carry its own
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
  memo?: SliceMemo,
  opts: AssemblyOptions = {},
): Promise<MapInputsSeed> {
  const ports = adapterPorts();
  const livePicture = opts.livePicture ?? 'hybrid';
  const shelterRegistry = livePicture === 'live-only' ? loadShelterRegistry() : undefined;
  const out: Record<string, MapDerivationInput> = {};
  for (const [id, seededInput] of Object.entries(base)) {
    const loaded = findRegion(regions, id);
    const input =
      livePicture === 'live-only' ? blankMapInput(seededInput, shelterRegistry) : seededInput;
    const enriched =
      loaded === undefined
        ? input
        : await enrichMapInput(
            registry,
            regionQuery(loaded),
            loaded.region.enabledAdapters,
            ports,
            input,
            memo,
            livePicture,
          );
    const withCones =
      livePicture === 'live-only'
        ? { ...enriched, predictions: discoveredCones(enriched, clock) }
        : enriched;
    out[id] = { ...withCones, freshness: freshnessOf(withCones.provenance, clock()) };
  }
  return out;
}

/**
 * Fire-cone projections for the wildfire clusters a live-only region's hazards found — the same clusters
 * (same ids) the core pass discovers, because both run the same deterministic grouping over the same
 * hazards. The wind is the region's served observation; without one there is no cone (a projection with
 * an invented wind would be the LLM-shaped mistake in geometry, Art. XII). The horizon is the product's
 * standard 6-hour window.
 */
function discoveredCones(
  input: MapDerivationInput,
  clock: () => string,
): readonly PredictionSpec[] {
  const wx = input.weatherObservation;
  if (wx === undefined || wx.windDirDeg === undefined || wx.windSpeedMs === undefined) return [];
  // The observation says where the wind blows FROM (meteorological); the cone wants where it blows TOWARD.
  const windDirDeg = (wx.windDirDeg + 180) % 360;
  const windSpeedMps = wx.windSpeedMs;
  const nowMs = Date.parse(clock());
  return discoverIncidents(input.hazards, { scope: String(input.regionId) })
    .filter((d) => d.type === 'WILDFIRE')
    .map((d) => ({
      kind: 'FIRE_CONE' as const,
      id: asId<PredictionId>(`cone:${String(d.id)}`),
      incidentId: d.id,
      origin: d.center,
      windDirDeg,
      windSpeedMps,
      nowMs,
      horizonMs: HORIZON_MS,
      ...(d.sourceIds[0] !== undefined ? { sourceId: d.sourceIds[0] } : {}),
    }));
}
