// BEACON — Agency-RSS ACL tests (D-32/D-33). parseAgencyRss lifts BOTH RSS 2.0 <item> and Atom <entry>
// shapes into one normalized raw entry, skipping (and counting) malformed elements instead of aborting
// the whole feed; the mapper stamps a deterministic authority/credibility tier from the item URL's host.
// Pure, no clock/net.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { agencyRssMapper, authorityFor, parseAgencyRss } from './agency-rss-acl.js';
import type { AgencyRssRawEntry } from './agency-rss-acl.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/feed.xml', import.meta.url)),
  'utf8',
);

const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Sample Atom Agency Feed</title>
  <entry>
    <title>Flood watch issued for the Danube basin</title>
    <link rel="alternate" href="https://reliefweb.int/updates/flood-watch-danube" />
    <published>2026-07-10T08:00:00Z</published>
    <summary>Rising water levels prompt a watch.</summary>
  </entry>
  <entry>
    <title>Wildfire contained near the coast</title>
    <link href="https://example-news.test/wildfire-coast" />
    <updated>2026-07-11T09:30:00Z</updated>
  </entry>
  <entry>
    <!-- malformed: no title, no link, no date -->
    <summary>Orphan summary with nothing to anchor it.</summary>
  </entry>
</feed>`;

const RSS_WITH_MALFORMED_ITEM = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Sample RSS Agency Wire</title>
    <item>
      <title>Earthquake reported in the region</title>
      <link>https://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=999</link>
      <pubDate>Wed, 15 Jul 2026 08:55:02 GMT</pubDate>
      <description>Magnitude 5.1 earthquake.</description>
    </item>
    <item>
      <!-- malformed: missing link -->
      <title>Untitled dispatch with no link</title>
      <pubDate>Wed, 15 Jul 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Storm advisory issued</title>
      <link>https://www.local-tv.test/storm-advisory</link>
      <pubDate>not-a-real-date</pubDate>
    </item>
  </channel>
</rss>`;

describe('parseAgencyRss — RSS 2.0 shape', () => {
  it('lifts every <item> from the recorded GDACS RSS sample fixture', () => {
    const { entries, skipped } = parseAgencyRss(FIXTURE);
    expect(entries).toHaveLength(5);
    expect(skipped).toBe(0);
    expect(entries[0]?.title).toContain('Fiji');
    expect(entries[0]?.url).toBe('https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1551894');
    expect(entries[0]?.publishedAt).toBe('2026-07-14T23:05:13.000Z');
    expect(entries[0]?.summary).toContain('earthquake occurred in Fiji');
  });

  it('is lenient: skips a malformed <item> (missing link / unparsable date) and counts it, never aborting the feed', () => {
    const { entries, skipped } = parseAgencyRss(RSS_WITH_MALFORMED_ITEM);
    expect(entries).toHaveLength(1); // only the well-formed GDACS item survives
    expect(skipped).toBe(2); // missing-link item + unparsable-date item both counted, not silently vanished
    expect(entries[0]?.title).toBe('Earthquake reported in the region');
  });
});

describe('parseAgencyRss — Atom shape', () => {
  it('lifts every <entry>, preferring the rel="alternate" link, and skips the malformed entry (counted)', () => {
    const { entries, skipped } = parseAgencyRss(ATOM_FEED);
    expect(entries).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(entries[0]?.title).toBe('Flood watch issued for the Danube basin');
    expect(entries[0]?.url).toBe('https://reliefweb.int/updates/flood-watch-danube');
    expect(entries[0]?.publishedAt).toBe('2026-07-10T08:00:00.000Z');
    expect(entries[1]?.title).toBe('Wildfire contained near the coast');
    expect(entries[1]?.url).toBe('https://example-news.test/wildfire-coast');
    expect(entries[1]?.publishedAt).toBe('2026-07-11T09:30:00.000Z');
  });
});

describe('authorityFor — deterministic host-based authority/credibility map', () => {
  it('scores reliefweb.int as OFFICIAL/0.85', () => {
    expect(authorityFor('https://reliefweb.int/updates/x')).toEqual({
      sourceAuthority: 'OFFICIAL',
      credibility: 0.85,
    });
  });

  it('scores gdacs.org (and subdomains) as OFFICIAL/0.85', () => {
    expect(authorityFor('https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1')).toEqual({
      sourceAuthority: 'OFFICIAL',
      credibility: 0.85,
    });
  });

  it('scores an inciweb* host as OFFICIAL/0.85', () => {
    expect(authorityFor('https://inciweb.wildfire.gov/incident/1234')).toEqual({
      sourceAuthority: 'OFFICIAL',
      credibility: 0.85,
    });
  });

  it('scores any other host (e.g. a broadcaster) as MEDIA/0.65', () => {
    expect(authorityFor('https://www.digi24.ro/stiri/actualitate/x')).toEqual({
      sourceAuthority: 'MEDIA',
      credibility: 0.65,
    });
  });

  it('falls back to MEDIA/0.65 on an unparsable URL (defensive, never throws)', () => {
    expect(authorityFor('not a url')).toEqual({ sourceAuthority: 'MEDIA', credibility: 0.65 });
  });
});

describe('agencyRssMapper', () => {
  it('maps a normalized entry to a NewsItem, stamping OFFICIAL authority for a gdacs.org link', () => {
    const [first] = parseAgencyRss(FIXTURE).entries;
    const item = agencyRssMapper.toCanonical(first as AgencyRssRawEntry, {
      fetchedAt: '2026-07-15T09:00:00Z',
      sourceRecordId: 'sid-agency-rss',
    });
    expect(item.title).toContain('Fiji');
    expect(item.url).toBe('https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1551894');
    expect(item.publishedAt).toBe('2026-07-14T23:05:13.000Z');
    expect(item.sourceAuthority).toBe('OFFICIAL');
    expect(item.credibility).toBe(0.85);
  });

  it('maps a MEDIA-host entry to sourceAuthority MEDIA / credibility 0.65', () => {
    const raw: AgencyRssRawEntry = {
      title: 'Local storm coverage',
      url: 'https://www.digi24.ro/stiri/actualitate/storm',
      publishedAt: '2026-07-10T08:00:00.000Z',
      summary: 'A storm passed through the region.',
    };
    const item = agencyRssMapper.toCanonical(raw, {
      fetchedAt: '2026-07-15T09:00:00Z',
      sourceRecordId: 'sid-x',
    });
    expect(item.sourceAuthority).toBe('MEDIA');
    expect(item.credibility).toBe(0.65);
  });

  it('omits summary when the feed carried none', () => {
    const raw: AgencyRssRawEntry = {
      title: 'No-summary item',
      url: 'https://example-news.test/x',
      publishedAt: '2026-07-10T08:00:00.000Z',
      summary: '',
    };
    const item = agencyRssMapper.toCanonical(raw, {
      fetchedAt: '2026-07-15T09:00:00Z',
      sourceRecordId: 'sid-x',
    });
    expect(item.summary).toBeUndefined();
  });

  it('throws a typed PARSE on an entry missing title/url/publishedAt (defensive; never silently dropped here)', () => {
    const bad: AgencyRssRawEntry = { title: '', url: '', publishedAt: '', summary: '' };
    expect(() =>
      agencyRssMapper.toCanonical(bad, {
        fetchedAt: '2026-07-15T09:00:00Z',
        sourceRecordId: 'sid-x',
      }),
    ).toThrowError(/unmappable/);
  });
});
