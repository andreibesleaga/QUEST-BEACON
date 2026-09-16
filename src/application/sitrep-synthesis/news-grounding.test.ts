// BEACON — news/social grounding tests (E5·Phase-D W2c; Art. XII/XIV). Proves the deterministic
// misinformation-flagging contract: authority ranking, corroboration clustering by hazard×window,
// distinct-outlet counting (no single-outlet inflation), flag-not-merge for uncorroborated/conflicting
// social, SOCIAL-alone never produces a non-flagged fact, and a deterministic corroboration score.
import { describe, it, expect } from 'vitest';
import type { NewsItem, SourceAuthority } from '@/ports/intel.js';
import { groundNews, newsCorroborationComponent, newsOutletProvenance } from './news-grounding.js';

// Fixed, safely-past instants (no wall clock — deterministic across runs). All inside one 24h window.
const T = '2026-07-05T10:00:00Z';
const T2 = '2026-07-05T14:00:00Z';
const NEXT_WINDOW = '2026-07-07T10:00:00Z'; // > 24h later ⇒ different time bucket

function item(
  authority: SourceAuthority | undefined,
  host: string,
  title: string,
  publishedAt = T,
): NewsItem {
  return {
    title,
    url: `https://${host}/story`,
    publishedAt,
    ...(authority !== undefined ? { sourceAuthority: authority } : {}),
  };
}

describe('groundNews — corroboration (authoritative)', () => {
  it('counts DISTINCT authoritative outlets and cites each (3 sources report)', () => {
    const res = groundNews(
      [
        item('OFFICIAL', 'nws.gov', 'Wildfire spreads near the ridge'),
        item('MEDIA', 'reuters.com', 'Fire forces evacuations'),
        item('MEDIA', 'apnews.com', 'Blaze grows overnight'),
      ],
      { region: 'us-ca' },
    );
    expect(res.corroboratedCount).toBe(1);
    expect(res.flaggedCount).toBe(0);
    const f = res.facts[0]!;
    expect(f.flagged).toBe(false);
    expect(f.claim).toContain('3 authoritative sources report');
    expect(f.claim).toContain('wildfire activity in us-ca');
    // primary source + 2 corroborating = 3 distinct outlet citations
    expect(f.corroboratingSourceIds).toHaveLength(2);
    expect(String(f.sourceId)).toBe('news:nws.gov'); // OFFICIAL ranks first as primary
  });

  it('does NOT inflate the count when one outlet publishes many articles', () => {
    const res = groundNews([
      item('MEDIA', 'reuters.com', 'Flood warning issued', T),
      item('MEDIA', 'reuters.com', 'Flood update: levee overtopped', T2),
      item('MEDIA', 'reuters.com', 'Flood: more rain forecast', T2),
    ]);
    expect(res.corroboratedCount).toBe(1);
    expect(res.facts[0]!.claim).toContain('1 authoritative source reports');
    expect(res.facts[0]!.corroboratingSourceIds).toBeUndefined();
  });

  it('separates events by hazard class into distinct corroborated facts', () => {
    const res = groundNews([
      item('MEDIA', 'reuters.com', 'Wildfire near town'),
      item('OFFICIAL', 'nws.gov', 'Flood levee overflow reported'),
    ]);
    expect(res.corroboratedCount).toBe(2);
    const fields = res.facts.map((f) => f.field);
    expect(fields).toContain('news-fire-1');
    expect(fields).toContain('news-flood-2');
  });

  it('separates the same hazard across different time windows', () => {
    const res = groundNews([
      item('MEDIA', 'reuters.com', 'Wildfire day one', T),
      item('MEDIA', 'reuters.com', 'Wildfire day three', NEXT_WINDOW),
    ]);
    expect(res.corroboratedCount).toBe(2); // same outlet, different window ⇒ two separate clusters
  });
});

