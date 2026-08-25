// BEACON — Agency-RSS anti-corruption layer (D-32/D-33, adapter-contract §4, NewsIntelPort P6, Art. XII).
// Normalizes BOTH RSS 2.0 (<rss><channel><item>) and Atom (<feed><entry>) into ONE raw shape, then maps
// that shape to a canonical NewsItem. This is the ONLY place either raw feed shape exists; no upstream
// field escapes above this module (AGENTS.md §3).
//
// VERIFIED SOURCES (audit/DATA_SOURCE_VERIFICATION.md §10.4/§10.5): the AGENCYRSS_FEEDS / AGENCYRSS_FEEDS_RO
// catalog — ReliefWeb, GDACS, EONET, FloodList, MeteoAlarm-equivalent agency wires, Al Jazeera/CBS world
// news, and (RO) Digi24/ProTV/HotNews/Mediafax. Mixed RSS 2.0 and Atom shapes across the set (verified
// 2026-07-02/07).
//
// LENIENCY (deliberate departure from the stricter meteoalarm-ro ACL): agency RSS/Atom feeds are far less
// controlled than a single verified government feed — some upstream <item>/<entry> elements are routinely
// malformed (missing link, unparsable date, empty title). Rather than fail the WHOLE feed on one bad
// element (Art. XI "never silently dropped" would otherwise abort the batch via the shared mapRows runner,
// which re-throws the first PARSE), parseAgencyRss() validates and normalizes EACH element itself and
// SKIPS the ones it cannot map, returning an explicit `skipped` count so the drop is counted, not hidden.
// The mapper below is then a defensive final check (never expected to throw on parser-emitted entries).
//
// AUTHORITY MAP (deterministic, adapter-contract §4 — never LLM-scored, Art. XII): the article/item URL's
// hostname decides source tier. For every feed in the verified catalog the item link's host equals the
// feed's own publishing host (ReliefWeb items link to reliefweb.int, GDACS items link to gdacs.org, a
// Digi24 item links to digi24.ro, etc.) — so "authority by feed host" and "authority by item-link host"
// coincide for this catalog, and using the item link keeps the mapper self-contained (no feed-URL context
// needs to be threaded through MapContext).
//   reliefweb.int (+ subdomains) | gdacs.org (+ subdomains) | any host containing "inciweb" → OFFICIAL, 0.85
//   everything else                                                                          → MEDIA,    0.65
import type { NewsItem, SourceAuthority } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';
import { XMLParser } from 'fast-xml-parser';

/** One raw RSS 2.0 or Atom link (attributes only; Atom links are self-closing with @_href/@_rel). */
export interface AgencyRssLink {
  readonly '@_href'?: string;
  readonly '@_rel'?: string;
}

/** One raw RSS 2.0 <item> (namespaces stripped by the parser). */
interface RawRssItem {
  readonly title?: string;
  readonly link?: string;
  readonly pubDate?: string;
  readonly description?: string;
}

/** One raw Atom <entry> (namespaces stripped by the parser). */
interface RawAtomEntry {
  readonly title?: string;
  readonly link?: AgencyRssLink | readonly AgencyRssLink[];
  readonly published?: string;
  readonly updated?: string;
  readonly summary?: string;
}

/**
 * The ONE normalized raw shape both RSS 2.0 and Atom collapse into (already validated + ISO-dated by
 * parseAgencyRss). This is what the mapper below sees — it never touches raw RSS/Atom fields directly.
 */
export interface AgencyRssRawEntry {
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string; // ISO-8601 (already normalized from pubDate/updated/published)
  readonly summary: string; // '' when the feed carried no description/summary
}

export interface AgencyRssParseResult {
  readonly entries: readonly AgencyRssRawEntry[];
  readonly skipped: number; // count of <item>/<entry> elements dropped as unmappable (lenient, never silent)
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true, // atom:link -> link, dc:subject -> subject, etc.
  parseTagValue: false, // keep every value a string (dates/urls never coerced)
  parseAttributeValue: false,
});

