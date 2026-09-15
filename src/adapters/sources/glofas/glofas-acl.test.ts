// BEACON — GloFAS strict-WMS ACL tests (WP A11; F1/adapter-contract §4). Every assertion below is
// pinned to a RECORDED live GetFeatureInfo response (src/adapters/sources/glofas/__fixtures__/*.html,
// captured 2026-09-10 — no network in this test). They prove: the two `tbl_info_point` tables parse
// label-first; the closed alert-level vocabulary maps deterministically to FloodCategory; the published
// ensemble percentage becomes a dimensionless fraction; the tendency GLYPH becomes the canonical
// tendency; the peak date is carried without inventing a time of day; and anything the ACL cannot
// ground raises a typed PARSE instead of being guessed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import {
  glofasMapper,
  parseGlofasFeatureInfo,
  categoryFromAlertLevel,
  categoryFromReturnPeriod,
  returnPeriodYearsFromAlertLevel,
} from './glofas-acl.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const MEDIUM = fixture('getfeatureinfo-medium.html');
const INACTIVE = fixture('getfeatureinfo-inactive-rising.html');
const STAGNANT = fixture('getfeatureinfo-stagnant.html');
const NO_FEATURE = fixture('getfeatureinfo-no-feature.html');

const ctx: MapContext = { fetchedAt: '2026-09-10T18:00:00Z', sourceRecordId: 'sid-1' };
const mapOne = (html: string) => {
  const point = parseGlofasFeatureInfo(html)[0];
  if (point === undefined) throw new Error('fixture parsed to no point');
  return glofasMapper.toCanonical(point, ctx);
};

describe('parseGlofasFeatureInfo (recorded live responses)', () => {
  it('reads the Point Information + Point Forecast tables of a real response', () => {
    const points = parseGlofasFeatureInfo(MEDIUM);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      pointId: 'DM001736',
      country: 'China',
      basin: 'Salween',
      lon: 97.175,
      lat: 29.875,
      forecastDate: '2026-09-10',
      alertLevel: 'Medium',
      maxProbabilityPct: '100 / 0 / 0',
      tendencyGlyph: 'FallingArrow',
      peakForecast: 'as currently ongoing',
    });
  });

  it('returns [] for the "No content" body the service sends when no point was hit', () => {
    expect(NO_FEATURE).toBe('No content'); // guards the fixture itself against silent drift
    expect(parseGlofasFeatureInfo(NO_FEATURE)).toEqual([]);
    expect(parseGlofasFeatureInfo('')).toEqual([]);
  });

  it('treats the source "NA" placeholder as absent, never as a station named NA', () => {
    const p = parseGlofasFeatureInfo(MEDIUM)[0];
    expect(p?.stationId).toBeUndefined(); // recorded value is literally "NA"
    expect(p?.river).toBeUndefined();
    expect(parseGlofasFeatureInfo(INACTIVE)[0]?.stationId).toBe('G0041');
  });
});

