// BEACON — news/social → deterministic GroundedFact bridge (E5·Phase-D W2c; FR-4, Art. XII/XIV).
// The portal's HEADLINE differentiator: authoritative news + vetted social fused into the AI report, with
// misinformation FLAGGED — never auto-trusted, never merged. This module is PURE and DETERMINISTIC: it
// mints the cited facts BEFORE the LLM is ever consulted (Art. XII — the model narrates cited facts, it
// never invents a number, a source count, or a credibility score). It imports PORTS + DOMAIN only (F9).
//
// SEMANTICS (simple, honest, documented):
//   1. AUTHORITY RANK — OFFICIAL(3) > MEDIA(2) > SOCIAL(1). A NewsItem with NO sourceAuthority is treated
//      as SOCIAL: unknown provenance is never auto-trusted (Art. XIV). Authoritative ⇔ rank ≥ MEDIA.
//   2. CORROBORATION CLUSTERING — items are clustered by a deterministic key: hazard-keyword class
//      (FIRE/FLOOD/STORM/QUAKE/OTHER, matched on title+summary) × time window (floor(publishedAt / N h)).
//      The batch is assumed REGION-SCOPED (W2a fetches news per region), so region is constant within a
//      call and carried only as a label. Corroboration counts DISTINCT AUTHORITATIVE OUTLETS (url host),
//      so one spammy outlet cannot fake "3 sources". A cluster with ≥1 authoritative outlet mints a
//      corroborated GroundedFact ("N authoritative sources report …") citing each distinct outlet.
//   3. MISINFORMATION FLAGGING (flag-not-merge, Art. XIV) — a SOCIAL item that LACKS authoritative
//      corroboration (its cluster has no OFFICIAL/MEDIA outlet — which also captures a social claim that
//      CONFLICTS with the authoritative consensus, since a different hazard class lands in a different,
//      authoritative-free cluster) is emitted as a SEPARATE flagged fact ("Unverified social report — not
//      corroborated"). Social never merges into a corroborated fact and never boosts a count. SOCIAL alone
//      can never produce a non-flagged fact.
//   4. DETERMINISTIC OUTPUTS ONLY — counts, outlet lists, authority labels; no invented numbers/prose.
import type { NewsItem, SourceAuthority } from '@/ports/intel.js';
import type { SourceId, CitationId } from '@/domain/index.js';
import type { SourceMode } from '@/domain/source-record.js';
import { asId } from '@/domain/index.js';
// Type-only: erased at compile time, so there is no runtime import cycle with sitrep-synthesis (which
// imports this module's function). depcruise resolves post-compilation deps → no `no-circular` violation.
import type { GroundedFact } from './sitrep-synthesis.js';

/** Tuning for the news grounding pass (all injected — nothing hardcoded inside the computation, U5). */
export interface NewsGroundingOptions {
  /** Human label for the region the batch was fetched for (batch is region-scoped). Used in claim text. */
  readonly region?: string;
  /** Corroboration time-window in hours; two authoritative reports within one window corroborate. Default 24. */
  readonly windowHours?: number;
}

/** The deterministic result of grounding a news/social batch — facts + the blend-ready corroboration score. */
export interface NewsGroundingResult {
  /** Corroborated authoritative facts followed by flagged unverified-social facts (deterministic order). */
  readonly facts: readonly GroundedFact[];
  /** [0,1] corroboration strength = min(1, maxDistinctAuthoritativeOutlets / target). Feeds ConfidenceComponents. */
  readonly corroboration: number;
  /** Number of authoritative corroboration facts minted. */
  readonly corroboratedCount: number;
  /** Number of unverified-social facts flagged (Art. XIV) — never counted as corroboration. */
  readonly flaggedCount: number;
}

const AUTHORITY_RANK: Readonly<Record<SourceAuthority, number>> = {
  OFFICIAL: 3,
  MEDIA: 2,
  SOCIAL: 1,
};
const AUTHORITATIVE_MIN_RANK = AUTHORITY_RANK.MEDIA; // MEDIA and OFFICIAL are "authoritative"
const CORROBORATION_TARGET = 3; // 3+ distinct authoritative outlets ⇒ full corroboration (1.0)
const DEFAULT_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

type HazardClass = 'FIRE' | 'FLOOD' | 'STORM' | 'QUAKE' | 'OTHER';

