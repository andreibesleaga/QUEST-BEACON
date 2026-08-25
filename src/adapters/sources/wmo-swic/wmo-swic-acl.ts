// BEACON — WMO-SWIC CAP relay anti-corruption layer (B3.2; adapter-contract §4, Art. XII/XVI). Maps the
// WMO Severe Weather Information Centre per-source relay (RSS 2.0 index → per-alert CAP v1.2 XML) into
// canonical NewsItems (NewsIntelPort P6). The ONLY place the raw RSS/CAP shapes exist; no upstream field
// escapes above this module (AGENTS.md §3). Lenient by directive: unknown fields ignored, malformed
// items/documents dropped AND counted (never silently unaccounted for).
//
// VERIFIED SOURCE (2026-07-27, live-probed — docs/features/GLOBAL_ZONE_SOURCE_RESEARCH.md "LATE
// ADDITION 3"): index `https://severeweather.wmo.int/v2/cap-alerts/<sourceId>/rss.xml`; each <item>
// <link> is a per-alert CAP v1.2 document on the same host. First configured source `ph-pagasa-en`
// (PAGASA-DOST; CC BY 4.0 declared verbatim in PAGASA's native feed). Observed alert families: `gfa`
// (General Flood Advisory — REAL province-level geometry, multiple <polygon> per <area>, SAME geocodes)
// and `acp` (Tropical Cyclone Alert — see F-48 below). No other family is claimed (F-51).
//
// MAPPING CHOICE (F-48 🔴, binding): every CAP alert maps to the honest advisory entity
// NewsIntelPort.NewsItem — this adapter NEVER constructs a HazardGeometry, for ANY family. Why this is
// the least inventive mapping the domain offers:
//   • PAGASA's `acp` <polygon> is its whole Area of Responsibility (≈5–21°N, 113–130°E) — an
//     administrative ALERTING area, not the storm footprint. Rendering it as hazard geometry would paint
//     a false polygon across the West Pacific (the F-06 failure class). The domain's advisory hazard
//     kinds (TRACK = centre line, CONE = track-centre uncertainty envelope — hazard-geometry.ts) are
//     DIFFERENT semantics: labelling the PAR a "CONE" would be a second lie. NewsItem — the exact
//     precedent set by meteoalarm-ro for geometry-poor official warnings — is the honest fit.
//   • Because no HazardGeometry is ever emitted, no `acp` area can EVER reach exposure computation
//     (EXPOSURE_BEARING_BY_KIND filters HazardGeometry.kind — an entity this adapter never produces) or
//     render as a hazard footprint. Enforcement is structural, not a filter.
//   • `gfa` province polygons ARE genuine flood geometry; they are parsed faithfully below (F-49) and
//     exported for a future explicit flood-footprint promotion, but are NOT emitted as hazards by this
//     adapter today — PH flood/storm footprints come from the global tier (GloFAS/GDACS) per the spike.
//
// GEOMETRY PARSING (F-49, binding — pinned by fixture tests even though NewsItems carry no geometry):
//   • CAP allows MULTIPLE <polygon> per <area> (observed live in the `gfa`): capAreaMultiPolygon emits a
//     GeoJSON MultiPolygon over ALL rings — never first-ring-only.
//   • CAP coordinate order is `lat,lon` (CAP v1.2 §3.2.4) — REVERSED from GeoJSON: axes are swapped.
import { XMLParser } from 'fast-xml-parser';
import type { NewsItem } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';

/** One usable RSS index item (link = the per-alert CAP document URL). */
export interface SwicIndexItem {
  readonly title: string;
  readonly link: string;
}

/** Lenient index parse result: usable items + the count of items dropped as unusable (no link). */
export interface SwicIndexResult {
  readonly items: readonly SwicIndexItem[];
  readonly skipped: number;
}

/** One CAP <geocode> pair, carried verbatim (e.g. SAME 153600000 on the Lanao Del Sur `gfa` area). */
export interface SwicGeocode {
  readonly valueName: string;
  readonly value: string;
}

