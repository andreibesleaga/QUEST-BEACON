// BEACON — Mastodon anti-corruption layer (S2·Lane-A1; adapter-contract §4, NewsIntelPort P6, Art. XIV).
// Maps one raw Mastodon `Status` (GET /api/v1/timelines/tag/:tag) → a canonical NewsItem. This is the ONLY
// place the raw Mastodon status shape exists; no upstream field escapes above this module (AGENTS.md §3).
//
// VETTED-SOCIAL POSTURE — identical to the `bluesky` rung (Art. XIV): Mastodon is corroboration-only
// signal, never merged as fact. Every mapped item carries the SAME fixed, deterministic low-trust floor
// (sourceAuthority SOCIAL, credibility 0.35); the score is NEVER derived from boosts/favourites/replies
// (letting engagement masquerade as graded confidence is exactly the failure Art. XIV forbids). Consumers
// treat these items as "flag for human corroboration", never auto-trust, never auto-merge.
//
// AGGREGATE / NO-PII (Art. XIV, RESPONSIBLE_DATA.md): the raw type below deliberately DOES NOT DECLARE the
// `account` object at all, so no author identifier can be mapped even by accident — no handle, no display
// name, no avatar, no account id, no follower counts. Third-party @mentions inside the post body are
// stripped too, both as markup (`class="… mention"` anchors, which are NOT hashtag anchors) and as bare
// `@user@host` text. What survives is only what corroboration needs: the claim text, the instant it was
// posted, and the public permalink. The permalink is retained on purpose and is the one place an author's
// public identifier can still appear: a corroboration link a human cannot open is not corroboration, and
// this is precisely the posture the bluesky rung already ships (bluesky-acl.ts builds a profile permalink).
//
// PUBLIC-ONLY: a status whose `visibility` is not `public` is dropped and counted. Tag timelines only serve
// public posts today, so this is defence-in-depth against an instance (or a future API version) widening it.
//
// LENIENT PARSE (same deliberate deviation as bluesky, for the same reason): social timelines are much
// noisier than a curated government feed, so malformed/non-public statuses are SKIPPED AND COUNTED rather
// than aborting the batch — one bad status must not blank the corroboration panel. An unparseable body is
// still a typed PARSE, and the pure mapper still throws PARSE on a shape it cannot map.
import type { NewsItem } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError, errorMessage } from '@/adapters/_shared/index.js';

/** Deterministic vetted-social floor (Art. XIV) — NEVER derived from boosts/favourites/replies. */
const SOCIAL_CREDIBILITY = 0.35;
const TITLE_MAX_CHARS = 80;

/**
 * One raw Mastodon `Status` — ONLY the fields the ACL reads. `account`, `media_attachments`, `mentions`,
 * `emojis`, `card`, `poll` and every engagement counter are intentionally ABSENT from this type (Art. XIV):
 * a field that does not exist here cannot leak into the domain.
 */
export interface MastodonStatus {
  readonly id?: string;
  readonly uri?: string;
  readonly url?: string | null;
  readonly created_at?: string;
  readonly content?: string;
  readonly spoiler_text?: string;
  readonly visibility?: string;
  readonly language?: string | null;
  /** A boost wraps the boosted status here; the boosted status is the one carrying the claim. */
  readonly reblog?: MastodonStatus | null;
}

export interface MastodonParseResult {
  readonly statuses: readonly MastodonStatus[];
  readonly skipped: number; // malformed / non-public statuses dropped (never surfaced as fact)
}

/**
 * Parse one raw tag-timeline JSON body (a top-level array of Status) into well-formed public statuses,
 * skipping+counting the rest. A body that is not JSON at all raises a typed PARSE — that is a genuine
 * upstream-shape failure, distinct from one noisy status among many. A JSON body that is not an array
 * (e.g. Mastodon's `{"error":"…"}`) yields zero rows rather than a throw: the ladder degrades on emptiness.
 */
export function parseMastodonStatuses(json: string): MastodonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw makeAdapterError(
      'PARSE',
      `Mastodon timeline response is not valid JSON: ${errorMessage(e)}`,
    );
  }
  const rows = Array.isArray(parsed) ? (parsed as readonly (MastodonStatus | undefined)[]) : [];
  const statuses: MastodonStatus[] = [];
  let skipped = 0;
  for (const row of rows) {
    const status = unwrapBoost(row);
    if (isWellFormed(status)) {
      statuses.push(status);
    } else {
      skipped += 1;
    }
  }
  return { statuses, skipped };
}

/**
 * Parse N tag-timeline bodies (one per configured tag) into per-tag batches. A body that fails to parse is
 * dropped so ONE bad tag response cannot blank a multi-tag fetch (Art. XVI); if EVERY body fails, the first
 * failure is rethrown so the redundancy ladder still sees an honest typed error and degrades.
 */