/** Deterministic hazard-keyword lexicon (first match wins, scanned in this order). No LLM classification. */
const HAZARD_KEYWORDS: ReadonlyArray<readonly [HazardClass, readonly string[]]> = [
  ['FIRE', ['wildfire', 'fire', 'blaze', 'burn', 'flame']],
  ['FLOOD', ['flood', 'inundat', 'deluge', 'levee', 'overflow', 'dam breach']],
  ['STORM', ['storm', 'hurricane', 'cyclone', 'typhoon', 'tornado', 'gale']],
  ['QUAKE', ['earthquake', 'quake', 'seismic', 'tremor', 'aftershock']],
];

const HAZARD_LABEL: Readonly<Record<HazardClass, string>> = {
  FIRE: 'wildfire activity',
  FLOOD: 'flooding',
  STORM: 'severe storm activity',
  QUAKE: 'seismic activity',
  OTHER: 'a developing hazard',
};

/** An item paired with its deterministically-derived attributes (authority, hazard class, outlet, bucket). */
interface Classified {
  readonly item: NewsItem;
  readonly rank: number;
  readonly hazard: HazardClass;
  readonly outlet: string; // url host (or a title-derived fallback) — the corroboration unit
  readonly bucket: string; // time-window bucket (or 'NA' when publishedAt is unparsable)
}

/** One corroboration cluster: same hazard class + time window (region is constant per region-scoped call). */
interface Cluster {
  readonly key: string;
  readonly hazard: HazardClass;
  readonly authoritative: Classified[]; // rank ≥ MEDIA
  readonly social: Classified[]; // rank < MEDIA (incl. unknown provenance)
}

/**
 * Ground a region-scoped news/social batch into deterministic, already-cited facts (Art. XII) with
 * misinformation flagged not merged (Art. XIV). Pure: same input ⇒ same output, no clock, no I/O.
 */
export function groundNews(
  items: readonly NewsItem[],
  options: NewsGroundingOptions = {},
): NewsGroundingResult {
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const classified = items.map((item) => classify(item, windowHours)).filter((c) => c !== null);
  const clusters = cluster(classified);

  const facts: GroundedFact[] = [];
  let corroboratedCount = 0;
  let flaggedCount = 0;
  let maxOutlets = 0;

  // Stable output order: iterate clusters by key. Corroborated facts first, then flagged (see below).
  for (const c of clusters) {
    const authoritativeOutlets = distinctOutlets(c.authoritative);
    if (authoritativeOutlets.length > 0) {
      facts.push(
        corroboratedFact(c.hazard, authoritativeOutlets, corroboratedCount, options.region),
      );
      corroboratedCount += 1;
      maxOutlets = Math.max(maxOutlets, authoritativeOutlets.length);
    }
  }
  for (const c of clusters) {
    // Only social items in an AUTHORITATIVE-FREE cluster are flagged (uncorroborated / conflicting).
    if (distinctOutlets(c.authoritative).length > 0) continue;
    for (const outlet of distinctOutlets(c.social)) {
      facts.push(flaggedFact(outlet, flaggedCount, options.region));
      flaggedCount += 1;
    }
  }

  return {
    facts,
    corroboration: Math.min(1, maxOutlets / CORROBORATION_TARGET),
    corroboratedCount,
    flaggedCount,
  };
}

/** Map a corroboration score onto the deterministic ConfidenceComponents shape (Art. XII — never LLM). */
export function newsCorroborationComponent(result: NewsGroundingResult): {
  readonly corroboration: number;
} {
  return { corroboration: result.corroboration };
}

/**
 * The THREE ADAPTER-SERVED rungs, and deliberately not the fourth served mode (ADR-041 §3). `DB` — an
 * operator-maintained row in BEACON's own store — has no defensible position in the weakest-wins ordering
 * below: it is not a degraded `LIVE`, it is a different axis entirely. News is adapter-fetched and never
 * operator-entered, so `DB` cannot legitimately arrive here; narrowing the parameter to this alias makes
 * that a COMPILE ERROR rather than a silent mis-rank at the bottom of the ladder.
 */
export type AdapterServedMode = SourceMode;

/**
 * One provenance ref per distinct news OUTLET in the batch, so every `news:<host>` citation the grounded
 * facts mint resolves to a provenance row in the same envelope (found by the S3 SitRep sweep, 2026-08-08:
 * news fields were cited to ids — `news:apnews.com` — that appeared in NO provenance entry, because the
 * envelope's provenance carried only adapter ids). The outlet id here is minted by the SAME
 * `outletOf`/`sourceIdFor` pair the facts use — one derivation, so the two can never drift.
 *
 * Two honesty rules:
 * - `mode` is the WEAKEST mode among the envelope's ambient refs (MOCK < CACHED < LIVE), because an
 *   outlet row is DERIVED from items some adapter served and per-item adapter attribution is not
 *   modelled — claiming any single adapter's mode could over-claim. Understating freshness is a label;
 *   overstating it is a lie. Empty ambient ⇒ MOCK, the floor.
 * - `fetchedAt` is the outlet's newest parseable `publishedAt` (what the datum itself is timestamped
 *   with); an outlet with no parseable timestamp falls back to the ambient refs' newest `fetchedAt`,
 *   else the raw string — never an invented "now" (no clock in this module, by contract).
 */