describe('alert level → ordered FloodCategory (closed vocabulary)', () => {
  // The vocabulary is the service's own: GetCapabilities names RPGM "Medium alert - T GT 2 years",
  // RPGH "High alert - T GT 5 years", RPGS "Severe alert - T GT 20 years"; "Inactive" is the
  // recorded value for a point below every threshold.
  it('maps each published level through its return period', () => {
    expect(returnPeriodYearsFromAlertLevel('Inactive')).toBe(0);
    expect(returnPeriodYearsFromAlertLevel('Medium')).toBe(2);
    expect(returnPeriodYearsFromAlertLevel('High')).toBe(5);
    expect(returnPeriodYearsFromAlertLevel('Severe')).toBe(20);
    expect(categoryFromAlertLevel('Inactive')).toBe('NONE');
    expect(categoryFromAlertLevel('Medium')).toBe('MINOR');
    expect(categoryFromAlertLevel('High')).toBe('MODERATE');
    expect(categoryFromAlertLevel('severe')).toBe('MAJOR'); // case-insensitive
  });

  it('raises PARSE on an unknown level instead of silently downgrading a flood to NONE', () => {
    try {
      categoryFromAlertLevel('Catastrophic');
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('keeps the return-period → category ladder shared with the legacy severity mapping', () => {
    expect(categoryFromReturnPeriod(20)).toBe('MAJOR');
    expect(categoryFromReturnPeriod(5)).toBe('MODERATE');
    expect(categoryFromReturnPeriod(2)).toBe('MINOR');
    expect(categoryFromReturnPeriod(0)).toBe('NONE');
  });
});

describe('glofasMapper.toCanonical (golden round-trip over recorded responses)', () => {
  it('maps the active Medium-alert point (China / Salween, DM001736)', () => {
    const g = mapOne(MEDIUM);
    expect(g.id).toBe('glofas:DM001736');
    expect(g.geom).toEqual({ type: 'Point', coordinates: [97.175, 29.875] });
    expect(g.floodCategory).toBe('MINOR'); // Medium = 2-year return period exceeded
    expect(g.exceedanceProbability).toBe(1); // published "100 / 0 / 0" % → fraction for the 2-yr threshold
    expect(g.tendency).toBe('DECREASING'); // FallingArrow glyph
    expect(g.crestTime).toBeUndefined(); // "as currently ongoing" names no date — nothing is invented
    expect(g.crestForecast).toBeUndefined(); // the WMS response publishes no discharge value at all
    expect(g.stage).toBeUndefined(); // GloFAS is a model, never an observed stage
    expect(g.sourceId).toBe('sid-1');
  });

  it('maps an inactive point, carrying the mildest published probability and the peak date', () => {
    const g = mapOne(INACTIVE);
    expect(g.id).toBe('glofas:SI000054');
    expect(g.geom).toEqual({ type: 'Point', coordinates: [-160.134, 66.973] });
    expect(g.floodCategory).toBe('NONE');
    expect(g.exceedanceProbability).toBe(0.09); // "9 / 1 / 0" % → 2-yr threshold, below GloFAS's 20 % alert bar
    expect(g.tendency).toBe('INCREASING'); // RisingArrow glyph
    expect(g.crestTime).toBe('2026-09-13'); // from "in 3 days (on 2026-09-13)" — a DATE, no invented clock time
  });

  it('maps the horizontal-glyph point to STAGNANT (the third published tendency)', () => {
    const g = mapOne(STAGNANT);
    expect(g.id).toBe('glofas:SI001473');
    expect(g.tendency).toBe('STAGNANT'); // leftArrow renders as a horizontal arrow
    expect(g.exceedanceProbability).toBe(0);
    expect(g.crestTime).toBe('2026-09-23');
  });

  it('reads the probability of the threshold the alert level names, not merely the first number', () => {
    const severe = mapOne(synthetic({ probability: '100 / 82 / 41', alert: 'Severe' }));
    expect(severe.floodCategory).toBe('MAJOR');
    expect(severe.exceedanceProbability).toBe(0.41); // the 20-yr column, matching the reported category
    const high = mapOne(synthetic({ probability: '100 / 82 / 41', alert: 'High' }));
    expect(high.floodCategory).toBe('MODERATE');
    expect(high.exceedanceProbability).toBe(0.82); // the 5-yr column
  });

  it('leaves the probability absent when the triple is unreadable, rather than guessing a unit', () => {
    expect(mapOne(synthetic({ probability: 'n/a' })).exceedanceProbability).toBeUndefined();
    expect(mapOne(synthetic({ probability: '140 / 0 / 0' })).exceedanceProbability).toBeUndefined();
  });

  it('leaves the tendency absent for an unrecognised glyph instead of asserting a direction', () => {
    expect(mapOne(synthetic({ glyph: 'SpiralArrow' })).tendency).toBeUndefined();
    expect(mapOne(synthetic({ glyph: undefined })).tendency).toBeUndefined();
  });

  it('raises a typed PARSE on a point whose coordinates the response did not carry', () => {
    try {
      mapOne(synthetic({ lon: 'NA', lat: 'NA' }));
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('falls back to the station id, then to lon,lat, when no Point ID is published', () => {
    expect(mapOne(synthetic({ pointId: 'NA', stationId: 'G0999' })).id).toBe('glofas:G0999');
    expect(mapOne(synthetic({ pointId: 'NA', stationId: 'NA' })).id).toBe('glofas:97.175,29.875');
  });
});

/**
 * A minimal response in the RECORDED markup shape, used only to exercise field combinations the live
 * service did not happen to be publishing on the capture day (a Severe alert, a broken probability
 * triple, an unknown glyph). The table/summary/label structure is copied verbatim from the fixtures —
 * no field name here is invented.
 */
function synthetic(o: {
  readonly pointId?: string;
  readonly stationId?: string;
  readonly lon?: string;
  readonly lat?: string;
  readonly probability?: string;
  readonly alert?: string;
  readonly glyph?: string | undefined;
}): string {
  const glyph = 'glyph' in o ? o.glyph : 'RisingArrow';
  const img =
    glyph === undefined
      ? ''
      : `<img class="img-responsive" src="https://global-flood.emergency.copernicus.eu/static/images/viewer/${glyph}.gif" alt="Discharge tendency">`;
  return `<table class="tbl_info_point" summary="Point Information">
<tr><th class="cell_header">Station ID</th><th>Country</th><th>Basin</th><th>River</th><th>Station Name</th><th>Point ID</th><th>Drainage Area [km2]</th><th>Longitude [Deg]</th><th>Latitude [Deg]</th><th>LISFLOOD Drainage Area [km2]</th><th>LISFLOOD X [Deg]</th><th>LISFLOOD Y [Deg]</th></tr>
<tr><td>${o.stationId ?? 'G0530'}</td><td>China</td><td>Salween</td><td>NA</td><td>Not a station</td><td>${o.pointId ?? 'DM001736'}</td><td>NA</td><td>${o.lon ?? '97.175'}</td><td>${o.lat ?? '29.875'}</td><td>590</td><td>97.175</td><td>29.875</td></tr>
</table><table class="tbl_info_point" summary="Point Forecast">
<caption>Point Forecast</caption>
<tr><th class="cell_header">Forecast Date</th><th>Maximum probability (2 yr / 5 yr / 20 yr)</th><th>Alert level</th><th>Max probability step (earliest)</th><th>Discharge tendency</th><th>Peak forecasted</th></tr>
<tr><td>2026-09-10</td><td>${o.probability ?? '100 / 0 / 0'}</td><td>${o.alert ?? 'Medium'}</td><td>as currently ongoing</td><td>${img}</td><td>as currently ongoing</td></tr>
</table>`;
}
