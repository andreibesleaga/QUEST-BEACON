// BEACON — deck.gl layer BUILDERS + the pure buildLayers(state, data) mapping (E8·T-359…T-369). Every
// builder is a data → LayerDescriptor[] pure fn (no GL, no side effects), so the whole "toggle flips a
// layer on/off" behaviour is unit-tested against a fake engine. Numbers/geometry come from the engine data
// only — NO client scoring (Art. XII). Precise-PII geometry is gated per-feature via visibleGeometry (T-370).
import { isLinkOnlyUrl } from '@/domain/shared/link-policy.js';
import { LAYER_IDS, type LayerId } from '../../_lib/types.js';
import type { useT } from '../../_lib/i18n.js';
import { visibleGeometry } from './geometry.js';
import type {
  CameraPin,
  CellCoverage,
  ExposureNode,
  FireData,
  FloodData,
  FloodZoneFeature,
  InfraNode,
  LayerDatum,
  LayerDescriptor,
  MapData,
  MapLayerState,
  OutageArea,
  PolygonRings,
  PredictionCone,
  ReportFeature,
  RouteFeature,
  ShelterFeature,
  StormData,
  WeatherObservation,
  GaugeFeature,
} from './types.js';
import type { ActorRole } from '../../_lib/types.js';

/**
 * The `map`-namespace translator (`useT('map')`), threaded in from the React caller so the labels these
 * otherwise-pure builders compose can be localized. It is OPTIONAL on purpose: when absent (unit tests,
 * non-React consumers) every builder emits the verbatim English source text it always has — the English
 * literals below stay the source of record and the fallback (FR-I18N-2).
 */
export type MapT = ReturnType<typeof useT<'map'>>;

// ── Honest-limitation caveats (surfaced in the toggle panel + tooltips — a graded rubric item) ──

export const OUTAGE_CAVEAT =
  'County-granular (EAGLE-I): areas are assumed-offline estimates, not confirmed per-address outages.';
export const CELL_CAVEAT =
  'OpenCelliD-derived coverage estimate — indicative, not a guaranteed signal map.';
export const FIRE_CAVEAT = 'FIRMS hotspots are thermal detections, not confirmed fire perimeters.';
export const FLOODZONE_CAVEAT = 'Regulatory flood zones — not a live extent';
export const WEATHER_CAVEAT = 'Observation point — not a forecast grid';
export const CAMERA_CAVEAT = "Live cameras — opens the source's site in a new tab";
/**
 * The storm layer's standing honesty boundary (ADR-032 §6, Art. XIV). Stronger than the wildfire/flood
 * prediction caveats: those label a BEACON first-order projection, whereas a cyclone track/cone/surge is
 * INGESTED from an agency bulletin and drawn verbatim — BEACON runs no cyclone model of any kind.
 */
export const STORM_CAVEAT =
  'Agency cyclone product drawn verbatim — BEACON does not model storm tracks, winds or surge.';

/**
 * The one thing an operator must be told about a route they are about to send people down.
 *
 * `avoidsHazard` is the ENGINE's own claim, and when it is false the line on the map is one of two
 * things: a real road route that could not be kept clear of the hazard, or — when no routing engine is
 * configured — the labelled straight-line fallback `evac-routing.ts` degrades to (Art. XVI). Both are
 * drawn as a line between two points, and until now the map said nothing at all about either, so a
 * straight line across a valley looked exactly like a routed one. This wording is true of both cases
 * without claiming to know which: it states what was NOT established, and does not assert what was.
 */
const ROUTE_DIRECT_CAVEAT =
  'Direct path — this route was not verified to avoid the hazard. Confirm it before sending anyone.';

/** Catalog keys for the FIXED caveats above (the dynamic prediction caveat has none — see caveatText). */
export type CaveatKey =
  | 'caveat.outage'
  | 'caveat.cell'
  | 'caveat.fire'
  | 'caveat.floodzone'
  | 'caveat.weather'
  | 'caveat.camera'
  | 'caveat.storm'
  | 'caveat.routeDirect';

/** A caveat reaches its render site as an already-composed string (LayerMeta.caveat / LayerDescriptor.caveat),
 *  so this maps that string back to its catalog entry. */
