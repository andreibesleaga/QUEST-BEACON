// BEACON — Bluesky anti-corruption layer (E4·T-179; adapter-contract §4, Art. XIV). Maps one raw AT
// Protocol post from `app.bsky.feed.searchPosts` → a canonical NewsItem (NewsIntelPort P6). This is the
// ONLY place the raw Bluesky post shape exists; no upstream field escapes above this module (AGENTS.md §3).
//
// VETTED-SOCIAL POSTURE (Art. XIV — Responsible Data & Privacy in Crisis): Bluesky is corroboration-only
// signal, never merged as fact. Every mapped item is stamped with a fixed, deterministic low-trust floor
// (sourceAuthority SOCIAL, credibility 0.35) — the score is NEVER computed from engagement counts/heuristics
// (that would let unverified social signal masquerade as graded confidence). Consumers MUST treat these
// items as "flag for human corroboration", never auto-merge as an authoritative fact (CONSTITUTION Art. XIV).
//
// LENIENT PARSE (deliberate deviation from FIRMS/MeteoAlarm's "never silently dropped" PARSE-on-first-bad-row
// policy): raw social posts are much noisier (reposts/quotes/deleted-record edge cases) than a curated
// government feed, so the upstream JSON parse step SKIPS and COUNTS malformed posts rather than aborting the
// whole batch — one bad post must not blank the corroboration panel. The pure `blueskyMapper.toCanonical`
// itself still honors the general AntiCorruptionMapper contract and throws a typed PARSE on a shape it
// cannot map (exercised directly in tests); the adapter only ever feeds it already-well-formed rows.
import type { NewsItem } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError, errorMessage } from '@/adapters/_shared/index.js';

/** Deterministic vetted-social floor (Art. XIV) — NEVER derived from likes/reposts/replies. */
const SOCIAL_CREDIBILITY = 0.35;
const TITLE_MAX_CHARS = 80;

/** One raw AT Protocol `app.bsky.actor.defs#profileViewBasic` (only the fields the ACL reads). */
export interface BlueskyAuthor {
  readonly did?: string;
  readonly handle?: string;
  readonly displayName?: string;
}

/** One raw AT Protocol `app.bsky.feed.post` record embedded in a PostView. */
export interface BlueskyRecord {
  readonly $type?: string;
  readonly text?: string;
  readonly createdAt?: string;
}

/** One raw AT Protocol `app.bsky.feed.defs#postView` (searchPosts result item). Raw until mapped. */
export interface BlueskyPost {
  readonly uri?: string;
  readonly cid?: string;
  readonly author?: BlueskyAuthor;
  readonly record?: BlueskyRecord;
  readonly indexedAt?: string;
  readonly replyCount?: number;
  readonly repostCount?: number;
  readonly likeCount?: number;
  readonly quoteCount?: number;
}

/** The raw `app.bsky.feed.searchPosts` response envelope. */
export interface BlueskySearchResponse {
  readonly posts?: readonly BlueskyPost[];
  readonly cursor?: string;
  readonly hitsTotal?: number;
}

export interface BlueskyParseResult {
  readonly posts: readonly BlueskyPost[];
  readonly skipped: number; // count of malformed posts silently dropped (never surfaced as fact)
}

/**
 * Parse a raw `searchPosts` JSON body into well-formed raw posts, skipping+counting malformed entries.
 * An invalid top-level JSON body (the response is not parseable at all) raises a typed PARSE — that is a
 * genuine upstream-shape failure, distinct from one noisy post among many.
 */
export function parseBlueskyPosts(json: string): BlueskyParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw makeAdapterError(
      'PARSE',
      `Bluesky searchPosts response is not valid JSON: ${errorMessage(e)}`,
    );
  }
  const raw = (parsed as BlueskySearchResponse | undefined)?.posts;
  const rows = Array.isArray(raw) ? raw : [];
  const posts: BlueskyPost[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (isWellFormed(row)) {
      posts.push(row);
    } else {
      skipped += 1;
    }
  }
  return { posts, skipped };
}

export const blueskyMapper: AntiCorruptionMapper<BlueskyPost, NewsItem> = {
  toCanonical(raw: BlueskyPost): NewsItem {
    const handle = str(raw.author?.handle);
    const text = str(raw.record?.text);
    const createdAt = str(raw.record?.createdAt);
    const uri = str(raw.uri);
    const rkey = extractRkey(uri);
    if (handle === '' || text === '' || !isIsoDate(createdAt) || rkey === '') {
      throw makeAdapterError(
        'PARSE',
        `Bluesky post unmappable (author.handle/record.text/record.createdAt/uri): ` +
          `'${handle}' '${text}' '${createdAt}' '${uri}'`,
      );
    }
    const normalized = normalizeWhitespace(text);
    return {
      title: titleFrom(normalized),
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      publishedAt: createdAt,
      summary: normalized,
      credibility: SOCIAL_CREDIBILITY,
      sourceAuthority: 'SOCIAL',
    };
  },
};

/** A post is well-formed iff it carries everything the mapper needs (mirrors the mapper's own guard). */
function isWellFormed(raw: BlueskyPost | undefined): raw is BlueskyPost {
  if (raw === undefined || raw === null) return false;
  const handle = str(raw.author?.handle);
  const text = str(raw.record?.text);
  const createdAt = str(raw.record?.createdAt);
  const uri = str(raw.uri);
  return (
    handle !== '' && text !== '' && isIsoDate(createdAt) && uri !== '' && extractRkey(uri) !== ''
  );
}

/** `at://did:plc:.../app.bsky.feed.post/<rkey>` → the trailing record-key segment. */
function extractRkey(uri: string): string {
  const parts = uri.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? '';
}

/** Collapse all whitespace runs (incl. newlines) to a single space; trim ends (Art. XIV — clean summary). */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** First ~80 chars of the normalized text as the NewsItem title, ellipsized when truncated. */
function titleFrom(text: string): string {
  if (text.length <= TITLE_MAX_CHARS) return text;
  return `${text.slice(0, TITLE_MAX_CHARS).trimEnd()}…`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isIsoDate(s: string): boolean {
  return s !== '' && !Number.isNaN(Date.parse(s));
}
