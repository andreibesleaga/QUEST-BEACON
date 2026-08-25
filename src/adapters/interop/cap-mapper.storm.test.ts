// BEACON — CAP v1.2 mapping for the storm family (ADR-032 §6; FR-STORM-1 / FU-9, Art. XIV).
//
// Three things must be true and stay true:
//   1. Storm and surge alerts map to CAP `<category>Met</category>` — CAP's own vocabulary already covers
//      meteorological hazards including tropical cyclones, so the domain enum needed no new value.
//   2. A surge (Polygon) and a cone (Polygon) serialize a real `<polygon>` area, unchanged.
//   3. A cyclone TRACK is a LineString, and CAP v1.2 has NO line primitive in `<area>` — so it degrades to
//      `<areaDesc>` text with no polygon/circle. That is a limitation of the STANDARD, not of BEACON, and it
//      is asserted here rather than merely commented, together with the obligation it creates: the caller
//      must put the descriptive location into `areaDesc`, because the geometry cannot carry it.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeAlert } from '@/domain/alert.js';
import type { Alert } from '@/domain/alert.js';
import { HAZARD_KINDS } from '@/domain/hazard-geometry.js';
import type { AlertId, IncidentId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { Geometry, LineStringGeometry, PolygonGeometry } from '@/domain/value-objects/geo.js';
import {
  alertToCap,
  buildCapAlert,
  capAreaIsTextOnly,
  capCategoryForHazardKind,
  capEventForHazardKind,
} from './cap-mapper.js';

const capSchema = JSON.parse(readFileSync('schemas/cap-v1.2.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateCap = ajv.compile(capSchema);

const SENT = '2026-07-05T22:00:00Z';

const SURGE_POLY: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [[[120.9, 14.5], [121.1, 14.5], [121.1, 14.7], [120.9, 14.7], [120.9, 14.5]]],
};
const TRACK_LINE: LineStringGeometry = {
  type: 'LineString',
  coordinates: [[125.5, 12.5], [123.4, 13.2], [121.2, 14.1]],
};

function stormAlert(area: Geometry, id = 'alert-storm-1'): Alert {
  return makeAlert({
    id: asId<AlertId>(id),
    incidentId: asId<IncidentId>('inc-storm-1'),
    capStatus: 'DRAFT',
    category: 'Met', // ADR-032 §2 — no new ALERT_CATEGORIES value needed
    severity: 'EXTREME',
    area,
    sentAt: SENT,
  });
}

describe('CAP category + event per hazard kind (ADR-032 §2/§6)', () => {
  it('categorizes every hazard kind — a new kind cannot slip through uncategorized', () => {
    for (const kind of HAZARD_KINDS) {
      expect(['Fire', 'Met', 'Safety'], kind).toContain(capCategoryForHazardKind(kind));
      expect(capEventForHazardKind(kind), kind).not.toBe('');
    }
  });

  it('maps the whole storm family to Met, alongside flood', () => {
    for (const kind of ['TRACK', 'CONE', 'STORM_SURGE'] as const) {
      expect(capCategoryForHazardKind(kind), kind).toBe('Met');
    }
    expect(capCategoryForHazardKind('STORM_SURGE')).toBe(capCategoryForHazardKind('FLOOD_REACH'));
    expect(capCategoryForHazardKind('PERIMETER')).toBe('Fire');
  });

  it('names the storm events distinctly, keeping the cyclone cone apart from the wildfire spread cone', () => {
    expect(capEventForHazardKind('TRACK')).toBe('Tropical cyclone');
    expect(capEventForHazardKind('STORM_SURGE')).toBe('Storm surge');
    expect(capEventForHazardKind('CONE')).not.toBe(capEventForHazardKind('SPREAD_CONE'));
  });
});

describe('CAP <area> for storm geometry', () => {
  it('serializes a surge polygon into a real CAP <polygon>, schema-valid', () => {
    const res = alertToCap(stormAlert(SURGE_POLY), {
      event: capEventForHazardKind('STORM_SURGE'),
      areaDesc: 'Manila Bay coastal barangays',
      responseType: ['Evacuate'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(validateCap(res.value), JSON.stringify(validateCap.errors)).toBe(true);
    const info = res.value.info[0]!;
    expect(info.category).toEqual(['Met']);
    expect(info.event).toBe('Storm surge');
    // CAP polygon strings are 'lat,lon' pairs — the reverse of GeoJSON's [lon,lat].
    expect(info.area?.[0]?.polygon?.[0]).toContain('14.5,120.9');
    expect(capAreaIsTextOnly(SURGE_POLY)).toBe(false);
  });

  it('degrades a cyclone TRACK to areaDesc text only — a CAP v1.2 gap, not a BEACON one', () => {
    const res = alertToCap(stormAlert(TRACK_LINE, 'alert-storm-track'), {
      event: capEventForHazardKind('TRACK'),
      areaDesc: 'Forecast track: Samar → Bicol → Metro Manila, landfall near Infanta, Quezon',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Still a fully schema-valid CAP document — the standard simply has nothing to hold a line.
    expect(validateCap(res.value), JSON.stringify(validateCap.errors)).toBe(true);
    const area = res.value.info[0]?.area?.[0];
    expect(area?.polygon).toBeUndefined();
    expect(area?.circle).toBeUndefined();
    // …so the descriptive location is the ONLY carrier of where the track goes, and must be present.
    expect(area?.areaDesc).toContain('landfall near Infanta');
    expect(capAreaIsTextOnly(TRACK_LINE)).toBe(true);
  });

  it('reports exactly which geometry types have no CAP area primitive', () => {
    expect(capAreaIsTextOnly({ type: 'Point', coordinates: [121, 14] })).toBe(false); // → circle radius 0
    expect(capAreaIsTextOnly({ type: 'MultiPolygon', coordinates: [SURGE_POLY.coordinates] })).toBe(false);
    expect(capAreaIsTextOnly(TRACK_LINE)).toBe(true);
  });

  it('falls back to the documented default areaDesc rather than emitting an area with no description', () => {
    const cap = buildCapAlert(stormAlert(TRACK_LINE), { event: capEventForHazardKind('TRACK') }, SENT);
    expect(cap.info[0]?.area?.[0]?.areaDesc).toBe('Affected area');
  });

  it('keeps a storm alert DRAFT until a human approves it (Art. XIII — unchanged by this ADR)', () => {
    const res = alertToCap(stormAlert(SURGE_POLY), { event: 'Storm surge' });
    expect(res.ok && res.value.status).toBe('Draft');
  });
});