const CAVEAT_KEY_BY_TEXT: ReadonlyMap<string, CaveatKey> = new Map<string, CaveatKey>([
  [OUTAGE_CAVEAT, 'caveat.outage'],
  [CELL_CAVEAT, 'caveat.cell'],
  [FIRE_CAVEAT, 'caveat.fire'],
  [FLOODZONE_CAVEAT, 'caveat.floodzone'],
  [WEATHER_CAVEAT, 'caveat.weather'],
  [CAMERA_CAVEAT, 'caveat.camera'],
  [STORM_CAVEAT, 'caveat.storm'],
  [ROUTE_DIRECT_CAVEAT, 'caveat.routeDirect'],
]);

/**
 * Localized form of a caveat string — the identity in English. A caveat that is NOT one of the fixed
 * constants (a prediction cone's method/inputs/uncertainty sentence, or a caller-supplied note) is rendered
 * verbatim rather than dropped: an honest limitation must never be swallowed by a missing key (Art. XVI).
 */
export function caveatText(t: MapT, caveat: string): string {
  const key = CAVEAT_KEY_BY_TEXT.get(caveat);
  return key === undefined ? caveat : t(key);
}

/** Human-readable projection caveat for a prediction cone (method + inputs + uncertainty, T-367). */
export function predictionCaveat(cone: PredictionCone): string {
  return `First-order ${cone.method}; inputs: ${cone.inputs}; uncertainty: ${cone.uncertainty}.`;
}

/**
 * Non-color capacity encoding for a shelter: a NUMERIC label (T-369 — capacity vs demand, never color-only),
 * prefixed with the PUBLISHED status when the feature carries one.
 *
 * WP A4 made the prefix load-bearing rather than decorative. With a live directory behind the layer
 * (FEMA NSS on California) the pins are overwhelmingly CLOSED buildings, several of which publish a LARGER
 * capacity than the single open one — whose capacity FEMA has not counted, so it arrives as 0. Capacity
 * alone would therefore rank a hall nobody can enter above the only real destination. The status token is
 * rendered VERBATIM, as the domain vocabulary, exactly as the shelter-status board renders it
 * (`shelter-status-panel.tsx:53`) — which is also why it needs no new message key.
 *
 * A feature with NO status keeps the original label unchanged: an absent status is not an implied 'OPEN'.
 */
export function shelterCapacityLabel(shelter: ShelterFeature, t?: MapT): string {
  const cap = shelter.capacity ?? 0;
  const need = shelter.demand ?? 0;
  // Counts are passed as strings so the label reads exactly as the deterministic figure (no ICU grouping).
  const figures =
    t?.('shelter.capacity', { capacity: String(cap), demand: String(need) }) ??
    `Cap ${cap} · Need ${need}`;
  return shelter.status === undefined ? figures : `${shelter.status} · ${figures}`;
}

/** Per-layer display label + optional caveat (shared by the toggle panel + legend). */
export interface LayerMeta {
  readonly label: string;
  readonly caveat?: string;
}

export const LAYER_META: Record<LayerId, LayerMeta> = {
  fire: { label: 'Fire (hotspots & perimeter)', caveat: FIRE_CAVEAT },
  flood: { label: 'Flood extent & gauges' },
  storm: { label: 'Storm track, cone & surge', caveat: STORM_CAVEAT },
  floodzone: { label: 'Flood zones (NFHL)', caveat: FLOODZONE_CAVEAT },
  infra: { label: 'Infrastructure' },
  weather: { label: 'Weather (wind)', caveat: WEATHER_CAVEAT },
  cameras: { label: 'Live cameras', caveat: CAMERA_CAVEAT },
  outage: { label: 'Power outages', caveat: OUTAGE_CAVEAT },
  cell: { label: 'Cell coverage', caveat: CELL_CAVEAT },
  exposure: { label: 'Exposure (nodes in hazard)' },
  reports: { label: 'Reports / SOS' },
  prediction: { label: 'Prediction cone' },
  route: { label: 'Evacuation route' },
  shelters: { label: 'Shelters' },
};

// ── Individual layer builders (each returns 0+ descriptors) ────────────────────

