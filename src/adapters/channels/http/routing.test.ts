// BEACON — path segments are percent-DECODED (2026-09-14). A discovered incident id carries colons, every
// client sends them as %3A, and the live deployment answered 404 to each of its own incidents.
import { describe, expect, it } from 'vitest';
import { decodeSegment, resolveRoute, segmentsAfterApi } from './routing.js';

describe('segmentsAfterApi', () => {
  it('decodes each segment after splitting, so an encoded slash never adds a segment', () => {
    expect(
      segmentsAfterApi('/api/v1/incidents/discovered%3Aus-ca%3AWILDFIRE%3A-492%3A156/sitrep'),
    ).toEqual(['incidents', 'discovered:us-ca:WILDFIRE:-492:156', 'sitrep']);
    expect(segmentsAfterApi('/api/v1/incidents/a%2Fb/sitrep')).toEqual([
      'incidents',
      'a/b',
      'sitrep',
    ]);
  });

  it('keeps a malformed encoding verbatim rather than throwing', () => {
    expect(decodeSegment('%E0%A4%A')).toBe('%E0%A4%A');
    expect(segmentsAfterApi('/api/v1/incidents/%zz/sitrep')).toEqual([
      'incidents',
      '%zz',
      'sitrep',
    ]);
  });
});

describe('resolveRoute', () => {
  it('routes GET /incidents/{encoded id}/sitrep to the sitrep command with the DECODED id', () => {
    const r = resolveRoute(
      {
        method: 'GET',
        path: '/api/v1/incidents/discovered%3Aus-ca%3AWILDFIRE%3A-492%3A156/sitrep',
        headers: {},
        query: {},
      },
      'anon',
    );
    expect(r.kind).toBe('command');
    if (r.kind !== 'command') return;
    expect(String((r.command as { incidentId?: string }).incidentId)).toBe(
      'discovered:us-ca:WILDFIRE:-492:156',
    );
  });
});