/** One CAP <area>: description + ALL raw `lat,lon …` polygon strings (F-49) + geocodes, verbatim. */
export interface SwicCapArea {
  readonly areaDesc: string;
  readonly polygons: readonly string[];
  readonly geocodes: readonly SwicGeocode[];
}

/** One parsed CAP alert (first <info> block; unknown fields ignored — lenient by directive). */
export interface SwicCapAlert {
  readonly url: string; // the CAP document URL — unique per alert, becomes the NewsItem url
  readonly identifier: string;
  readonly sender: string;
  readonly sent: string; // ISO-8601 (CAP <sent>)
  readonly status: string;
  readonly msgType: string;
  readonly event: string;
  readonly headline: string;
  readonly severity: string;
  readonly certainty: string;
  readonly urgency: string;
  readonly effective: string;
  readonly expires: string;
  readonly areas: readonly SwicCapArea[];
}

/** GeoJSON MultiPolygon coordinates: polygons → rings → [lon, lat] positions. */
export interface CapMultiPolygon {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly (readonly [number, number])[])[])[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false, // keep every value a string (ids/timestamps/coordinates never coerced)
  parseAttributeValue: false,
});

interface RawItem {
  readonly title?: string;
  readonly link?: string;
}
interface RawGeocode {
  readonly valueName?: string;
  readonly value?: string;
}
interface RawArea {
  readonly areaDesc?: string;
  readonly polygon?: string | readonly string[];
  readonly geocode?: RawGeocode | readonly RawGeocode[];
}
interface RawInfo {
  readonly event?: string;
  readonly headline?: string;
  readonly severity?: string;
  readonly certainty?: string;
  readonly urgency?: string;
  readonly effective?: string;
  readonly expires?: string;
  readonly area?: RawArea | readonly RawArea[];
}
interface RawAlert {
  readonly identifier?: string;
  readonly sender?: string;
  readonly sent?: string;
  readonly status?: string;
  readonly msgType?: string;
  readonly info?: RawInfo | readonly RawInfo[];
}

/** Parse the relay RSS 2.0 index into CAP-document links. Lenient: a linkless <item> is skipped+counted. */
export function parseSwicIndex(xml: string): SwicIndexResult {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: RawItem | readonly RawItem[] } } };
  const items: SwicIndexItem[] = [];
  let skipped = 0;
  for (const raw of toArray(doc.rss?.channel?.item)) {
    const link = str(raw.link);
    if (link === '') skipped += 1;
    else items.push({ title: str(raw.title), link });
  }
  return { items, skipped };
}

/**
 * Parse ONE CAP v1.2 document. Lenient: returns null (the caller counts the drop) when the document has
 * no <alert> root, no <info>, no event/headline, or no parseable <sent> — it never aborts the batch.
 */
export function parseSwicCap(xml: string, url: string): SwicCapAlert | null {
  const doc = parser.parse(xml) as { alert?: RawAlert };
  const alert = doc.alert;
  const info = toArray(alert?.info)[0]; // first <info> block (the relay's are single-language)
  if (alert === undefined || info === undefined) return null;
  const event = str(info.event);
  const headline = str(info.headline);
  const sent = str(alert.sent);
  if ((event === '' && headline === '') || !isIsoDate(sent)) return null;
  return {
    url,
    identifier: str(alert.identifier),
    sender: str(alert.sender),
    sent,
    status: str(alert.status),
    msgType: str(alert.msgType),
    event,
    headline,
    severity: str(info.severity),
    certainty: str(info.certainty),
    urgency: str(info.urgency),
    effective: str(info.effective),
    expires: str(info.expires),
    areas: toArray(info.area).map(mapArea),
  };
}

function mapArea(raw: RawArea): SwicCapArea {
  return {
    areaDesc: str(raw.areaDesc),
    polygons: toArray(raw.polygon).map((p) => str(p)).filter((p) => p !== ''),
    geocodes: toArray(raw.geocode)
      .map((g) => ({ valueName: str(g.valueName), value: str(g.value) }))
      .filter((g) => g.valueName !== '' && g.value !== ''),
  };
}