export function newsOutletProvenance(
  items: readonly NewsItem[] | undefined,
  ambient: readonly { readonly mode: AdapterServedMode; readonly fetchedAt: string }[],
): readonly {
  readonly sourceId: string;
  readonly mode: AdapterServedMode;
  readonly fetchedAt: string;
}[] {
  if (items === undefined) return []; // a view with no news slice mints no outlet ids — nothing to resolve
  const RANK: Record<AdapterServedMode, number> = { MOCK: 0, CACHED: 1, LIVE: 2 };
  const weakest = ambient.reduce<AdapterServedMode>(
    (acc, r) => (RANK[r.mode] < RANK[acc] ? r.mode : acc),
    ambient.length > 0 ? 'LIVE' : 'MOCK',
  );
  const ambientNewest = ambient
    .map((r) => r.fetchedAt)
    .sort()
    .at(-1);
  const newestByOutlet = new Map<string, string>();
  for (const item of items) {
    const outlet = outletOf(item);
    if (outlet === '') continue;
    const current = newestByOutlet.get(outlet);
    const candidate = Number.isNaN(Date.parse(item.publishedAt))
      ? (current ?? ambientNewest ?? item.publishedAt)
      : item.publishedAt;
    if (current === undefined || candidate > current) newestByOutlet.set(outlet, candidate);
  }
  return [...newestByOutlet.entries()].map(([outlet, fetchedAt]) => ({
    sourceId: sourceIdFor(outlet),
    mode: weakest,
    fetchedAt,
  }));
}

// ── internals ──────────────────────────────────────────────────────────────────

/** Attach the deterministic attributes; drop an item that carries neither a title nor a url (ungroundable). */
function classify(item: NewsItem, windowHours: number): Classified | null {
  const outlet = outletOf(item);
  if (outlet === '') return null;
  return {
    item,
    rank: AUTHORITY_RANK[item.sourceAuthority ?? 'SOCIAL'],
    hazard: hazardOf(item),
    outlet,
    bucket: bucketOf(item.publishedAt, windowHours),
  };
}