describe('groundNews — misinformation flagging (Art. XIV: flag-not-merge)', () => {
  it('flags a SOCIAL item with no authoritative corroboration', () => {
    const res = groundNews([
      item('SOCIAL', 'bsky.app', 'Dam has totally collapsed, city underwater!!'),
    ]);
    expect(res.corroboratedCount).toBe(0);
    expect(res.flaggedCount).toBe(1);
    const f = res.facts[0]!;
    expect(f.flagged).toBe(true);
    expect(f.claim).toContain('Unverified social report');
    expect(f.claim).toContain('not corroborated');
  });

  it('treats an item with UNKNOWN provenance as SOCIAL (never auto-trusted)', () => {
    const res = groundNews([item(undefined, 'randomblog.example', 'Wildfire rumor thread')]);
    expect(res.corroboratedCount).toBe(0);
    expect(res.flaggedCount).toBe(1);
    expect(res.facts[0]!.flagged).toBe(true);
  });

  it('SOCIAL never merges into / boosts a corroborated fact (same event, mixed authority)', () => {
    const res = groundNews([
      item('MEDIA', 'reuters.com', 'Wildfire confirmed near ridge'),
      item('MEDIA', 'apnews.com', 'Wildfire evacuations begin'),
      item('SOCIAL', 'bsky.app', 'Wildfire is way bigger than they admit'),
    ]);
    // 2 authoritative outlets ⇒ count stays 2; the social item is absorbed (consistent) but NOT counted,
    // NOT flagged (it is corroborated by authoritative sources in the same cluster), and mints NO fact.
    expect(res.corroboratedCount).toBe(1);
    expect(res.facts[0]!.claim).toContain('2 authoritative sources report');
    expect(res.flaggedCount).toBe(0);
    expect(res.facts).toHaveLength(1);
  });

  it('flags a CONFLICTING social claim (different hazard than the authoritative consensus)', () => {
    const res = groundNews([
      item('OFFICIAL', 'nws.gov', 'Wildfire perimeter grows'),
      item('MEDIA', 'reuters.com', 'Wildfire threatens homes'),
      item('SOCIAL', 'bsky.app', 'A massive earthquake just leveled downtown, aftershocks ongoing'),
    ]);
    // FIRE cluster corroborated (2 outlets); the QUAKE social claim is its own authoritative-free cluster ⇒ flagged.
    expect(res.corroboratedCount).toBe(1);
    expect(res.flaggedCount).toBe(1);
    const flagged = res.facts.find((f) => f.flagged === true)!;
    expect(flagged.claim).toContain('Unverified social report');
  });

  it('flagged fact falls back to the outlet name when the social item has no title', () => {
    const res = groundNews([
      { title: '', url: 'https://bsky.app/y', publishedAt: T, sourceAuthority: 'SOCIAL' },
    ]);
    expect(res.flaggedCount).toBe(1);
    expect(res.facts[0]!.claim).toContain('bsky.app');
  });

  it('one flagged fact per distinct social outlet (social never corroborates social)', () => {
    const res = groundNews([
      item('SOCIAL', 'bsky.app', 'Flood rumor A'),
      item('SOCIAL', 'mastodon.social', 'Flood rumor B'),
      item('SOCIAL', 'bsky.app', 'Flood rumor A repeated'),
    ]);
    expect(res.corroboratedCount).toBe(0);
    expect(res.flaggedCount).toBe(2); // two distinct outlets, the duplicate does not add a third
  });
});

describe('groundNews — corroboration score (→ ConfidenceComponents)', () => {
  it('is 0 with no authoritative sources', () => {
    const res = groundNews([item('SOCIAL', 'bsky.app', 'Wildfire rumor')]);
    expect(res.corroboration).toBe(0);
    expect(newsCorroborationComponent(res)).toEqual({ corroboration: 0 });
  });

  it('scales with distinct authoritative outlets and saturates at 1.0', () => {
    const one = groundNews([item('MEDIA', 'reuters.com', 'Wildfire')]);
    expect(one.corroboration).toBeCloseTo(1 / 3, 5);
    const three = groundNews([
      item('MEDIA', 'reuters.com', 'Wildfire'),
      item('MEDIA', 'apnews.com', 'Wildfire'),
      item('OFFICIAL', 'nws.gov', 'Wildfire'),
    ]);
    expect(three.corroboration).toBe(1);
    const four = groundNews([
      item('MEDIA', 'a.com', 'Wildfire'),
      item('MEDIA', 'b.com', 'Wildfire'),
      item('MEDIA', 'c.com', 'Wildfire'),
      item('OFFICIAL', 'd.gov', 'Wildfire'),
    ]);
    expect(four.corroboration).toBe(1); // saturated, never > 1
  });
});