export function buildFireLayers(fire: FireData | undefined): LayerDescriptor[] {
  if (fire === undefined) return [];
  const out: LayerDescriptor[] = [];
  if (fire.perimeter !== undefined) {
    out.push({
      id: 'fire-perimeter',
      group: 'fire',
      kind: 'polygon',
      data: [{ id: 'fire-perimeter', polygon: fire.perimeter }],
      caveat: FIRE_CAVEAT,
    });
  }
  if (fire.hotspots.length > 0) {
    out.push({
      id: 'fire-hotspots',
      group: 'fire',
      kind: 'scatterplot',
      pickable: true,
      caveat: FIRE_CAVEAT,
      data: fire.hotspots.map((h) => ({
        id: h.id,
        position: h.position,
        // A hotspot has no name; its tooltip headline is what it is, plus the one detail the wire carries
        // (the source's intensity/brightness, or a severity when a caller supplies one) — never the raw id.
        label: pointLabel(
          'Hotspot',
          h.severity ?? (h.brightness !== undefined ? String(h.brightness) : undefined),
        )!,
        ...(h.severity !== undefined ? { severity: h.severity } : {}),
      })),
    });
  }
  return out;
}

export function buildFloodLayers(flood: FloodData | undefined): LayerDescriptor[] {
  if (flood === undefined) return [];
  const out: LayerDescriptor[] = [];
  if (flood.extent !== undefined) {
    out.push({
      id: 'flood-extent',
      group: 'flood',
      kind: 'polygon',
      data: [{ id: 'flood-extent', polygon: flood.extent }],
    });
  }
  if (flood.gauges.length > 0) {
    // The wire carries a flood category and a stage (no gauge name): "MODERATE · 3.2m", "3.2", "MODERATE".
    const reading = (g: GaugeFeature): string | undefined =>
      pointLabel(g.status, g.stage !== undefined ? `${g.stage}${g.unit ?? ''}` : undefined);
    out.push({
      id: 'flood-gauges',
      group: 'flood',
      kind: 'scatterplot',
      pickable: true,
      data: flood.gauges.map((g) => ({
        id: g.id,
        position: g.position,
        ...labelled(pointLabel(g.name, reading(g))),
        ...(g.status !== undefined ? { status: g.status } : {}),
      })),
    });
    // The gauge's category and reading ON the map (2026-09-14): gauges are sparse, so the label reads
    // without clutter — the same treatment the shelters and the weather observation already had.
    const named = flood.gauges.filter((g) => pointLabel(g.name, reading(g)) !== undefined);
    if (named.length > 0) {
      out.push({
        id: 'flood-gauge-labels',
        group: 'flood',
        kind: 'text',
        data: named.map((g) => ({
          id: `${g.id}-label`,
          position: g.position,
          label: pointLabel(g.name, reading(g))!,
        })),
      });
    }
  }
  return out;
}

/** `{ label }` when there is one, else nothing — keeps the datum free of an `undefined` label. */
function labelled(label: string | undefined): { readonly label: string } | Record<never, never> {
  return label !== undefined ? { label } : {};
}

