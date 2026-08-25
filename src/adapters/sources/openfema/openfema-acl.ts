// BEACON — OpenFEMA anti-corruption layer (S2·Lane-A2; adapter-contract §4, NewsIntelPort P6, Art. XII).
// Maps one OpenFEMA `DisasterDeclarationsSummaries` row → a canonical NewsItem (official declaration
// notice). This is the ONLY place the raw OpenFEMA shape exists; no OpenFEMA field name escapes above
// this module (AGENTS.md §3). Lenient by directive: unknown fields ignored, malformed rows dropped AND
// counted (never silently unaccounted for).
//
// VERIFIED LIVE (2026-08-08, real curl, HTTP 200, KEYLESS — recorded verbatim into
// `__fixtures__/declarations.json`):
//   GET https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries
//       ?$top=6&$orderby=declarationDate desc&$format=json
//   → { metadata: {...}, DisasterDeclarationsSummaries: [ { femaDeclarationString, disasterNumber, state,
//       declarationType, declarationDate, incidentType, declarationTitle, designatedArea, fipsStateCode,
//       fipsCountyCode, incidentBeginDate, incidentEndDate, ia/pa/ih/hmProgramDeclared, region, … } ] }
//
// WHY NewsItem AND NOT HazardGeometry (binding, the F-06/F-48 failure class): a declaration row carries
// NO geometry — only a state/county FIPS code and a designated-area NAME. Synthesising a polygon from a
// county code (or a point from a county centroid table) would put a fabricated footprint on the map and
// into exposure computation. The declaration is an official ANNOUNCEMENT, so it maps to the honest
// advisory entity the domain already has — exactly the precedent set by meteoalarm-ro and wmo-swic.
//
// HONEST LIMITATION: OpenFEMA emits ONE ROW PER DESIGNATED AREA, so a single disaster appears once per
// county. That is the upstream's real shape and it is preserved rather than de-duplicated here — the
// designated area is named in every summary, so two rows of the same disaster are distinguishable, and
// collapsing them would silently drop which counties were actually designated.
import type { NewsItem } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One raw OpenFEMA declaration row (unknown fields ignored — lenient by directive). */
export interface FemaDeclaration {
  readonly femaDeclarationString?: string;
  readonly disasterNumber?: number | string;
  readonly state?: string;
  readonly declarationType?: string;
  readonly declarationDate?: string;
  readonly incidentType?: string;
  readonly declarationTitle?: string;
  readonly designatedArea?: string;
  readonly incidentBeginDate?: string | null;
  readonly incidentEndDate?: string | null;
  readonly iaProgramDeclared?: boolean;
  readonly paProgramDeclared?: boolean;
  readonly ihProgramDeclared?: boolean;
  readonly hmProgramDeclared?: boolean;
}

/** Lenient parse result: usable declaration rows + the count dropped as unusable. */
export interface FemaParseResult {
  readonly declarations: readonly FemaDeclaration[];
  readonly skipped: number;
}

/** FEMA declaration-type code → its official expansion (FEMA's own vocabulary, carried verbatim). */
const DECLARATION_TYPES: Readonly<Record<string, string>> = {
  DR: 'Major Disaster Declaration',
  EM: 'Emergency Declaration',
  FM: 'Fire Management Assistance Declaration',
  FS: 'Fire Suppression Authorization',
};

/**
 * Parse an OpenFEMA v2 `DisasterDeclarationsSummaries` response. A row is usable only when it carries a
 * disaster number (which becomes its public URL) and a parseable declarationDate; anything else is
 * dropped AND counted, so "we saw 6 rows and used 6" is always answerable.
 */
export function parseFemaDeclarations(text: string): FemaParseResult {
  const doc = JSON.parse(text) as { DisasterDeclarationsSummaries?: readonly FemaDeclaration[] };
  const all = Array.isArray(doc.DisasterDeclarationsSummaries) ? doc.DisasterDeclarationsSummaries : [];
  const declarations = all.filter(isUsable);
  return { declarations, skipped: all.length - declarations.length };
}

function isUsable(row: FemaDeclaration): boolean {
  const num = String(row.disasterNumber ?? '');
  return num !== '' && num !== 'undefined' && !Number.isNaN(Date.parse(row.declarationDate ?? ''));
}

export const femaMapper: AntiCorruptionMapper<FemaDeclaration, NewsItem> = {
  toCanonical(raw: FemaDeclaration): NewsItem {
    const num = String(raw.disasterNumber ?? '');
    const publishedAt = raw.declarationDate ?? '';
    if (num === '' || Number.isNaN(Date.parse(publishedAt))) {
      // parseFemaDeclarations already filters these out; this is the last-resort typed guard at the ACL
      // boundary (never-silently-dropped doctrine).
      throw makeAdapterError('PARSE', `OpenFEMA row missing disasterNumber/declarationDate: '${num}'`);
    }
    return {
      title: title(raw),
      // FEMA's own public disaster page — the canonical citable landing page for a declaration. The API
      // rows carry no per-row URL, so this is composed from the disaster number and nothing else.
      url: `https://www.fema.gov/disaster/${num}`,
      publishedAt,
      summary: summary(raw),
      // A US federal declaration is the most authoritative civil-emergency signal there is; it is never
      // an unverified social/media claim (Art. XIV).
      sourceAuthority: 'OFFICIAL',
      credibility: 0.95,
    };
  },
};

/** Deterministic title: FEMA's own declaration string + title, never re-worded. */
function title(raw: FemaDeclaration): string {
  const parts = [raw.femaDeclarationString, raw.declarationTitle].filter((s) => (s ?? '') !== '');
  return parts.length > 0 ? parts.join(' — ') : `FEMA disaster ${String(raw.disasterNumber ?? '')}`;
}

/** Deterministic, verbatim-fields summary (declaration type, area, incident window, programs declared). */
function summary(raw: FemaDeclaration): string {
  const parts: string[] = [];
  const type = DECLARATION_TYPES[raw.declarationType ?? ''];
  if (type !== undefined) parts.push(type);
  if ((raw.incidentType ?? '') !== '') parts.push(`incident type ${raw.incidentType}`);
  const area = [raw.designatedArea, raw.state].filter((s) => (s ?? '') !== '').join(', ');
  if (area !== '') parts.push(area);
  const window = incidentWindow(raw);
  if (window !== '') parts.push(window);
  const programs = declaredPrograms(raw);
  if (programs !== '') parts.push(`programs declared: ${programs}`);
  return parts.join(' — ');
}

function incidentWindow(raw: FemaDeclaration): string {
  const begin = raw.incidentBeginDate ?? '';
  const end = raw.incidentEndDate ?? '';
  if (begin === '') return '';
  return end === '' ? `incident from ${begin} (ongoing)` : `incident ${begin} to ${end}`;
}

/** FEMA's four program flags, expanded to their official abbreviations. Empty when none is declared. */
function declaredPrograms(raw: FemaDeclaration): string {
  const flags: readonly (readonly [boolean | undefined, string])[] = [
    [raw.iaProgramDeclared, 'IA'],
    [raw.ihProgramDeclared, 'IH'],
    [raw.paProgramDeclared, 'PA'],
    [raw.hmProgramDeclared, 'HM'],
  ];
  return flags.filter(([on]) => on === true).map(([, name]) => name).join('/');
}
