// BEACON — IFRC Alert Hub ACL tests (S2·Lane-A2; F1/adapter-contract §4). The RECORDED REAL GraphQL
// response round-trips to OFFICIAL NewsItems; malformed alerts are dropped AND counted; a GraphQL
// `errors` payload raises PARSE instead of silently reporting "no official alerts"; the citation URL is
// the ISSUING AUTHORITY's own CAP document; the summary carries CAP fields verbatim.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { capHubMapper, parseCapHubAlerts } from './caphub-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/alerts.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseCapHubAlerts', () => {
  it('keeps every usable alert of the recorded response', () => {
    const res = parseCapHubAlerts(json);
    expect(res.alerts).toHaveLength(5);
    expect(res.skipped).toBe(0);
  });

  it('drops AND counts alerts with no url, no parseable sent, or no title', () => {
    const res = parseCapHubAlerts(
      JSON.stringify({
        data: {
          public: {
            alerts: {
              items: [
                { id: '1', sent: '2026-08-08T06:00:00+00:00', info: { headline: 'no url' } },
                { id: '2', sent: 'soon', url: 'https://x/1.xml', info: { headline: 'bad sent' } },
                { id: '3', sent: '2026-08-08T06:00:00+00:00', url: 'https://x/2.xml', info: {} },
                {
                  id: '4',
                  sent: '2026-08-08T06:00:00+00:00',
                  url: 'https://x/3.xml',
                  info: { event: 'Flood' },
                },
              ],
            },
          },
        },
      }),
    );
    expect(res.alerts.map((a) => a.id)).toEqual(['4']);
    expect(res.skipped).toBe(3);
  });

  it('raises PARSE on a GraphQL errors payload rather than reporting zero alerts (Art. XVI)', () => {
    try {
      parseCapHubAlerts(
        JSON.stringify({ data: null, errors: [{ message: "Cannot query field 'polling'" }] }),
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) {
        expect(e.kind).toBe('PARSE');
        expect(e.message).toContain("Cannot query field 'polling'");
      }
    }
  });

  it('returns an empty result for a well-formed response with no alerts', () => {
    expect(parseCapHubAlerts('{"data":{"public":{"alerts":{"items":[]}}}}')).toEqual({
      alerts: [],
      skipped: 0,
    });
    expect(parseCapHubAlerts('{"data":{"public":null}}')).toEqual({ alerts: [], skipped: 0 });
  });
});

describe('capHubMapper.toCanonical (golden round-trip over the recorded response)', () => {
  it('maps every recorded alert to an OFFICIAL NewsItem citing the issuing authority document', () => {
    const { alerts } = parseCapHubAlerts(json);
    const items = alerts.map((a) => capHubMapper.toCanonical(a, ctx));
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.sourceAuthority).toBe('OFFICIAL');
      expect(item.credibility).toBe(0.85);
      // The citation points at the ISSUING authority's own host, never at the aggregator.
      expect(item.url.startsWith('https://meteoinfo.ru/')).toBe(true);
      expect(Number.isNaN(Date.parse(item.publishedAt))).toBe(false);
    }
    const first = items[0];
    expect(first?.title).toBe('Other dangers');
    expect(first?.publishedAt).toBe('2026-08-08T06:53:23+00:00');
    expect(first?.summary).toBe(
      'Russian Federation — Other dangers — severity SEVERE/IMMEDIATE/LIKELY — ' +
        'effective 2026-08-08T06:53:00+00:00 until 2026-08-10T00:00:00+00:00 — issued by web@mecom.ru — ACTUAL/ALERT',
    );
  });

  it('prefers CAP headline over event, and falls back to event when the headline is blank', () => {
    const withHeadline = capHubMapper.toCanonical(
      {
        url: 'https://x/1.xml',
        sent: '2026-07-04T00:00:00Z',
        info: { headline: 'Red flood warning', event: 'Flood' },
      },
      ctx,
    );
    expect(withHeadline.title).toBe('Red flood warning');
    const noHeadline = capHubMapper.toCanonical(
      {
        url: 'https://x/2.xml',
        sent: '2026-07-04T00:00:00Z',
        info: { headline: '   ', event: 'Flood' },
      },
      ctx,
    );
    expect(noHeadline.title).toBe('Flood');
  });

  it('reports an expires-only validity window and prefers senderName over the raw sender address', () => {
    const item = capHubMapper.toCanonical(
      {
        url: 'https://x/3.xml',
        sent: '2026-07-04T00:00:00Z',
        sender: 'web@example.gov',
        info: {
          event: 'Wildfire',
          expires: '2026-07-05T00:00:00Z',
          senderName: 'National Met Service',
        },
      },
      ctx,
    );
    expect(item.summary).toBe(
      'Wildfire — expires 2026-07-05T00:00:00Z — issued by National Met Service',
    );
  });

  it('emits an empty summary rather than inventing context when CAP carried none', () => {
    const item = capHubMapper.toCanonical(
      {
        url: 'https://x/4.xml',
        sent: '2026-07-04T00:00:00Z',
        info: { event: '', headline: 'Bare' },
      },
      ctx,
    );
    expect(item.summary).toBe('');
  });

  it('raises a typed PARSE for an alert the ACL cannot map', () => {
    try {
      capHubMapper.toCanonical(
        { id: '9', sent: '2026-07-04T00:00:00Z', info: { headline: 'no url' } },
        ctx,
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