/** "Name · detail", "Name" or "detail" — whichever parts a point actually carries; nothing invented. */
export function pointLabel(
  name: string | undefined,
  detail: string | undefined,
): string | undefined {
  const parts = [name, detail].filter((p): p is string => p !== undefined && p.trim() !== '');
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

// ── Storm family (ADR-032, FR-STORM-2/FEV-5) — ONE toggle, three geometries, default OFF ──────────
// English source-of-record strings. Each is a catalog key under `map.storm.*`; the literal here stays the
// fallback for a provider-less render (FR-I18N-2). The wording is load-bearing, not decorative: the track and
// cone are ADVISORY geometry and say so, while the surge is the impact area that feeds exposure (ADR-032 §3),
// so a reader can never infer "inside the cone = affected" — the misreading NHC/PAGASA both warn against.
export const STORM_TRACK_LABEL = 'Cyclone centre track — advisory, not an impact area';
export const STORM_CONE_LABEL = 'Forecast cone — track-centre uncertainty, not an impact area';
export const STORM_SURGE_LABEL = 'Storm-surge extent — impact area, included in exposure';
export const STORM_CONE_CAVEAT_UNATTRIBUTED =
  'Forecast cone shows where the storm centre may track — NOT the extent of hazardous conditions.';

/** English form of the attributed cone caveat (issuer + advisory instant), the fallback for `storm.coneCaveat`. */
function stormConeCaveatEnglish(agency: string, advisoryAt: string): string {
  return (
    `Forecast cone from ${agency}, advisory ${advisoryAt} — shows where the storm centre may track, ` +
    'NOT the extent of hazardous conditions.'
  );
}

/**
 * The cone's mandatory uncertainty label (FEV-5), the storm counterpart of {@link predictionCaveat}. It names
 * the ISSUING AGENCY and the advisory instant rather than a method/uncertainty pair, because BEACON computes
 * neither — the cone is an ingested product (ADR-032 §6). When the wire carries no attribution the caveat
 * degrades to the unattributed wording: the "cone ≠ impact area" warning is never dropped (Art. XVI).
 */
export function stormConeCaveat(storm: StormData, t?: MapT): string {
  const { agency, advisoryAt } = storm;
  if (agency === undefined || advisoryAt === undefined) {
    return t?.('storm.coneCaveatUnattributed') ?? STORM_CONE_CAVEAT_UNATTRIBUTED;
  }
  return (
    t?.('storm.coneCaveat', { agency, advisoryAt }) ?? stormConeCaveatEnglish(agency, advisoryAt)
  );
}

interface StormLabels {
  readonly track: string;
  readonly cone: string;
  readonly surge: string;
  readonly coneCaveat: string;
}

function stormLabels(storm: StormData, t?: MapT): StormLabels {
  return {
    track: t?.('storm.trackLabel') ?? STORM_TRACK_LABEL,
    cone: t?.('storm.coneLabel') ?? STORM_CONE_LABEL,
    surge: t?.('storm.surgeLabel') ?? STORM_SURGE_LABEL,
    coneCaveat: stormConeCaveat(storm, t),
  };
}

/** One storm POLYGON descriptor (cone or surge): identical shape, different label + caveat. */
function stormPolygon(
  id: 'storm-cone' | 'storm-surge',
  polygon: PolygonRings,
  label: string,
  caveat: string,
): LayerDescriptor {
  return {
    id,
    group: 'storm',
    kind: 'polygon',
    pickable: true,
    caveat,
    // `status` is the sub-kind TOKEN (a machine value, never translated); `label` carries the human meaning.
    data: [{ id, polygon, status: id === 'storm-cone' ? 'CONE' : 'SURGE', label }],
  };
}

/**
 * Cyclone track (a PATH) + forecast cone and surge extent (POLYGONS) as one toggle group. Emits only the
 * geometries the advisory actually supplies, so a track-only or surge-only bulletin renders exactly what it
 * has and nothing more (Art. XVI — degraded, never dead-ended or padded).
 */
export function buildStormLayers(storm: StormData | undefined, t?: MapT): LayerDescriptor[] {
  if (storm === undefined) return [];
  const label = stormLabels(storm, t);
  const out: LayerDescriptor[] = [];
  if (storm.track !== undefined && storm.track.length > 0) {
    out.push({
      id: 'storm-track',
      group: 'storm',
      kind: 'path',
      pickable: true,
      caveat: STORM_CAVEAT,
      data: [{ id: 'storm-track', path: storm.track, status: 'TRACK', label: label.track }],
    });
  }
  if (storm.cone !== undefined) {
    out.push(stormPolygon('storm-cone', storm.cone, label.cone, label.coneCaveat));
  }
  if (storm.surge !== undefined) {
    out.push(stormPolygon('storm-surge', storm.surge, label.surge, STORM_CAVEAT));
  }
  return out;
}

export function buildInfraLayers(nodes: readonly InfraNode[] | undefined): LayerDescriptor[] {
  if (nodes === undefined || nodes.length === 0) return [];
  return [
    {
      id: 'infra-nodes',
      group: 'infra',
      kind: 'scatterplot',
      pickable: true,
      data: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        // The tooltip's headline: the node's kind (the wire carries kind + status, no name) — a hospital
        // is a hospital; a name, when a source ever supplies one, leads. No text layer: Overpass returns
        // hundreds of nodes per region, and the kind repeated a hundred times is noise, not a label.
        ...labelled(pointLabel(n.name, n.kind)),
        ...(n.status !== undefined ? { status: n.status } : {}),
      })),
    },
  ];
}

/** EAGLE-I outage areas — `assumedOffline !== false` (incl. undefined) is treated as the ASSUMED-offline
 *  inference rung, never presented as a confirmed per-address outage (locked decision). */