describe('groundNews — edges & determinism', () => {
  it('returns an empty result for empty news', () => {
    const res = groundNews([]);
    expect(res.facts).toEqual([]);
    expect(res.corroboration).toBe(0);
    expect(res.corroboratedCount).toBe(0);
    expect(res.flaggedCount).toBe(0);
  });

  it('drops an ungroundable item (no url, no title)', () => {
    const res = groundNews([{ title: '', url: '', publishedAt: T, sourceAuthority: 'MEDIA' }]);
    expect(res.facts).toEqual([]);
  });

  it('clusters an item with an unparsable publishedAt (bucket NA) rather than dropping it', () => {
    const res = groundNews([
      item('MEDIA', 'reuters.com', 'Wildfire near town', 'not-a-date'),
      item('MEDIA', 'apnews.com', 'Wildfire near town', 'also-bad'),
    ]);
    expect(res.corroboratedCount).toBe(1);
    expect(res.facts[0]!.claim).toContain('2 authoritative sources report');
  });

  it('falls back to a title slug as the outlet when the url is unparsable', () => {
    const res = groundNews([
      {
        title: 'Wildfire near town',
        url: ':::not a url:::',
        publishedAt: T,
        sourceAuthority: 'MEDIA',
      },
    ]);
    expect(res.corroboratedCount).toBe(1);
    expect(String(res.facts[0]!.sourceId)).toBe('news:wildfire-near-town');
  });

  it('is deterministic and order-independent (same facts regardless of input order)', () => {
    const a = groundNews([
      item('MEDIA', 'reuters.com', 'Wildfire'),
      item('OFFICIAL', 'nws.gov', 'Wildfire'),
      item('SOCIAL', 'bsky.app', 'Flood rumor'),
    ]);
    const b = groundNews([
      item('SOCIAL', 'bsky.app', 'Flood rumor'),
      item('OFFICIAL', 'nws.gov', 'Wildfire'),
      item('MEDIA', 'reuters.com', 'Wildfire'),
    ]);
    expect(a.facts).toEqual(b.facts);
  });

  it('honours a custom corroboration window (items in different windows do not corroborate)', () => {
    const res = groundNews(
      [
        item('MEDIA', 'reuters.com', 'Wildfire', '2026-07-05T10:00:00Z'),
        item('MEDIA', 'apnews.com', 'Wildfire', '2026-07-05T13:00:00Z'),
      ],
      { windowHours: 1 }, // 3h apart ⇒ separate 1h buckets ⇒ two single-outlet clusters
    );
    expect(res.corroboratedCount).toBe(2);
  });
});

// newsOutletProvenance — the per-outlet SourceRefs that make every `news:<host>` citation resolvable
// inside its OWN envelope (F-66 class). These pin the WEAKEST-mode and freshness rules, which is where
// the honesty lives: a citation may never claim a stronger mode or a fresher stamp than its evidence.
// Added 2026-08-24 after the newly-enabled CI coverage gate found these branches unexercised.
describe('newsOutletProvenance — mode and freshness are the WEAKEST of their evidence', () => {
  const ambient = (mode: 'LIVE' | 'CACHED' | 'MOCK', fetchedAt: string) => ({ mode, fetchedAt });

  it('mints one ref per DISTINCT outlet, keyed news:<host>', () => {
    const refs = newsOutletProvenance(
      [
        item('MEDIA', 'reuters.com', 'A'),
        item('MEDIA', 'apnews.com', 'B'),
        item('MEDIA', 'reuters.com', 'C'),
      ],
      [ambient('LIVE', T)],
    );
    expect(refs.map((r) => r.sourceId).sort()).toEqual(['news:apnews.com', 'news:reuters.com']);
  });

  it('with NO ambient provenance the mode degrades to MOCK — never an unbacked LIVE claim', () => {
    const refs = newsOutletProvenance([item('MEDIA', 'reuters.com', 'A')], []);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.mode).toBe('MOCK');
  });

  it('takes the WEAKEST ambient mode, not the strongest (CACHED beside LIVE ⇒ CACHED)', () => {
    const refs = newsOutletProvenance(
      [item('MEDIA', 'reuters.com', 'A')],
      [ambient('LIVE', T), ambient('CACHED', T2)],
    );
    expect(refs[0]!.mode).toBe('CACHED');
  });

  it('keeps the NEWEST publishedAt per outlet', () => {
    const refs = newsOutletProvenance(
      [item('MEDIA', 'reuters.com', 'older', T), item('MEDIA', 'reuters.com', 'newer', T2)],
      [ambient('LIVE', T)],
    );
    expect(refs[0]!.fetchedAt).toBe(T2);
  });

  it('an UNPARSABLE publishedAt falls back to ambient freshness rather than emitting garbage', () => {
    const refs = newsOutletProvenance(
      [item('MEDIA', 'reuters.com', 'undated', 'not-a-date')],
      [ambient('CACHED', T2)],
    );
    expect(refs[0]!.fetchedAt).toBe(T2);
  });

  it('an item with neither host nor sluggable title contributes NO ref (never a `news:` id)', () => {
    const untitled: NewsItem = { title: '', url: '', publishedAt: T };
    expect(newsOutletProvenance([untitled], [ambient('LIVE', T)])).toEqual([]);
  });

  it('an absent news slice mints nothing at all', () => {
    expect(newsOutletProvenance(undefined, [ambient('LIVE', T)])).toEqual([]);
  });
});
