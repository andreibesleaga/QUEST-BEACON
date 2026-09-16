// BEACON — ReliefWeb anti-corruption layer (E4·T-189; adapter-contract §4, NewsIntelPort P6, Art. XII).
// Maps UN OCHA ReliefWeb v2 `/reports` list items -> canonical NewsItem. This is the ONLY place the raw
// v2 JSON shape exists; no upstream field escapes above this module (AGENTS.md §3).
//
// VERIFIED SOURCE (2026-07-15, apidoc.reliefweb.int/{parameters,fields-tables,result-structure}):
//   GET https://api.reliefweb.int/v2/reports?appname=<APPNAME>&query[value]=<q>&limit=20&profile=list
//   audit/DATA_SOURCE_VERIFICATION.md §5: v1 is **410 Gone -- v2 ONLY**; since **2025-11-01** `appname`
//   must be a **pre-approved/registered** name (no longer self-declared) -- see keyEnv RELIEFWEB_APPNAME
//   in reliefweb-adapter.ts. `profile=list` = "results suited to lists and tables" (vs `minimal`/`full`).
//   Envelope: { time, href, count, totalCount, data: [ { id, href, fields: {...} } ] }.
//   Verified `fields` names for the `reports` resource (fields-tables, fetched 2026-07-15): title, url,
//   url_alias, date / date.created / date.changed / date.original (ISO-8601), body (Markdown, searchable),
//   body-html.
//   DEVIATION FROM TASK BRIEF (flagged, not silently substituted): the brief named an optional
//   "body-summary" field. The live fields-tables listing has NO such field for the `reports` resource --
//   the only "summary"-named field is `headline.summary` (present ONLY when a report is a curated
//   headline, not a general-purpose field). We instead map the optional NewsItem.summary from the
//   verified `fields.body` (Markdown), trimmed/clipped -- Tier-1 verified, not guessed (AGENTS.md §7).
import type { NewsItem } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { errorMessage, makeAdapterError } from '@/adapters/_shared/index.js';

/** One already-validated ReliefWeb report row (post lenient-parse). Raw JSON never escapes past here. */
export interface ReliefWebRow {
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string; // ISO-8601 (fields.date.created)
  readonly summary?: string;
}

/** Result of a lenient parse: well-formed rows + a count of `data[]` items dropped as malformed. */
export interface ReliefWebParseResult {
  readonly rows: readonly ReliefWebRow[];
  readonly skipped: number;
}

// Deterministic, UN-OCHA-official-tier constants (never LLM-produced, Art. XII).
const RELIEFWEB_CREDIBILITY = 0.9;
const RELIEFWEB_AUTHORITY = 'OFFICIAL' as const;
const SUMMARY_MAX = 500; // keep advisory summaries short; never invent/expand upstream text

interface RawDate {
  readonly created?: unknown;
}
interface RawFields {
  readonly title?: unknown;
  readonly url?: unknown;
  readonly url_alias?: unknown;
  readonly date?: RawDate;
  readonly body?: unknown;
}
interface RawItem {
  readonly fields?: RawFields;
}

/**
 * Parse a ReliefWeb v2 `/reports` JSON response body into validated rows.
 *
 * Two-tier honesty (Art. XVI): a response that is not valid JSON, or has no `data[]` array at all, means
 * the WHOLE fetch is broken -- that raises a typed PARSE so the redundancy ladder degrades to the next
 * rung. But ONE odd `data[]` item (ReliefWeb occasionally omits a date or url on an edge-case report) must
 * not take down an otherwise-good batch of ~20 reports -- so per-item validation is LENIENT: a malformed
 * item is skipped and counted, never silently dropped and never thrown (adapter-contract §4 "never
 * silently drop" is satisfied by the `skipped` count, not by an item-level exception).
 */
export function parseReliefWeb(text: string): ReliefWebParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw makeAdapterError('PARSE', `ReliefWeb response is not valid JSON: ${errorMessage(e)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
    throw makeAdapterError('PARSE', 'ReliefWeb response missing a data[] array');
  }

  const rows: ReliefWebRow[] = [];
  let skipped = 0;
  for (const item of parsed.data as readonly unknown[]) {
    const row = extractRow(item);
    if (row === undefined) {
      skipped += 1;
      continue;
    }
    rows.push(row);
  }
  return { rows, skipped };
}

function extractRow(item: unknown): ReliefWebRow | undefined {
  if (!isRecord(item)) return undefined;
  const fields = (item as RawItem).fields;
  if (!isRecord(fields)) return undefined;

  const title = str(fields.title);
  const url = str(fields.url) || str(fields.url_alias);
  const publishedAt = str(isRecord(fields.date) ? fields.date.created : undefined);
  if (title === '' || url === '' || !isIsoDate(publishedAt)) return undefined;

  const summary = clip(str(fields.body));
  return summary === '' ? { title, url, publishedAt } : { title, url, publishedAt, summary };
}

/** Trivial by design: `parseReliefWeb` already validated every row -- this only shapes the NewsItem. */
export const reliefWebMapper: AntiCorruptionMapper<ReliefWebRow, NewsItem> = {
  toCanonical(raw: ReliefWebRow): NewsItem {
    return {
      title: raw.title,
      url: raw.url,
      publishedAt: raw.publishedAt,
      ...(raw.summary !== undefined ? { summary: raw.summary } : {}),
      sourceAuthority: RELIEFWEB_AUTHORITY,
      credibility: RELIEFWEB_CREDIBILITY,
    };
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isIsoDate(s: string): boolean {
  return s !== '' && !Number.isNaN(Date.parse(s));
}

function clip(s: string): string {
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX).trimEnd()}…` : s;
}