export function buildOutageLayers(
  areas: readonly OutageArea[] | undefined,
  t?: MapT,
): LayerDescriptor[] {
  if (areas === undefined || areas.length === 0) return [];
  return [
    {
      id: 'outage-areas',
      group: 'outage',
      kind: 'polygon',
      pickable: true,
      caveat: OUTAGE_CAVEAT,
      data: areas.map((a) => {
        const assumed = a.assumedOffline !== false;
        const state = assumed
          ? (t?.('outage.assumedOffline') ?? 'ASSUMED offline')
          : (t?.('outage.reportedOffline') ?? 'Reported offline');
        const count = a.customersOut;
        return {
          id: a.id,
          polygon: a.polygon,
          status: assumed ? 'assumed-offline' : 'reported',
          label:
            count === undefined
              ? state
              : (t?.('outage.withCount', { count: String(count), state }) ??
                `${count} customers out — ${state}`),
        };
      }),
    },
  ];
}

/** Cell-coverage sites (OpenCelliD / CELL infrastructure / CAMARA-mock) — online/offline status + technology
 *  surfaced in the tooltip (the datum, not the group color, carries the per-site distinction). */
export function buildCellLayers(cells: readonly CellCoverage[] | undefined): LayerDescriptor[] {
  if (cells === undefined || cells.length === 0) return [];
  return [
    {
      id: 'cell-coverage',
      group: 'cell',
      kind: 'scatterplot',
      pickable: true,
      caveat: CELL_CAVEAT,
      data: cells.map((c) => ({
        id: c.id,
        position: c.position,
        status: c.online === false ? 'OFFLINE' : 'ONLINE',
        ...(c.technology !== undefined ? { label: c.technology } : {}),
      })),
    },
  ];
}

/** NFHL (or equivalent) regulatory flood-zone polygons — a REGULATORY overlay, never a live extent (T-367). */
export function buildFloodZoneLayers(
  zones: readonly FloodZoneFeature[] | undefined,
  t?: MapT,
): LayerDescriptor[] {
  if (zones === undefined || zones.length === 0) return [];
  return [
    {
      id: 'floodzone-areas',
      group: 'floodzone',
      kind: 'polygon',
      pickable: true,
      caveat: FLOODZONE_CAVEAT,
      data: zones.map((z) => ({
        id: z.id,
        polygon: z.polygon,
        // `zone` is the NFHL zone CODE (a machine value) — only the surrounding wording is localized.
        status: z.zone,
        label: t?.('zone.label', { zone: z.zone }) ?? `Zone ${z.zone}`,
      })),
    },
  ];
}

/**
 * Wind glyph at the deterministic observation point (locked decision — NEVER a synthesized/interpolated
 * grid): one pickable point + its preformatted server label, mirroring the shelters point+text idiom.
 * Exactly one glyph per observation; no client-side geometry derivation (Art. XII).
 */
/**
 * 8-point compass TOKEN → catalog key. The engine emits the token (a closed vocabulary); the abbreviation a
 * reader recognizes is language-specific (Romanian uses V/SV/NV, not W/SW/NW), so it is translated HERE, at
 * the presentation edge, and never inside the engine (ADR-030).
 */
const COMPASS_MESSAGE_KEY = {
  N: 'compass.N',
  NE: 'compass.NE',
  E: 'compass.E',
  SE: 'compass.SE',
  S: 'compass.S',
  SW: 'compass.SW',
  W: 'compass.W',
  NW: 'compass.NW',
} as const;

/**
 * The wind-glyph label. With a translator it is composed from the STRUCTURED fields the engine ships
 * (speed, compass token, bearing, observation time); without one it falls back to the engine's
 * pre-rendered English string — so a provider-less render, a CLI, and an API client all still read
 * correctly. Numbers are passed as strings so the label shows the deterministic figure verbatim, ungrouped.
 */
export function weatherLabel(weather: WeatherObservation, t?: MapT): string {
  if (t === undefined) return weather.label;
  const compassKey = COMPASS_MESSAGE_KEY[weather.compass as keyof typeof COMPASS_MESSAGE_KEY];
  const compass = compassKey === undefined ? weather.compass : t(compassKey);
  return t('weather.label', {
    speed: String(weather.speedKmh),
    compass,
    deg: String(weather.directionDeg),
    observedAt: weather.observedAt,
  });
}