/**
 * Parse ONE feed body (RSS 2.0 or Atom — auto-detected by root element) into normalized raw entries.
 * Lenient: an <item>/<entry> missing title/link/date, or carrying an unparsable date, is SKIPPED and
 * counted — it never aborts the rest of the feed (contrast meteoalarm-ro's single-feed strict throw).
 */
export function parseAgencyRss(xml: string): AgencyRssParseResult {
  const doc = parser.parse(xml) as {
    rss?: { channel?: { item?: RawRssItem | readonly RawRssItem[] } };
    feed?: { entry?: RawAtomEntry | readonly RawAtomEntry[] };
  };
  const isAtom = doc.feed !== undefined;
  const entries: AgencyRssRawEntry[] = [];
  let skipped = 0;

  if (isAtom) {
    for (const raw of toArray(doc.feed?.entry)) {
      const normalized = normalizeAtom(raw);
      if (normalized === undefined) {
        skipped += 1;
      } else {
        entries.push(normalized);
      }
    }
  } else {
    for (const raw of toArray(doc.rss?.channel?.item)) {
      const normalized = normalizeRss(raw);
      if (normalized === undefined) {
        skipped += 1;
      } else {
        entries.push(normalized);
      }
    }
  }
  return { entries, skipped };
}

function normalizeRss(raw: RawRssItem): AgencyRssRawEntry | undefined {
  const title = str(raw.title);
  const url = str(raw.link);
  const dateRaw = str(raw.pubDate);
  if (title === '' || url === '' || !isIsoParsable(dateRaw)) return undefined;
  return { title, url, publishedAt: new Date(dateRaw).toISOString(), summary: str(raw.description) };
}

function normalizeAtom(raw: RawAtomEntry): AgencyRssRawEntry | undefined {
  const title = str(raw.title);
  const url = atomLink(raw.link);
  const dateRaw = str(raw.published) || str(raw.updated);
  if (title === '' || url === '' || !isIsoParsable(dateRaw)) return undefined;
  return { title, url, publishedAt: new Date(dateRaw).toISOString(), summary: str(raw.summary) };
}

/** Prefer the rel="alternate" Atom link (the human-facing article page); fall back to the first link. */
function atomLink(link: RawAtomEntry['link']): string {
  const links = toArray(link);
  const alternate = links.find((l) => str(l['@_rel']) === 'alternate' || str(l['@_rel']) === '');
  return str((alternate ?? links[0])?.['@_href']);
}

export const agencyRssMapper: AntiCorruptionMapper<AgencyRssRawEntry, NewsItem> = {
  toCanonical(raw: AgencyRssRawEntry): NewsItem {
    const title = str(raw.title);
    const url = str(raw.url);
    const publishedAt = str(raw.publishedAt);
    if (title === '' || url === '' || !isIsoParsable(publishedAt)) {
      throw makeAdapterError(
        'PARSE',
        `agency-rss entry unmappable (title/url/publishedAt): '${title}' '${url}' '${publishedAt}'`,
      );
    }
    const { sourceAuthority, credibility } = authorityFor(url);
    const summary = str(raw.summary);
    return {
      title,
      url,
      publishedAt,
      ...(summary !== '' ? { summary } : {}),
      sourceAuthority,
      credibility,
    };
  },
};

/** Deterministic authority/credibility tier from the item URL's hostname (see module header). */
export function authorityFor(url: string): { sourceAuthority: SourceAuthority; credibility: number } {
  const host = hostOf(url);
  if (isOfficialHost(host)) return { sourceAuthority: 'OFFICIAL', credibility: 0.85 };
  return { sourceAuthority: 'MEDIA', credibility: 0.65 };
}

function isOfficialHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'reliefweb.int' ||
    h.endsWith('.reliefweb.int') ||
    h === 'gdacs.org' ||
    h.endsWith('.gdacs.org') ||
    h.includes('inciweb')
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function toArray<T>(v: T | readonly T[] | undefined): readonly T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v as T];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isIsoParsable(s: string): boolean {
  return s !== '' && !Number.isNaN(Date.parse(s));
}