export function parseMastodonTimelines(
  bodies: readonly string[],
): readonly (readonly MastodonStatus[])[] {
  const batches: (readonly MastodonStatus[])[] = [];
  let firstError: unknown;
  for (const body of bodies) {
    try {
      batches.push(parseMastodonStatuses(body).statuses);
    } catch (e) {
      firstError ??= e;
    }
  }
  if (batches.length === 0 && firstError !== undefined) throw firstError;
  return batches;
}

/**
 * Merge the per-tag batches into ONE newest-first list: a status carrying two watched tags arrives twice,
 * so it is de-duplicated by upstream id (falling back to the permalink) before the list is capped.
 */
export function mergeStatuses(
  batches: readonly (readonly MastodonStatus[])[],
  limit: number,
): readonly MastodonStatus[] {
  const byId = new Map<string, MastodonStatus>();
  for (const batch of batches) {
    for (const status of batch) {
      const key = str(status.id) !== '' ? str(status.id) : str(status.url);
      if (!byId.has(key)) byId.set(key, status);
    }
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(str(b.created_at)) - Date.parse(str(a.created_at)))
    .slice(0, limit);
}

export const mastodonMapper: AntiCorruptionMapper<MastodonStatus, NewsItem> = {
  toCanonical(raw: MastodonStatus): NewsItem {
    const status = unwrapBoost(raw);
    const url = str(status.url);
    const createdAt = str(status.created_at);
    const text = stripStatusHtml(str(status.content));
    if (url === '' || !isIsoDate(createdAt) || text === '') {
      throw makeAdapterError(
        'PARSE',
        `Mastodon status unmappable (url/created_at/content): '${url}' '${createdAt}' '${text}'`,
      );
    }
    // A non-empty `spoiler_text` IS the author's own one-line summary (content warning), so it makes a
    // truer title than the first 80 characters of the body it warns about.
    const spoiler = normalizeWhitespace(str(status.spoiler_text));
    return {
      title: titleFrom(spoiler !== '' ? spoiler : text),
      url,
      publishedAt: createdAt,
      summary: text,
      credibility: SOCIAL_CREDIBILITY,
      sourceAuthority: 'SOCIAL',
    };
  },
};

/**
 * Mastodon serves post bodies as sanitized HTML. Reduce it to plain text: drop @mention anchors entirely
 * (Art. XIV — a third party who did not post must not be retained), keep hashtag anchors' text, turn
 * paragraph/line breaks into spaces, strip the remaining markup, decode entities, then redact any bare
 * `@user[@host]` the markup pass could not see. Exported for direct, deterministic unit testing.
 */
export function stripStatusHtml(html: string): string {
  const withoutMentions = html.replace(ANCHOR_RE, (whole: string, attrs: string) =>
    isMentionAnchor(attrs) ? ' ' : whole,
  );
  const withBreaks = withoutMentions.replace(/<\/p\s*>|<br\s*\/?>/gi, ' ');
  const text = decodeEntities(withBreaks.replace(/<[^>]*>/g, ''));
  return normalizeWhitespace(text.replace(BARE_HANDLE_RE, '$1'));
}

const ANCHOR_RE = /<a\b([^>]*)>[\s\S]*?<\/a>/gi;
const CLASS_RE = /class\s*=\s*"([^"]*)"/i;
// The leading start/space/open-paren anchor keeps "name@host" inside a word (e.g. an e-mail) intact —
// only a STANDALONE @handle is redacted.
const BARE_HANDLE_RE = /(^|[\s(])@[A-Za-z0-9_]+(?:@[A-Za-z0-9.-]+)?/g;

/** Mastodon tags BOTH mentions and hashtags with `class="mention …"`; only hashtags add `hashtag`. */
function isMentionAnchor(attrs: string): boolean {
  const classes = CLASS_RE.exec(attrs)?.[1] ?? '';
  return classes.includes('mention') && !classes.includes('hashtag');
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** `&amp;` is decoded LAST so `&amp;lt;` cannot be double-decoded into a `<`. */
function decodeEntities(s: string): string {
  let out = s;
  for (const [entity, char] of Object.entries(ENTITIES)) out = out.split(entity).join(char);
  return out.split('&amp;').join('&');
}

/** A boost carries the real claim in `reblog`; anything else is returned untouched. */
function unwrapBoost(raw: MastodonStatus | undefined): MastodonStatus {
  const boosted = raw?.reblog;
  if (boosted !== undefined && boosted !== null) return boosted;
  return raw ?? {};
}

/** Well-formed iff PUBLIC and carrying everything the mapper needs (mirrors the mapper's own guard). */
function isWellFormed(status: MastodonStatus): boolean {
  if (str(status.visibility) !== 'public') return false;
  return (
    str(status.url) !== '' &&
    isIsoDate(str(status.created_at)) &&
    stripStatusHtml(str(status.content)) !== ''
  );
}

/** Collapse all whitespace runs (incl. newlines) to a single space; trim ends. */
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