export function buildWeatherLayers(
  weather: WeatherObservation | undefined,
  t?: MapT,
): LayerDescriptor[] {
  if (weather === undefined) return [];
  const label = weatherLabel(weather, t);
  return [
    {
      id: 'weather-observation',
      group: 'weather',
      kind: 'scatterplot',
      pickable: true,
      caveat: WEATHER_CAVEAT,
      data: [{ id: 'weather-observation', position: weather.position, label }],
    },
    {
      id: 'weather-observation-label',
      group: 'weather',
      kind: 'text',
      data: [{ id: 'weather-observation-label', position: weather.position, label }],
    },
  ];
}

// ── Live cameras (E11 "Live Views") — link-only, click-to-open-external ─────────

/** Signature of the external-open seam. Injected into the camera builder so tests can spy the click side
 *  effect; the default is {@link openExternal}. */
export type OpenExternal = (url: string) => void;

/**
 * The ONLY link-out side effect: open a camera's own live-view page in a new tab. Defense-in-depth — opens
 * ONLY an `https://` URL (on top of the upstream domain guard in map-projection), and always with
 * `noopener,noreferrer` so the opened tab can never reach back into the COP (reverse-tabnabbing). The client
 * never embeds/proxies a pixel (Art. XII / link-only doctrine).
 */
export function openExternal(url: string): void {
  // F-153: was `url.startsWith('https://')` — the NINTH private copy of this rule, and the weakest of them
  // all, sitting on the last hop before a real `window.open`. A prefix test accepts `https://192.0.2.1/…`
  // (IP literal, no named host) and a URL of unbounded length; the shared policy rejects both. This is the
  // final gate before the browser acts on a datum, so it should be the STRICTEST check, not the loosest.
  if (!isLinkOnlyUrl(url)) return;
  if (typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Live-camera pins — one pickable violet scatterplot (buildCellLayers idiom: the datum, not the group color,
 * carries the per-pin distinction). Each datum carries {label:title, status:LIVE|SNAPSHOT, provider, viewUrl}
 * for the tooltip; clicking a pin opens its `viewUrl` externally via the injected `open` seam, but ONLY for an
 * `https://` target (the https guard also lives here, so a non-https datum never reaches the seam).
 */
export function buildCameraLayers(
  cameras: readonly CameraPin[] | undefined,
  open: OpenExternal = openExternal,
): LayerDescriptor[] {
  if (cameras === undefined || cameras.length === 0) return [];
  return [
    {
      id: 'cameras-pins',
      group: 'cameras',
      kind: 'scatterplot',
      pickable: true,
      caveat: CAMERA_CAVEAT,
      onClick: (datum: LayerDatum) => {
        // F-153: same shared policy as `openExternal` below — the click path and the open path must not be
        // able to disagree about what an acceptable link is.
        const url = datum.viewUrl;
        if (isLinkOnlyUrl(url)) open(url);
      },
      data: cameras.map((c) => ({
        id: c.id,
        position: c.position,
        label: c.title,
        status: c.isLive ? 'LIVE' : 'SNAPSHOT',
        provider: c.provider,
        viewUrl: c.viewUrl,
      })),
    },
  ];
}

/** Exposure = deterministic nodes-in-hazard from the engine — plotted verbatim, NO client scoring (T-365). */
export function buildExposureLayers(nodes: readonly ExposureNode[] | undefined): LayerDescriptor[] {
  if (nodes === undefined || nodes.length === 0) return [];
  return [
    {
      id: 'exposure-nodes',
      group: 'exposure',
      kind: 'scatterplot',
      pickable: true,
      data: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        // The wire carries the exposure REASON ("inside HOTSPOT buffer"); kind/name lead when supplied.
        ...labelled(pointLabel(n.name, n.kind ?? n.hazard)),
      })),
    },
  ];
}

/** Reports/SOS pins — each marked `unverified` (drives the UnverifiedBadge) + PII-gated position (T-366/T-370). */
export function buildReportLayers(
  reports: readonly ReportFeature[] | undefined,
  role: ActorRole,
): LayerDescriptor[] {
  if (reports === undefined || reports.length === 0) return [];
  return [
    {
      id: 'reports-sos',
      group: 'reports',
      kind: 'scatterplot',
      pickable: true,
      data: reports.map((r) => ({
        id: r.id,
        position: visibleGeometry(r, role),
        unverified: true,
        ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
        ...(r.text !== undefined ? { label: r.text } : {}),
      })),
    },
  ];
}

