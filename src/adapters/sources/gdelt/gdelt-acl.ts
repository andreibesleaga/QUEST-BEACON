// BEACON — GDELT anti-corruption layer (E4·T-157; adapter-contract §4, NewsIntelPort P6, Art. XII). Maps
// raw GDELT DOC 2.0 ArtList JSON articles[] -> canonical NewsItem. This is the ONLY place the raw GDELT
// shape exists; no upstream field escapes above this module (AGENTS.md §3).
//
// VERIFIED SOURCE (DATA_SOURCE_VERIFICATION §5/§10.4): `api.gdeltproject.org/api/v2/doc/doc`, keyless,
// ~15-min updates, global, open. One article: { url, url_mobile, title, seendate (YYYYMMDDTHHMMSSZ),
// socialimage, domain, language, sourcecountry }. GDELT is a noisy, broad web-scrape aggregator (not a
// curated newswire) — every mapped item is tagged sourceAuthority 'MEDIA' with a fixed, deterministic
// base credibility (never LLM-derived, Art. XII); it is corroborating context, not an authoritative claim.
//
// LENIENT PARSE (per spec): a malformed article (missing url/title, or an unparsable seendate) is SKIPPED
// and counted at the parse boundary — GDELT's web-scrape corpus routinely contains partial rows and the
// per-fetch batch must not fail wholesale over one bad article (contrast FIRMS/MeteoAlarm-RO, which throw
// PARSE per-row through the shared mapRows() runner and therefore fail the whole batch on one bad row).
// The mapper itself still throws a typed PARSE defensively if an already-filtered-in row is somehow
// unmappable (adapter-contract §4 "never silently drop" — exercised directly in gdelt-acl.test.ts).
import type { NewsItem } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One raw GDELT DOC 2.0 ArtList article. Raw until mapped; unknown upstream fields are ignored. */
export interface GdeltArticle {
  readonly url?: string;
  readonly url_mobile?: string;
  readonly title?: string;
  readonly seendate?: string; // YYYYMMDDTHHMMSSZ
  readonly socialimage?: string;
  readonly domain?: string;
  readonly language?: string;
  readonly sourcecountry?: string;
}

/** Raw GDELT DOC 2.0 response envelope (format=json&mode=ArtList). */
interface GdeltResponse {
  readonly articles?: readonly GdeltArticle[];
}

export interface GdeltParseResult {
  readonly articles: readonly GdeltArticle[];
  readonly skipped: number; // count of malformed rows dropped (never silently unaccounted for)
}

// Deterministic base credibility for a GDELT MEDIA-tier result (Art. XII — fixed, never LLM-derived).
// GDELT indexes a broad open-web outlet set without per-article vetting, so the base sits mid-scale;
// downstream correlation/corroboration logic (out of adapter scope) may raise it, never the LLM.
export const GDELT_BASE_CREDIBILITY = 0.65;
const GDELT_SOURCE_AUTHORITY = 'MEDIA' as const;

/**
 * Parse the raw GDELT DOC 2.0 JSON response into well-formed articles, skipping (and counting) any row
 * missing url/title or carrying an unparsable seendate. Invalid top-level JSON is a typed PARSE (the
 * whole response is unusable, as opposed to one bad row within an otherwise-good response).
 */
export function parseGdeltResponse(text: string): GdeltParseResult {
  let doc: GdeltResponse;
  try {
    doc = JSON.parse(text) as GdeltResponse;
  } catch (e) {
    throw makeAdapterError('PARSE', `GDELT response is not valid JSON: ${errMsg(e)}`);
  }
  const rows = Array.isArray(doc.articles) ? doc.articles : [];
  const articles: GdeltArticle[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (isWellFormed(row)) {
      articles.push(row);
    } else {
      skipped += 1;
    }
  }
  return { articles, skipped };
}

function isWellFormed(row: GdeltArticle): boolean {
  return str(row.url) !== '' && str(row.title) !== '' && gdeltSeenDateToIso(row.seendate) !== undefined;
}

export const gdeltMapper: AntiCorruptionMapper<GdeltArticle, NewsItem> = {
  toCanonical(raw: GdeltArticle): NewsItem {
    const title = str(raw.title);
    const url = str(raw.url);
    const publishedAt = gdeltSeenDateToIso(raw.seendate);
    if (title === '' || url === '' || publishedAt === undefined) {
      throw makeAdapterError(
        'PARSE',
        `GDELT article unmappable (url/title/seendate): '${url}' '${title}' '${raw.seendate ?? ''}'`,
      );
    }
    const summary = buildSummary(raw);
    return {
      title,
      url,
      publishedAt,
      ...(summary !== '' ? { summary } : {}),
      sourceAuthority: GDELT_SOURCE_AUTHORITY,
      credibility: GDELT_BASE_CREDIBILITY,
    };
  },
};

/** Deterministic, verbatim-fields summary from domain/country/language (no invented text). */
function buildSummary(raw: GdeltArticle): string {
  const parts = [str(raw.domain), str(raw.sourcecountry), str(raw.language)].filter((s) => s !== '');
  return parts.join(' — ');
}

/** GDELT seendate (YYYYMMDDTHHMMSSZ) -> ISO-8601 UTC instant. Returns undefined when unparsable. */
export function gdeltSeenDateToIso(seendate: string | undefined): string | undefined {
  if (seendate === undefined) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seendate);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
