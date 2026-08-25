// BEACON — WMO-SWIC ACL tests (B3.2). Fixture-pinned proofs of the three BINDING findings:
//   F-48 🔴 acp (Tropical Cyclone Alert) areas are ADVISORY alerting-extent, never hazard geometry —
//           classified + labelled, and structurally unable to reach exposure (NewsItem carries no
//           geometry/kind at all).
//   F-49    multiple <polygon> per <area> → ONE MultiPolygon over ALL rings (never first-ring-only),
//           and CAP `lat,lon` order is swapped to GeoJSON `[lon, lat]`.
//   F-51    fixtures are hand-authored recorded-style from documented evidence (labelled in-file).
// Pure, no clock/net.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  capAreaMultiPolygon,
  isAdvisoryExtentOnly,
  parseSwicCap,
  parseSwicIndex,
  swicCapMapper,
} from './wmo-swic-acl.js';
import type { SwicCapAlert } from './wmo-swic-acl.js';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const INDEX = read('./__fixtures__/ph-pagasa-en-rss.xml');
const GFA_URL =
  'https://severeweather.wmo.int/v2/cap-alerts/ph-pagasa-en/2026/07/27/09/47/59-58b49f5fb6529a1eabdacffc14d9daaa.xml';
const ACP_URL =
  'https://severeweather.wmo.int/v2/cap-alerts/ph-pagasa-en/2026/07/25/02/48/48-cc368dd67ebd49d9ba0225c9d3b51a76.xml';
const GFA = parseSwicCap(read('./__fixtures__/59-58b49f5fb6529a1eabdacffc14d9daaa.xml'), GFA_URL);
const ACP = parseSwicCap(read('./__fixtures__/48-cc368dd67ebd49d9ba0225c9d3b51a76.xml'), ACP_URL);
const CTX = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-wmo-swic' };

// The SHIPPED `ph` extent, read from config/regions.json rather than re-typed here — used only to document
// why the acp polygon must never render: the PAR is WIDER than the zone on BOTH sides. B3.3 corrected the
// spike's approximate bbox (F-51), so a hand-copied literal would now be a stale second copy of a region's
// geography, which is the F-06 defect in miniature.
const PH_CONFIG_BBOX = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../config/regions.json', import.meta.url)), 'utf8')) as {
    regions: readonly { id: string; bbox: readonly number[] }[];
  }
).regions.find((r) => r.id === 'ph')!.bbox;
const PH_BBOX = { minLon: PH_CONFIG_BBOX[0]!, maxLon: PH_CONFIG_BBOX[2]! };

