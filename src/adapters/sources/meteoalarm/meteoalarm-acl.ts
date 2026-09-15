// BEACON — MeteoAlarm generic anti-corruption layer (B3.1; adapter-contract §4, Art. XII). Maps one
// MeteoAlarm legacy-Atom <entry> → a canonical NewsItem (NewsIntelPort P6). The ONLY place the raw
// MeteoAlarm shape exists; no upstream field escapes above this module (AGENTS.md §3).
//
// WIDENED from src/adapters/sources/meteoalarm-ro/meteoalarm-ro-acl.ts (E4·T-177) BACKWARD-COMPATIBLY:
// the feed structure is identical for every MeteoAlarm country feed
// (`https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-<country>`, slug = English country name —
// GLOBAL_ZONE_SOURCE_RESEARCH.md "Cross-zone aggregators": LIVE, keyless, CC-BY-4.0-equivalent, GR/ES/PT/IT
// verified 2026-07-18; RO recorded 2026-07-07). `meteoalarm-ro-acl.ts` now re-exports these under its
// original names, so the RO adapter, fixtures and tests are unchanged.
//
// VERIFIED SOURCE SHAPE (2026-07-07, RO feed — identical producer for all countries):
//   Each <entry> carries: <title>, <id> (unique per area), <published>, <cap:areaDesc> (area name),
//   <cap:geocode> NUTS3, <cap:event> ("awareness_type=N, awareness_level=M"), <cap:severity/certainty/
//   urgency/effective/onset/expires>, and <link> elements (area page, application/cap+xml, related).
//   >>> NO GEOMETRY <<< — no polygons, points, or lat/long; only area names + awareness codes.
// MAPPING CHOICE: because the keyless legacy feed has NO usable geometry, mapping to HazardGeometry would
//   require FABRICATING polygons/points we do not have (forbidden — Art. XVI honesty). We therefore map to
//   the honest advisory entity NewsIntelPort.NewsItem (title/url/publishedAt/summary) — an official
//   weather-warning news/advisory rung, exactly as DATA_SOURCE_VERIFICATION §10.4 lists MeteoAlarm as a
//   NewsIntel per-country Atom source. The unique Atom <id> is the NewsItem url (the shared cap+xml link
//   repeats across areas in this feed, so it is NOT unique — <id> is).
import { XMLParser } from 'fast-xml-parser';
import type { NewsItem } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One raw MeteoAlarm Atom <link> (attributes only; self-closing). */
export interface MeteoalarmLink {
  readonly '@_href'?: string;
  readonly '@_type'?: string;
  readonly '@_rel'?: string;
  readonly '@_title'?: string;
}

/** One raw MeteoAlarm Atom <entry>. Raw until mapped (namespaces stripped by the parser). */
export interface MeteoalarmEntry {
  readonly title?: string;
  readonly id?: string;
  readonly published?: string;
  readonly updated?: string;
  readonly areaDesc?: string;
  readonly event?: string;
  readonly severity?: string;
  readonly certainty?: string;
  readonly urgency?: string;
  readonly effective?: string;
  readonly expires?: string;
  readonly link?: MeteoalarmLink | readonly MeteoalarmLink[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true, // cap:event -> event, keeps the ACL free of namespace noise
  parseTagValue: false, // keep every value a string (ids/timestamps never coerced)
  parseAttributeValue: false,
});

/** Parse a MeteoAlarm legacy-Atom country feed into its raw <entry> list (namespaces stripped). */
export function parseMeteoalarm(xml: string): readonly MeteoalarmEntry[] {
  const doc = parser.parse(xml) as { feed?: { entry?: MeteoalarmEntry | MeteoalarmEntry[] } };
  return toArray(doc.feed?.entry);
}

export const meteoalarmMapper: AntiCorruptionMapper<MeteoalarmEntry, NewsItem> = {
  toCanonical(raw: MeteoalarmEntry): NewsItem {
    const title = str(raw.title);
    const url = str(raw.id) || capLink(raw.link);
    const publishedAt = str(raw.published);
    if (title === '' || url === '' || !isIsoDate(publishedAt)) {
      throw makeAdapterError(
        'PARSE',
        `MeteoAlarm entry unmappable (title/id/published): '${title}' '${url}' '${publishedAt}'`,
      );
    }
    // MeteoAlarm is the official EUMETNET/national-met-service warning aggregator — stamp authority so
    // news grounding counts it as corroborating-official, never as an unverified social signal.
    return {
      title,
      url,
      publishedAt,
      summary: buildSummary(raw),
      sourceAuthority: 'OFFICIAL',
      credibility: 0.85,
    };
  },
};

/** The application/cap+xml warning-document link (fallback url when the Atom id is absent). */
function capLink(link: MeteoalarmEntry['link']): string {
  const cap = toArray(link).find((l) => str(l['@_type']) === 'application/cap+xml');
  return str(cap?.['@_href']);
}

/** Deterministic, verbatim-fields advisory summary (no invented decoding of the awareness codes). */
function buildSummary(raw: MeteoalarmEntry): string {
  const parts: string[] = [];
  if (str(raw.areaDesc) !== '') parts.push(str(raw.areaDesc));
  if (str(raw.event) !== '') parts.push(str(raw.event));
  const grade = [str(raw.severity), str(raw.certainty), str(raw.urgency)].filter((s) => s !== '');
  if (grade.length > 0) parts.push(`severity ${grade.join('/')}`);
  if (str(raw.effective) !== '' && str(raw.expires) !== '') {
    parts.push(`effective ${str(raw.effective)} until ${str(raw.expires)}`);
  }
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