/**
 * F-49: ALL of an area's <polygon> rings → ONE GeoJSON MultiPolygon (never first-ring-only), with the
 * CAP `lat,lon` axis order swapped to GeoJSON `[lon, lat]`. Returns null for a geometry-less area (e.g.
 * a geocode-only area) — geometry is never fabricated (Art. XVI). A malformed ring (non-numeric pair or
 * <4 points) is dropped; an unclosed ring is closed deterministically (CAP requires closure — this only
 * normalizes, it invents no position).
 */
export function capAreaMultiPolygon(area: SwicCapArea): CapMultiPolygon | null {
  const coordinates = area.polygons
    .map(parseRing)
    .filter((r): r is readonly (readonly [number, number])[] => r !== null)
    .map((ring) => [ring]);
  return coordinates.length === 0 ? null : { type: 'MultiPolygon', coordinates };
}

function parseRing(raw: string): readonly (readonly [number, number])[] | null {
  const pts: [number, number][] = [];
  for (const token of raw.trim().split(/\s+/)) {
    const [latS, lonS] = token.split(',');
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    pts.push([lon, lat]); // CAP order is lat,lon — swapped to GeoJSON [lon, lat] (F-49)
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length < 4 || first === undefined || last === undefined) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
  return pts;
}

// The observed `acp` (Tropical Cyclone Alert) family marker. ONLY this family is classified as
// advisory-extent; `gfa` events carry genuine province geometry. No other family is claimed (F-51).
const TROPICAL_CYCLONE_RE = /tropical cyclone/i;

/**
 * F-48 🔴: true when this alert's areas are an ALERTING extent, not hazard geometry — the observed
 * PAGASA `acp` family, whose <polygon> is the whole Philippine Area of Responsibility (wider than the
 * `ph` bbox), NOT the storm footprint. Such areas must never be rendered as a footprint nor reach
 * exposure computation; the mapper below labels them explicitly instead.
 */
export function isAdvisoryExtentOnly(alert: SwicCapAlert): boolean {
  return TROPICAL_CYCLONE_RE.test(alert.event) || TROPICAL_CYCLONE_RE.test(alert.headline);
}

const ADVISORY_EXTENT_LABEL =
  'alerting area only, not the storm extent — the CAP polygon is the agency area of responsibility; storm footprint comes from GDACS';

export const swicCapMapper: AntiCorruptionMapper<SwicCapAlert, NewsItem> = {
  toCanonical(raw: SwicCapAlert): NewsItem {
    // parseSwicCap already guarantees url/title/sent; this is the last-resort typed guard (Art. XI).
    const title = raw.headline !== '' ? raw.headline : raw.event;
    // Official national alerting authority relayed by WMO — corroborating-official in news grounding,
    // never an unverified social signal (Art. XIV). Same deterministic tier as meteoalarm-ro.
    return {
      title,
      url: raw.url,
      publishedAt: raw.sent,
      summary: buildSummary(raw),
      sourceAuthority: 'OFFICIAL',
      credibility: 0.85,
    };
  },
};

/** Deterministic, verbatim-fields advisory summary; `acp`-family alerts carry the F-48 extent label. */
function buildSummary(raw: SwicCapAlert): string {
  const parts: string[] = [];
  const areaNames = raw.areas.map((a) => a.areaDesc).filter((d) => d !== '');
  if (areaNames.length > 0) parts.push(areaNames.join('; '));
  if (raw.event !== '') parts.push(raw.event);
  const grade = [raw.severity, raw.certainty, raw.urgency].filter((s) => s !== '');
  if (grade.length > 0) parts.push(`severity ${grade.join('/')}`);
  if (raw.effective !== '' && raw.expires !== '') parts.push(`effective ${raw.effective} until ${raw.expires}`);
  else if (raw.expires !== '') parts.push(`expires ${raw.expires}`);
  if (isAdvisoryExtentOnly(raw)) parts.push(ADVISORY_EXTENT_LABEL);
  return parts.join(' — ');
}

function toArray<T>(v: T | readonly T[] | undefined): readonly T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v as T];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isIsoDate(s: string): boolean {
  return s !== '' && !Number.isNaN(Date.parse(s));
}
