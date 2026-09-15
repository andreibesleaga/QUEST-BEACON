// BEACON — IFRC Alert Hub (worldwide CAP aggregator) anti-corruption layer (S2·Lane-A2;
// adapter-contract §4, NewsIntelPort P6, Art. XII/XIV). Maps one aggregated CAP alert → a canonical
// NewsItem. This is the ONLY place the raw Alert-Hub GraphQL shape exists; no upstream field name escapes
// above this module (AGENTS.md §3). Lenient by directive: unknown fields ignored, malformed alerts
// dropped AND counted (never silently unaccounted for).
//
// VERIFIED LIVE (2026-08-08, real curl, HTTP 200, KEYLESS — recorded verbatim into
// `__fixtures__/alerts.json`):
//   GET https://alerthub-api.ifrc.org/graphql/?query={ public { alerts(pagination:{limit:5,offset:0}) {
//         limit offset count items { id sent url identifier sender source status msgType
//         country { id name iso3 } feed { id url }
//         info { event headline description severity urgency certainty category senderName effective
//                expires language web } } } } }
//   → { "data": { "public": { "alerts": { "limit":5, "offset":0, "count":5418, "items":[ … ] } } } }
//   The endpoint was discovered from the Alert Hub web app's own published API docs
//   (github.com/IFRCGo/alert-hub-web-app APIDOCS.md) and its schema confirmed by GraphQL introspection
//   against the live server. GraphQL-over-GET is supported (no POST body needed), which is why this fits
//   the shared `httpGetText` seam with no new dependency.
//
// WHY NewsItem AND NOT HazardGeometry (binding, the F-06/F-48 failure class): the aggregate `alerts`
// query exposes CAP metadata (event/severity/urgency/certainty/effective/expires/country), not CAP
// <area> polygons. Even where an area exists, a CAP alerting area is an ADMINISTRATIVE warning extent,
// not a hazard footprint — the exact reasoning already recorded for wmo-swic (F-48). So every alert maps
// to the honest advisory entity, and no geometry is ever emitted from this source.
//
// TRUST TIER: Alert Hub relays alerts published by NATIONAL ALERTING AUTHORITIES (the recorded page is
// Roshydromet/meteoinfo.ru). That is corroborating-official intel, never an unverified social signal
// (Art. XIV) — the same tier and credibility as the wmo-swic CAP relay.
import type { NewsItem } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** The CAP `info` block as the Alert Hub exposes it (unknown fields ignored — lenient by directive). */
export interface CapHubInfo {
  readonly event?: string | null;
  readonly headline?: string | null;
  readonly severity?: string | null;
  readonly urgency?: string | null;
  readonly certainty?: string | null;
  readonly category?: string | null;
  readonly senderName?: string | null;
  readonly effective?: string | null;
  readonly expires?: string | null;
  readonly language?: string | null;
  readonly web?: string | null;
}

/** One aggregated CAP alert (unknown fields ignored — lenient by directive). */
export interface CapHubAlert {
  readonly id?: string;
  readonly sent?: string;
  readonly url?: string;
  readonly identifier?: string | null;
  readonly sender?: string | null;
  readonly status?: string | null;
  readonly msgType?: string | null;
  readonly country?: { readonly name?: string | null; readonly iso3?: string | null } | null;
  readonly feed?: { readonly url?: string | null } | null;
  readonly info?: CapHubInfo | null;
}

/** Lenient parse result: usable alerts + the count dropped as unusable. */
export interface CapHubParseResult {
  readonly alerts: readonly CapHubAlert[];
  readonly skipped: number;
}

interface CapHubResponse {
  readonly data?: {
    readonly public?: {
      readonly alerts?: { readonly items?: readonly CapHubAlert[] } | null;
    } | null;
  } | null;
  readonly errors?: readonly { readonly message?: string }[];
}

/**
 * Parse an Alert Hub GraphQL response. A GraphQL server answers HTTP 200 even for a query error, so a
 * populated `errors` array is raised as a typed PARSE here rather than degrading silently to "no alerts"
 * — reporting zero official alerts when the query was simply wrong is the worst possible failure for a
 * COP (Art. XVI: degrade LABELLED, never pretend). An alert with no url or no parseable `sent` is
 * dropped AND counted.
 */
export function parseCapHubAlerts(text: string): CapHubParseResult {
  const doc = JSON.parse(text) as CapHubResponse;
  const errors = doc.errors ?? [];
  if (errors.length > 0) {
    throw makeAdapterError(
      'PARSE',
      `Alert Hub GraphQL error: ${errors.map((e) => e.message ?? '?').join('; ')}`,
    );
  }
  const items = doc.data?.public?.alerts?.items;
  const all = Array.isArray(items) ? items : [];
  const alerts = all.filter(isUsable);
  return { alerts, skipped: all.length - alerts.length };
}

function isUsable(alert: CapHubAlert): boolean {
  return (
    typeof alert.url === 'string' &&
    alert.url !== '' &&
    !Number.isNaN(Date.parse(alert.sent ?? '')) &&
    titleOf(alert) !== ''
  );
}

/** CAP prefers `headline`; `event` is the fallback. Empty means the alert carries no usable label. */
function titleOf(alert: CapHubAlert): string {
  const info = alert.info ?? {};
  return str(info.headline) !== '' ? str(info.headline) : str(info.event);
}

export const capHubMapper: AntiCorruptionMapper<CapHubAlert, NewsItem> = {
  toCanonical(raw: CapHubAlert): NewsItem {
    const title = titleOf(raw);
    const url = str(raw.url);
    const publishedAt = str(raw.sent);
    if (title === '' || url === '' || Number.isNaN(Date.parse(publishedAt))) {
      // parseCapHubAlerts already filters these out; this is the last-resort typed guard at the ACL
      // boundary (never-silently-dropped doctrine).
      throw makeAdapterError(
        'PARSE',
        `Alert Hub alert '${raw.id ?? '?'}' has no usable title/url/sent`,
      );
    }
    return {
      title,
      url, // the ISSUING AUTHORITY's own CAP document URL — the citation points at the source, not the hub
      publishedAt,
      summary: buildSummary(raw),
      sourceAuthority: 'OFFICIAL',
      credibility: 0.85, // relayed official alert — same tier as the wmo-swic CAP relay
    };
  },
};

/** Deterministic, verbatim-fields advisory summary. No field is re-worded, inferred or translated. */
function buildSummary(raw: CapHubAlert): string {
  const info = raw.info ?? {};
  const parts: string[] = [];
  const country = str(raw.country?.name);
  if (country !== '') parts.push(country);
  const event = str(info.event);
  if (event !== '') parts.push(event);
  const grade = [str(info.severity), str(info.urgency), str(info.certainty)].filter(
    (s) => s !== '',
  );
  if (grade.length > 0) parts.push(`severity ${grade.join('/')}`);
  const window = validity(str(info.effective), str(info.expires));
  if (window !== '') parts.push(window);
  const issuer = str(info.senderName) !== '' ? str(info.senderName) : str(raw.sender);
  if (issuer !== '') parts.push(`issued by ${issuer}`);
  const status = [str(raw.status), str(raw.msgType)].filter((s) => s !== '');
  if (status.length > 0) parts.push(status.join('/'));
  return parts.join(' — ');
}

function validity(effective: string, expires: string): string {
  if (effective !== '' && expires !== '') return `effective ${effective} until ${expires}`;
  if (expires !== '') return `expires ${expires}`;
  return '';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