/**
 * One descriptor PER prediction (ADR-033 §3.1), each carrying its own `predictionCaveat` — method, inputs and
 * uncertainty stay attached to the figure they describe, so multiple predictions render as multiple labeled
 * cones rather than one merged polygon with an averaged caveat.
 *
 * The first cone keeps the historical descriptor id `prediction-cone` verbatim, so the single-prediction case
 * (every seed today) produces a byte-identical descriptor set; later cones take an index suffix.
 */
export function buildPredictionLayers(
  cones: readonly PredictionCone[] | undefined,
): LayerDescriptor[] {
  if (cones === undefined) return [];
  return cones.map((cone, i) => ({
    id: i === 0 ? 'prediction-cone' : `prediction-cone-${i}`,
    group: 'prediction' as const,
    kind: 'polygon' as const,
    pickable: true,
    caveat: predictionCaveat(cone),
    data: [{ id: cone.id, polygon: cone.polygon }],
  }));
}

export function buildRouteLayers(route: RouteFeature | undefined): LayerDescriptor[] {
  if (route === undefined || route.path.length === 0) return [];
  return [
    {
      id: 'evac-route',
      group: 'route',
      kind: 'path',
      pickable: true,
      // Only when the claim is explicitly false. An ABSENT `hazardAvoided` means the server said nothing,
      // and inventing a caveat for silence would be its own small dishonesty.
      ...(route.hazardAvoided === false ? { caveat: ROUTE_DIRECT_CAVEAT } : {}),
      data: [{ id: route.id, path: route.path }],
    },
  ];
}

/** Shelters — a point + a NUMERIC capacity label (capacity vs demand encoded non-color, T-369/T-386). */
export function buildShelterLayers(
  shelters: readonly ShelterFeature[] | undefined,
  t?: MapT,
): LayerDescriptor[] {
  if (shelters === undefined || shelters.length === 0) return [];
  const points: LayerDatum[] = shelters.map((s) => ({ id: s.id, position: s.position }));
  const labels: LayerDatum[] = shelters.map((s) => ({
    id: `${s.id}-label`,
    position: s.position,
    label: shelterCapacityLabel(s, t),
  }));
  return [
    { id: 'shelters-points', group: 'shelters', kind: 'scatterplot', pickable: true, data: points },
    { id: 'shelters-labels', group: 'shelters', kind: 'text', data: labels },
  ];
}

// ── Registry + the pure aggregate mapping ──────────────────────────────────────

type LayerBuilder = (data: MapData, role: ActorRole, t?: MapT) => LayerDescriptor[];

/** Exported so the exhaustive-coverage guard test can assert it keys EXACTLY on LAYER_IDS — belt-and-braces
 *  against a future refactor that drops the `Record<LayerId, …>` annotation and with it the compile guarantee. */
export const LAYER_BUILDERS: Record<LayerId, LayerBuilder> = {
  fire: (d) => buildFireLayers(d.fire),
  flood: (d) => buildFloodLayers(d.flood),
  storm: (d, _role, t) => buildStormLayers(d.storm, t),
  floodzone: (d, _role, t) => buildFloodZoneLayers(d.floodZones, t),
  infra: (d) => buildInfraLayers(d.infrastructure),
  weather: (d, _role, t) => buildWeatherLayers(d.weather, t),
  cameras: (d) => buildCameraLayers(d.cameras),
  outage: (d, _role, t) => buildOutageLayers(d.outage, t),
  cell: (d) => buildCellLayers(d.cell),
  exposure: (d) => buildExposureLayers(d.exposure),
  reports: (d, role) => buildReportLayers(d.reports, role),
  prediction: (d) => buildPredictionLayers(d.predictions),
  route: (d) => buildRouteLayers(d.route),
  shelters: (d, _role, t) => buildShelterLayers(d.shelters, t),
};

/**
 * Pure map of (visible layers + role) × data → the deck.gl descriptor set. A layer contributes its
 * descriptors only when its toggle is ON; flipping a toggle adds/removes exactly that group's descriptors.
 */
export function buildLayers(state: MapLayerState, data: MapData, t?: MapT): LayerDescriptor[] {
  const out: LayerDescriptor[] = [];
  for (const id of LAYER_IDS) {
    if (!state.layers[id]) continue;
    out.push(...LAYER_BUILDERS[id](data, state.role, t));
  }
  return out;
}