describe('parseSwicIndex', () => {
  it('lifts every usable <item> with its per-alert CAP link (none skipped in the fixture)', () => {
    const { items, skipped } = parseSwicIndex(INDEX);
    expect(items).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(items[0]?.link).toBe(GFA_URL);
    expect(items[1]?.title).toBe('Tropical Cyclone Alert');
  });

  it('is lenient: a linkless <item> is skipped AND counted, never aborting the rest', () => {
    const xml = '<rss><channel><item><title>no link</title></item><item><title>ok</title>' +
      `<link>${GFA_URL}</link></item></channel></rss>`;
    const { items, skipped } = parseSwicIndex(xml);
    expect(items).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

describe('parseSwicCap (lenient CAP v1.2)', () => {
  it('parses the gfa document: event/severity/expires + BOTH areas + the SAME geocode, verbatim', () => {
    expect(GFA).not.toBeNull();
    if (GFA === null) return;
    expect(GFA.sender).toBe('PAGASA-DOST');
    expect(GFA.event).toBe('General Flood Advisory (Severe)');
    expect(GFA.severity).toBe('Severe');
    expect(GFA.certainty).toBe('Likely');
    expect(GFA.expires).toBe('2026-07-28T05:47:59+08:00');
    expect(GFA.areas.map((a) => a.areaDesc)).toEqual(['Maguindanao', 'Lanao Del Sur']);
    expect(GFA.areas[1]?.geocodes).toEqual([{ valueName: 'SAME', value: '153600000' }]);
  });

  it('drops a malformed document as null (counted by the caller), never a throw', () => {
    expect(parseSwicCap('<html>not cap</html>', 'x')).toBeNull();
    expect(parseSwicCap('<alert><identifier>i</identifier></alert>', 'x')).toBeNull(); // no <info>
    expect(parseSwicCap('<alert><sent>2026-07-25T10:48:59+08:00</sent><info/></alert>', 'x')).toBeNull(); // no event/headline
  });

  it('ignores unknown fields (lenient): extra elements do not break the parse', () => {
    const xml = '<alert><sender>X</sender><sent>2026-07-25T10:48:59+08:00</sent><futureField>?</futureField>' +
      '<info><event>Test Event</event><newThing>ignored</newThing></info></alert>';
    const doc = parseSwicCap(xml, 'u');
    expect(doc?.event).toBe('Test Event');
  });
});

describe('capAreaMultiPolygon — F-49 (multi-ring + axis order), fixture-pinned', () => {
  it('emits ALL THREE Maguindanao <polygon> rings as ONE MultiPolygon — never first-ring-only', () => {
    const area = GFA?.areas[0];
    expect(area?.polygons).toHaveLength(3); // the observed multi-<polygon> shape survives parsing
    const geom = capAreaMultiPolygon(area!);
    expect(geom?.type).toBe('MultiPolygon');
    expect(geom?.coordinates).toHaveLength(3); // all rings, F-49
  });

  it('swaps CAP `lat,lon` to GeoJSON `[lon, lat]` on every vertex', () => {
    const geom = capAreaMultiPolygon(GFA!.areas[0]!);
    // Fixture ring 1 starts `7.20,124.25` (lat,lon) ⇒ GeoJSON position [124.25, 7.20].
    expect(geom?.coordinates[0]?.[0]?.[0]).toEqual([124.25, 7.2]);
    // Every parsed vertex is [lon, lat]: in Mindanao lon ≈ 124 > lat ≈ 7 — a transposed axis would flip this.
    for (const poly of geom?.coordinates ?? []) {
      for (const [lon, lat] of poly[0] ?? []) {
        expect(lon).toBeGreaterThan(100);
        expect(lat).toBeLessThan(10);
      }
    }
  });

  it('a geocode-only area yields null — geometry is never fabricated (Art. XVI)', () => {
    const area = { areaDesc: 'X', polygons: [], geocodes: [{ valueName: 'SAME', value: '1' }] };
    expect(capAreaMultiPolygon(area)).toBeNull();
  });

  it('drops a malformed ring and closes an unclosed one deterministically', () => {
    const area = {
      areaDesc: 'X',
      polygons: ['1,2 not,numeric 3,4 1,2', '1,10 2,11 3,12 1.5,10.5'],
      geocodes: [],
    };
    const geom = capAreaMultiPolygon(area);
    expect(geom?.coordinates).toHaveLength(1); // malformed ring dropped, valid ring kept
    const ring = geom?.coordinates[0]?.[0];
    expect(ring?.[0]).toEqual(ring?.[ring.length - 1]); // closed
  });
});

describe('acp advisory-extent classification — F-48 🔴, fixture-pinned', () => {
  it('classifies the Tropical Cyclone Alert as advisory-extent-only; the gfa is NOT', () => {
    expect(isAdvisoryExtentOnly(ACP!)).toBe(true);
    expect(isAdvisoryExtentOnly(GFA!)).toBe(false);
  });

  it('documents WHY: the acp PAR polygon is WIDER than the ph bbox on both sides — a false West-Pacific footprint if rendered', () => {
    const geom = capAreaMultiPolygon(ACP!.areas[0]!);
    const lons = (geom?.coordinates[0]?.[0] ?? []).map(([lon]) => lon);
    expect(Math.min(...lons)).toBe(113); // west of the shipped PH bbox (116.87)
    expect(Math.max(...lons)).toBe(130); // east of the shipped PH bbox (126.62)
    expect(Math.min(...lons)).toBeLessThan(PH_BBOX.minLon);
    expect(Math.max(...lons)).toBeGreaterThan(PH_BBOX.maxLon);
  });
});

describe('swicCapMapper → NewsItem (the F-48 mechanism: alert intel, never hazard geometry)', () => {
  it('maps the gfa to an OFFICIAL NewsItem (event as title — no headline in the observed gfa)', () => {
    const item = swicCapMapper.toCanonical(GFA!, CTX);
    expect(item.title).toBe('General Flood Advisory (Severe)');
    expect(item.url).toBe(GFA_URL); // the unique per-alert CAP URL
    expect(item.publishedAt).toBe('2026-07-27T17:47:59+08:00');
    expect(item.summary).toBe(
      'Maguindanao; Lanao Del Sur — General Flood Advisory (Severe) — severity Severe/Likely/Expected — ' +
        'expires 2026-07-28T05:47:59+08:00',
    );
    expect(item.sourceAuthority).toBe('OFFICIAL');
    expect(item.credibility).toBe(0.85);
  });

  it('maps the acp to a NewsItem whose summary carries the mandatory alerting-area label (F-48)', () => {
    const item = swicCapMapper.toCanonical(ACP!, CTX);
    expect(item.title).toBe('Tropical Cyclone Alert : Typhoon Kiyapo (NOUL)');
    expect(item.summary).toContain('alerting area only, not the storm extent');
    expect(item.summary).toContain('storm footprint comes from GDACS');
  });

  it('F-48 structural pin: mapped entities carry NO geometry and NO HazardGeometry shape at all', () => {
    for (const alert of [GFA!, ACP!]) {
      const item = swicCapMapper.toCanonical(alert, CTX);
      const keys = Object.keys(item);
      // A NewsItem has no geometry/kind/incidentId — it can never satisfy HazardGeometry, so it can
      // never pass exposureBearingHazards()/EXPOSURE_BEARING_BY_KIND nor render as a hazard footprint.
      expect(keys).not.toContain('geometry');
      expect(keys).not.toContain('kind');
      expect(keys).not.toContain('incidentId');
      expect(JSON.stringify(item)).not.toMatch(/"coordinates"|"MultiPolygon"|"Polygon"/);
    }
  });
});

describe('honest-limitation guards (F-51)', () => {
  it('claims only the observed families: an unobserved family maps as plain news with NO advisory-extent label', () => {
    const rainfall: SwicCapAlert = {
      ...(GFA as SwicCapAlert),
      event: 'Heavy Rainfall Warning',
      headline: '',
      areas: [],
    };
    expect(isAdvisoryExtentOnly(rainfall)).toBe(false); // no invented classification beyond the evidence
    const item = swicCapMapper.toCanonical(rainfall, CTX);
    expect(item.summary).not.toContain('alerting area only');
  });
});