/** Group classified items into clusters keyed by hazard × time-window; sorted by key for stable output. */
function cluster(classified: readonly Classified[]): readonly Cluster[] {
  const byKey = new Map<string, Cluster>();
  for (const c of classified) {
    const key = `${c.hazard}|${c.bucket}`;
    let group = byKey.get(key);
    if (group === undefined) {
      group = { key, hazard: c.hazard, authoritative: [], social: [] };
      byKey.set(key, group);
    }
    if (c.rank >= AUTHORITATIVE_MIN_RANK) group.authoritative.push(c);
    else group.social.push(c);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Distinct outlets in a set, ordered by authority (desc) then time (asc) then outlet name — the first is
 * the primary grounding source. Deduping by outlet is what makes "N sources" mean N independent voices.
 */
function distinctOutlets(items: readonly Classified[]): readonly Classified[] {
  const sorted = [...items].sort(
    (a, b) =>
      b.rank - a.rank ||
      timeOf(a.item.publishedAt) - timeOf(b.item.publishedAt) ||
      a.outlet.localeCompare(b.outlet),
  );
  const seen = new Set<string>();
  const out: Classified[] = [];
  for (const c of sorted) {
    if (seen.has(c.outlet)) continue;
    seen.add(c.outlet);
    out.push(c);
  }
  return out;
}

/** Mint a corroborated authoritative fact citing every distinct outlet (primary + corroborating). */
function corroboratedFact(
  hazard: HazardClass,
  outlets: readonly Classified[],
  index: number,
  region: string | undefined,
): GroundedFact {
  const n = outlets.length;
  const names = outlets.map((o) => o.outlet).join(', ');
  const where = region !== undefined && region !== '' ? ` in ${region}` : '';
  const verb = n === 1 ? 'source reports' : 'sources report';
  const field = `news-${hazard.toLowerCase()}-${index + 1}`;
  return definedFact({
    field,
    claim: `${n} authoritative ${verb} ${HAZARD_LABEL[hazard]}${where} (${names}).`,
    sourceId: asId<SourceId>(sourceIdFor(outlets[0]!.outlet)),
    citationId: asId<CitationId>(`cit-${field}`),
    corroboratingSourceIds: outlets.slice(1).map((o) => asId<SourceId>(sourceIdFor(o.outlet))),
    flagged: false,
  });
}

/** Mint a FLAGGED unverified-social fact (Art. XIV) — labelled, cited to the social outlet, never counted. */
function flaggedFact(outlet: Classified, index: number, region: string | undefined): GroundedFact {
  const where = region !== undefined && region !== '' ? ` (${region})` : '';
  const field = `news-unverified-${index + 1}`;
  const title = firstLine(outlet.item.title) || outlet.outlet;
  return definedFact({
    field,
    claim: `Unverified social report${where} — not corroborated by any authoritative source: "${title}".`,
    sourceId: asId<SourceId>(sourceIdFor(outlet.outlet)),
    citationId: asId<CitationId>(`cit-${field}`),
    flagged: true,
  });
}

/** Drop absent optional keys so exactOptionalPropertyTypes stays satisfied (mirrors domain definedOnly). */
function definedFact(f: {
  field: string;
  claim: string;
  sourceId: SourceId;
  citationId: CitationId;
  corroboratingSourceIds?: readonly SourceId[];
  flagged: boolean;
}): GroundedFact {
  const base: GroundedFact = {
    field: f.field,
    claim: f.claim,
    sourceId: f.sourceId,
    citationId: f.citationId,
    flagged: f.flagged,
  };
  return f.corroboratingSourceIds && f.corroboratingSourceIds.length > 0
    ? { ...base, corroboratingSourceIds: f.corroboratingSourceIds }
    : base;
}

/** Hazard class from the item text (title + summary), first keyword match wins; else OTHER. */
function hazardOf(item: NewsItem): HazardClass {
  const text = `${item.title} ${item.summary ?? ''}`.toLowerCase();
  for (const [cls, keywords] of HAZARD_KEYWORDS) {
    if (keywords.some((k) => text.includes(k))) return cls;
  }
  return 'OTHER';
}

/** The url host (lowercased, www-stripped) is the corroboration unit; fall back to a title slug, else ''. */
function outletOf(item: NewsItem): string {
  const host = hostOf(item.url);
  if (host !== '') return host;
  const slug = firstLine(item.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

/** Parse a url host without throwing; returns '' when the url is absent or unparsable. */
function hostOf(url: string | undefined): string {
  if (url === undefined || url.trim() === '') return '';
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The namespace of every outlet source id; `isNewsOutletSourceId` is the only way to test for it. */
export const NEWS_OUTLET_PREFIX = 'news:';

/**
 * The licence recorded for an outlet row (`news:<host>`). Outlet rows are DERIVED from items some adapter
 * served — per-item adapter attribution is not modelled — so no adapter's manifest licence can be claimed
 * for them; what is true of every item is that BEACON keeps the headline, the link and a summary and points
 * back at the publisher (NOTICE: "per-feed (verified open feeds)"). This text says exactly that. It exists
 * because a source row without a licence is refused by the domain (Art. XI) and a cited-but-unpolled outlet
 * used to be materialised with NULL (live 422, 2026-09-15).
 */
export const NEWS_OUTLET_LICENSE =
  'publisher terms — headline, link and summary only, attributed to the outlet (see NOTICE)';

export function isNewsOutletSourceId(sourceId: string): boolean {
  return sourceId.startsWith(NEWS_OUTLET_PREFIX);
}

/** A stable SOURCE_RECORD id for an outlet (namespaced so it never collides with adapter/source ids). */
function sourceIdFor(outlet: string): string {
  return `${NEWS_OUTLET_PREFIX}${outlet}`;
}

/** Time-window bucket key: floor(epoch / windowMs). 'NA' when publishedAt is unparsable (still clusterable). */
function bucketOf(publishedAt: string, windowHours: number): string {
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return 'NA';
  return String(Math.floor(t / (windowHours * HOUR_MS)));
}

/** Epoch ms for ordering; unparsable dates sort last (Infinity) so well-dated outlets lead. */
function timeOf(publishedAt: string): number {
  const t = Date.parse(publishedAt);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** First non-empty line of a string, trimmed (keeps claim text single-line and clean). */
function firstLine(s: string): string {
  return (s.split('\n').find((l) => l.trim() !== '') ?? '').trim();
}
