// BEACON — GDACS anti-corruption layer (E4·T-171; adapter-contract §4, F1/Art. XII). Maps a GDACS event
// GeoJSON feature → a canonical HazardGeometry. The ONLY place the raw GDACS shape exists; no GDACS field
// escapes above this module (AGENTS.md §3). Geometry is produced deterministically here — never the LLM.
//
// Scope: BEACON covers wildfires + floods, so ONLY GDACS eventtype WF/FL are kept (filtered at parse — not
// silently dropped in the mapper). Honest limitation: GDACS is a COARSE global alert feed — the event
// geometry is a centroid point, not an authoritative perimeter/reach; it is corroborating context.
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

// GDACS events are not yet correlated to a BEACON incident; a stable sentinel keeps provenance intact.
const UNASSIGNED_INCIDENT = asId<IncidentId>('gdacs-unassigned');

// In-scope GDACS eventtype → domain HazardGeometry.kind. WF=wildfire (hotspot centroid), FL=flood (reach).
const KIND_BY_EVENTTYPE: Record<string, 'HOTSPOT' | 'FLOOD_REACH'> = { WF: 'HOTSPOT', FL: 'FLOOD_REACH' };

interface GdacsProps {
  readonly eventtype?: string;
  readonly eventid?: number | string;
  readonly episodeid?: number | string;
  readonly fromdate?: string;
  readonly alertlevel?: string;
  readonly eventname?: string;
}

interface GdacsGeometry {
  readonly type?: string;
  // Point → [lon,lat]; GDACS also serves Polygon/MultiPolygon footprints (nested arrays) for some events.
  readonly coordinates?: readonly unknown[];
}

/** One raw GDACS event feature (centroid-or-footprint geometry + event properties). Raw until mapped. */
export interface GdacsFeature {
  readonly bbox?: readonly number[];
  readonly geometry?: GdacsGeometry | null;
  readonly properties?: GdacsProps | null;
}

/** Parse a GDACS event GeoJSON FeatureCollection, keeping only in-scope wildfire (WF) + flood (FL) events. */
export function parseGdacsEvents(text: string): GdacsFeature[] {
  const doc = JSON.parse(text) as { features?: GdacsFeature[] };
  const features = Array.isArray(doc.features) ? doc.features : [];
  return features.filter((f) => (f.properties?.eventtype ?? '') in KIND_BY_EVENTTYPE);
}

export const gdacsMapper: AntiCorruptionMapper<GdacsFeature, HazardGeometry> = {
  toCanonical(raw: GdacsFeature, ctx: MapContext): HazardGeometry {
    const props: GdacsProps = raw.properties ?? {};
    const kind = KIND_BY_EVENTTYPE[props.eventtype ?? ''];
    if (kind === undefined) {
      throw makeAdapterError('PARSE', `GDACS event out of scope/missing eventtype: '${props.eventtype}'`);
    }
    const [lon, lat] = locate(raw);
    return makeHazardGeometry({
      id: eventId(props),
      incidentId: UNASSIGNED_INCIDENT,
      sourceId: asId<SourceId>(ctx.sourceRecordId),
      kind,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      observedAt: toIsoUtc(props.fromdate, ctx.fetchedAt),
    });
  },
};

/**
 * A representative [lon,lat] for the event. GDACS serves Point centroids for most events but
 * Polygon/MultiPolygon footprints for some (observed live 2026-07-15; one such row used to fail the whole
 * LIVE fetch → silent MOCK degradation). For a footprint, the honest representative location is the
 * feature's own bbox centre (the COP marks GDACS events as points — coarse-feed limitation, header note).
 */
function locate(raw: GdacsFeature): [number, number] {
  const geom = raw.geometry;
  if (geom?.type === 'Point') {
    const lon = geom.coordinates?.[0];
    const lat = geom.coordinates?.[1];
    if (isFiniteNum(lon) && isFiniteNum(lat)) return [lon, lat];
  }
  const b = raw.bbox;
  if (Array.isArray(b) && b.length >= 4 && b.slice(0, 4).every(isFiniteNum)) {
    return [((b[0] as number) + (b[2] as number)) / 2, ((b[1] as number) + (b[3] as number)) / 2];
  }
  throw makeAdapterError('PARSE', `GDACS event has neither a Point geometry nor a finite bbox`);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function eventId(props: GdacsProps): HazardGeometryId {
  return asId<HazardGeometryId>(`gdacs:${props.eventtype}:${props.eventid ?? 'x'}:${props.episodeid ?? '0'}`);
}

/** GDACS `fromdate` is second-resolution ISO with no zone; normalize to explicit UTC. */
function toIsoUtc(t: string | undefined, fallback: string): string {
  if (t === undefined || t.trim() === '') return fallback;
  return /(?:Z|[+-]\d\d:\d\d)$/.test(t) ? t : `${t}Z`;
}
