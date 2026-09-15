// BEACON — GloFAS strict-WMS request-builder tests (WP A11). The GetFeatureInfo URL must be a
// SPEC-CONFORMANT OGC WMS 1.3.0 request against the real GloFAS OWS service, because 1.3.0 differs from
// 1.1.1 in exactly the two ways that silently return the wrong pixel when got wrong:
//   · the pixel is I/J (1.3.0), never X/Y (1.1.1);
//   · the CRS parameter is CRS (1.3.0), never SRS (1.1.1), and for EPSG:4326 the axis order is
//     LAT,LON (ISO 19111 / EPSG registry order) — so BBOX is minLat,minLon,maxLat,maxLon, i.e. the
//     transpose of BEACON's internal [west,south,east,north] Region bbox.
// Verified against the live service on 2026-09-10 (see glofas-wms.ts header for the evidence).
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import { buildGlofasFeatureInfoUrl, GLOFAS_INFO_FORMAT } from './glofas-wms.js';

const base = 'https://ows.globalfloods.eu/glofas-ows/ows.py';
const req = { baseUrl: base, layer: 'RPG_U_GLOFAS_3_3', lon: 97.175, lat: 29.875 };
const paramsOf = (url: string) => new URL(url).searchParams;

describe('buildGlofasFeatureInfoUrl — OGC WMS 1.3.0 conformance', () => {
  it('emits the full mandatory 1.3.0 GetFeatureInfo parameter set', () => {
    const p = paramsOf(buildGlofasFeatureInfoUrl(req));
    expect(p.get('SERVICE')).toBe('WMS');
    expect(p.get('VERSION')).toBe('1.3.0');
    expect(p.get('REQUEST')).toBe('GetFeatureInfo');
    expect(p.get('LAYERS')).toBe('RPG_U_GLOFAS_3_3');
    expect(p.get('QUERY_LAYERS')).toBe('RPG_U_GLOFAS_3_3');
    expect(p.get('STYLES')).toBe(''); // present-but-empty: mandatory in the GetMap parameter subset
    expect(p.get('INFO_FORMAT')).toBe(GLOFAS_INFO_FORMAT);
    expect(p.get('FEATURE_COUNT')).toBe('10');
  });

  it('uses CRS (not the 1.1.1 SRS) and I/J (not the 1.1.1 X/Y)', () => {
    const p = paramsOf(buildGlofasFeatureInfoUrl(req));
    expect(p.get('CRS')).toBe('EPSG:4326');
    expect(p.get('SRS')).toBeNull();
    expect(p.get('I')).toBe('256');
    expect(p.get('J')).toBe('256');
    expect(p.get('X')).toBeNull();
    expect(p.get('Y')).toBeNull();
  });

  it('writes the EPSG:4326 BBOX in LAT,LON axis order around the interrogated point', () => {
    const p = paramsOf(buildGlofasFeatureInfoUrl({ ...req, halfSpanDeg: 0.001 }));
    // lat first (29.874 / 29.876), lon second (97.174 / 97.176) — transposed vs [west,south,east,north].
    expect(p.get('BBOX')).toBe('29.874,97.174,29.876,97.176');
  });

  it('puts the interrogated point on the centre pixel of a square canvas', () => {
    const p = paramsOf(buildGlofasFeatureInfoUrl({ ...req, canvasPx: 100 }));
    expect(p.get('WIDTH')).toBe('100');
    expect(p.get('HEIGHT')).toBe('100');
    expect(p.get('I')).toBe('50');
    expect(p.get('J')).toBe('50');
  });

  it('keeps an operator-supplied query string on the configured base URL', () => {
    const url = buildGlofasFeatureInfoUrl({ ...req, baseUrl: `${base}?tenant=beacon` });
    const p = paramsOf(url);
    expect(p.get('tenant')).toBe('beacon');
    expect(p.get('REQUEST')).toBe('GetFeatureInfo');
  });

  it('rejects a coordinate whose interrogation box would leave the CRS (never a silent wrong pixel)', () => {
    const bads = [
      { lon: 181, lat: 0 },
      { lon: 0, lat: 91 },
      { lon: Number.NaN, lat: 0 },
      { lon: 0, lat: 90 },
    ];
    for (const bad of bads) {
      try {
        buildGlofasFeatureInfoUrl({ ...req, ...bad });
        expect.unreachable(`should reject ${JSON.stringify(bad)}`);
      } catch (e) {
        expect(isAdapterError(e)).toBe(true);
        if (isAdapterError(e)) expect(e.kind).toBe('CONFIG');
      }
    }
  });

  it('rejects a canvas outside the service-advertised MaxWidth/MaxHeight of 6144', () => {
    for (const canvasPx of [1, 6145, 512.5]) {
      try {
        buildGlofasFeatureInfoUrl({ ...req, canvasPx });
        expect.unreachable(`should reject canvasPx=${canvasPx}`);
      } catch (e) {
        expect(isAdapterError(e)).toBe(true);
        if (isAdapterError(e)) expect(e.kind).toBe('CONFIG');
      }
    }
  });
});
