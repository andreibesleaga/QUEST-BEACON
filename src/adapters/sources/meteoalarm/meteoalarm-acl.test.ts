// BEACON — MeteoAlarm generic ACL tests (B3.1). The ONE parser/mapper now behind every country feed:
// it lifts the hand-authored (recorded-style, labelled) Greece/Spain samples AND stays byte-identical in
// behaviour on the RECORDED Romania sample (backward compatibility is additionally pinned by the untouched
// meteoalarm-ro test files). Pure, no clock/net.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { meteoalarmMapper, parseMeteoalarm } from './meteoalarm-acl.js';
import type { MeteoalarmEntry } from './meteoalarm-acl.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const GREECE = read('./__fixtures__/greece-atom.xml');
const SPAIN = read('./__fixtures__/spain-atom.xml');
const ROMANIA = read('../meteoalarm-ro/__fixtures__/romania-atom.xml'); // the RECORDED sample, unchanged
const CTX = { fetchedAt: '2026-07-05T09:00:00Z', sourceRecordId: 'sid-meteoalarm' };

describe('parseMeteoalarm (generic country feeds)', () => {
  it('lifts every <entry> from the Greece sample', () => {
    const entries = parseMeteoalarm(GREECE);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.areaDesc)).toEqual(['Attica', 'Crete']);
  });

  it('lifts every <entry> from the Spain sample', () => {
    const entries = parseMeteoalarm(SPAIN);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.areaDesc)).toEqual(['Sevilla', 'Valencia']);
  });

  it('is the SAME parser the RO adapter always used: the recorded Romania sample still lifts identically', () => {
    const entries = parseMeteoalarm(ROMANIA);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.areaDesc)).toEqual(['Vrancea', 'Vâlcea', 'Vaslui']);
  });

  it('confirms the verified shape carries NO geometry — only area names + awareness codes', () => {
    const [first] = parseMeteoalarm(GREECE);
    expect(first?.event).toBe('awareness_type=8, awareness_level=2');
    expect(JSON.stringify(first)).not.toMatch(/coordinates|polygon|"geometry"/i);
  });
});

describe('meteoalarmMapper', () => {
  it('maps a Greece entry to a NewsItem (unique Atom id as url; factual advisory summary)', () => {
    const [first] = parseMeteoalarm(GREECE);
    const item = meteoalarmMapper.toCanonical(first as MeteoalarmEntry, CTX);
    expect(item.title).toBe('Yellow Forest fire Warning issued for Greece - Attica');
    expect(item.url).toContain('feeds-greece');
    expect(item.url).toContain('index_area=4'); // the per-area-unique Atom id, not the shared cap+xml link
    expect(item.publishedAt).toBe('2026-07-05T06:00:10Z');
    expect(item.summary).toBe(
      'Attica — awareness_type=8, awareness_level=2 — severity Moderate/Likely/Future — ' +
        'effective 2026-07-05T06:00:00+00:00 until 2026-07-06T20:00:00+00:00',
    );
    // Official EUMETNET/national-met aggregator — corroborating-official in news grounding (Art. XIV).
    expect(item.sourceAuthority).toBe('OFFICIAL');
    expect(item.credibility).toBe(0.85);
  });

  it('maps a Spain entry identically (no country-specific code paths)', () => {
    const [, second] = parseMeteoalarm(SPAIN);
    const item = meteoalarmMapper.toCanonical(second as MeteoalarmEntry, CTX);
    expect(item.title).toBe('Yellow Thunderstorm Warning issued for Spain - Valencia');
    expect(item.url).toContain('feeds-spain');
    expect(item.sourceAuthority).toBe('OFFICIAL');
  });

  it('throws a typed PARSE on an entry missing title/id/published (never silently dropped)', () => {
    const bad: MeteoalarmEntry = {
      areaDesc: 'Nowhere',
      event: 'awareness_type=3, awareness_level=2',
    };
    expect(() => meteoalarmMapper.toCanonical(bad, CTX)).toThrowError(/unmappable/);
  });
});
