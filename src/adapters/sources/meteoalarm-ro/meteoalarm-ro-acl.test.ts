// BEACON — MeteoAlarm-RO ACL tests (E4·T-177). The parser lifts the real recorded legacy-Atom sample into
// raw entries; the mapper normalizes each to a NewsItem (unique Atom id → url; verbatim advisory summary);
// an entry missing title/id/published is a typed PARSE (never silently dropped). Pure, no clock/net.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { meteoalarmRoMapper, parseMeteoalarmRo } from './meteoalarm-ro-acl.js';
import type { MeteoalarmEntry } from './meteoalarm-ro-acl.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/romania-atom.xml', import.meta.url)),
  'utf8',
);
const CTX = { fetchedAt: '2026-07-07T09:35:05Z', sourceRecordId: 'sid-meteoalarm-ro' };

describe('parseMeteoalarmRo', () => {
  it('lifts every <entry> from the recorded Romania legacy-Atom sample', () => {
    const entries = parseMeteoalarmRo(FIXTURE);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.areaDesc)).toEqual(['Vrancea', 'Vâlcea', 'Vaslui']);
  });

  it('confirms the verified shape carries NO geometry — only county + awareness codes', () => {
    const [first] = parseMeteoalarmRo(FIXTURE);
    expect(first?.event).toBe('awareness_type=3, awareness_level=2');
    // The raw entry has no coordinates/polygon/point field at all (honest NewsItem mapping).
    expect(JSON.stringify(first)).not.toMatch(/coordinates|polygon|"geometry"/i);
  });
});

describe('meteoalarmRoMapper', () => {
  it('maps an entry to a NewsItem (unique Atom id as url; factual advisory summary)', () => {
    const [first] = parseMeteoalarmRo(FIXTURE);
    const item = meteoalarmRoMapper.toCanonical(first as MeteoalarmEntry, CTX);
    expect(item.title).toBe('Yellow Thunderstorm Warning issued for Romania - Vrancea');
    expect(item.url).toContain('index_area=37'); // the per-county-unique Atom id, not the shared cap+xml link
    expect(item.publishedAt).toBe('2026-07-07T07:00:50Z');
    expect(item.summary).toBe(
      'Vrancea — awareness_type=3, awareness_level=2 — severity Moderate/Likely/Future — ' +
        'effective 2026-07-07T06:44:00+00:00 until 2026-07-08T20:00:00+00:00',
    );
    // Official EUMETNET/ANM aggregator — must count as corroborating-official in news grounding,
    // never be treated as an unverified social signal (Art. XIV).
    expect(item.sourceAuthority).toBe('OFFICIAL');
    expect(item.credibility).toBe(0.85);
  });

  it('falls back to the cap+xml link when the Atom id is absent', () => {
    const raw: MeteoalarmEntry = {
      title: 'Yellow Thunderstorm Warning issued for Romania - Test',
      published: '2026-07-07T07:00:50Z',
      link: [{ '@_type': 'application/cap+xml', '@_href': 'https://feeds.meteoalarm.org/api/v1/warnings/x' }],
    };
    expect(meteoalarmRoMapper.toCanonical(raw, CTX).url).toBe('https://feeds.meteoalarm.org/api/v1/warnings/x');
  });

  it('throws a typed PARSE on an entry missing title/id/published (never silently dropped)', () => {
    const bad: MeteoalarmEntry = { areaDesc: 'Nowhere', event: 'awareness_type=3, awareness_level=2' };
    expect(() => meteoalarmRoMapper.toCanonical(bad, CTX)).toThrowError(/unmappable/);
  });
});
