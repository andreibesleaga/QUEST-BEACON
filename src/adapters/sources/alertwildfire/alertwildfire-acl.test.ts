// BEACON — ALERTWildfire ACL tests. Pure/deterministic parse+mapper (Art. XII): a well-formed
// ALERTCalifornia camera GeoJSON feature maps straight through to a FIRE_CAMERA CameraFeed carrying the
// mandatory 'ALERTCalifornia | UC San Diego' credit; a feature without a Point geometry, a name, or an
// https `cameraURL` is SKIPPED and counted (link-only: no https view page ⇒ no pin). The real recorded
// Butte-County fixture parses to 15 mapped cameras. Deterministic clock is safely in the past.
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  ALERT_LICENSE,
  ALERT_PROVIDER,
  alertWildfireMapper,
  parseAlertCameras,
  toIsoUtc,
} from './alertwildfire-acl.js';
import type { AlertCameraRow } from './alertwildfire-acl.js';
import type { LinkOnlyUrl } from '@/domain/shared/link-policy.js';
import { LINK_POLICY_MAX_LENGTH, assertLinkOnlyUrl } from '@/domain/shared/link-policy.js';

const CTX = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-alert' };

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/cameras.json', import.meta.url)),
  'utf8',
);

const feature = (props: Record<string, unknown>, geom: unknown = { type: 'Point', coordinates: [-121.48, 39.95] }) =>
  JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: geom }] });

const GOOD_PROPS = {
  OBJECTID: 10,
  cameraName: 'Bald Mtn. (Butte) 1',
  siteId: 'baldmtnbutte',
  county: 'butte',
  cameraURL: 'https://cameras.alertcalifornia.org/?id=Axis-BaldMtnButte1',
  viewTime: '2026-07-16 13:23:42-07:00',
};

describe('parseAlertCameras', () => {
  it('parses the real recorded Butte-County fixture into 15 mapper-ready camera rows', () => {
    const { rows, skipped } = parseAlertCameras(FIXTURE);
    expect(rows).toHaveLength(15);
    expect(skipped).toBe(0);
    expect(rows[0]).toMatchObject({
      objectId: '10',
      title: 'Bald Mtn. (Butte) 1',
      viewUrl: 'https://cameras.alertcalifornia.org/?id=Axis-BaldMtnButte1',
    });
    expect(rows[0]?.position).toEqual([-121.482498, 39.952499]);
  });

  it('maps a well-formed feature to one row with a normalized ISO observedAt', () => {
    const { rows, skipped } = parseAlertCameras(feature(GOOD_PROPS));
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.observedAt).toBe('2026-07-16T13:23:42-07:00');
  });

  it('DROPS and counts a feature whose cameraURL is not https (link-only href guard)', () => {
    const { rows, skipped } = parseAlertCameras(
      feature({ ...GOOD_PROPS, cameraURL: 'http://cameras.alertcalifornia.org/?id=Axis-BaldMtnButte1' }),
    );
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('DROPS and counts a feature with a javascript: cameraURL (injection guard)', () => {
    const { rows, skipped } = parseAlertCameras(feature({ ...GOOD_PROPS, cameraURL: 'javascript:alert(1)' }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  // F-153 convergence proof: an `https:` cameraURL that the PRIVATE predicate this file used to carry
  // (`new URL(x).protocol === 'https:'`) would have accepted, dropped now only because the decision is made
  // by the SHARED @/domain/shared/link-policy. Re-introduce a local https check and these two go green again.
  it('F-153 DROPS a feature whose cameraURL host is an IP LITERAL (SSRF/cloud-metadata pivot)', () => {
    expect(parseAlertCameras(feature({ ...GOOD_PROPS, cameraURL: 'https://169.254.169.254/?id=x' }))).toMatchObject({
      rows: [],
      skipped: 1,
    });
    expect(parseAlertCameras(feature({ ...GOOD_PROPS, cameraURL: 'https://[::1]/?id=x' }))).toMatchObject({
      rows: [],
      skipped: 1,
    });
  });

  it('F-153 DROPS a feature whose cameraURL exceeds the shared LINK_POLICY_MAX_LENGTH cap', () => {
    const tooLong = `https://cameras.alertcalifornia.org/?id=${'a'.repeat(LINK_POLICY_MAX_LENGTH)}`;
    expect(parseAlertCameras(feature({ ...GOOD_PROPS, cameraURL: tooLong }))).toMatchObject({ rows: [], skipped: 1 });
  });

  it('DROPS and counts a feature with a missing/blank cameraURL', () => {
    expect(parseAlertCameras(feature({ ...GOOD_PROPS, cameraURL: '  ' }))).toMatchObject({ skipped: 1 });
    expect(parseAlertCameras(feature({ ...GOOD_PROPS, cameraURL: null }))).toMatchObject({ skipped: 1 });
  });

  it('DROPS and counts a feature with a non-Point / missing geometry', () => {
    expect(parseAlertCameras(feature(GOOD_PROPS, { type: 'Polygon', coordinates: [] }))).toMatchObject({ skipped: 1 });
    expect(parseAlertCameras(feature(GOOD_PROPS, null))).toMatchObject({ skipped: 1 });
  });

  it('DROPS and counts a feature with a blank camera name', () => {
    const { rows, skipped } = parseAlertCameras(feature({ ...GOOD_PROPS, cameraName: '   ' }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('counts malformed features alongside well-formed ones in the same batch', () => {
    const fc = JSON.stringify({
      features: [
        { properties: GOOD_PROPS, geometry: { type: 'Point', coordinates: [-121.48, 39.95] } },
        { properties: { ...GOOD_PROPS, OBJECTID: 2, cameraURL: 'http://x' }, geometry: { type: 'Point', coordinates: [-121, 39] } },
        { properties: { ...GOOD_PROPS, OBJECTID: 3 } }, // missing geometry
      ],
    });
    const { rows, skipped } = parseAlertCameras(fc);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('returns nothing when there are no features', () => {
    expect(parseAlertCameras(JSON.stringify({}))).toEqual({ rows: [], skipped: 0 });
  });
});

describe('toIsoUtc (viewTime normalization)', () => {
  it("replaces the date/time space with 'T' to yield ISO-8601", () => {
    expect(toIsoUtc('2026-07-16 13:23:42-07:00')).toBe('2026-07-16T13:23:42-07:00');
  });
  it('drops an unparseable or empty viewTime', () => {
    expect(toIsoUtc('not-a-date')).toBeUndefined();
    expect(toIsoUtc('  ')).toBeUndefined();
    expect(toIsoUtc(null)).toBeUndefined();
    expect(toIsoUtc(undefined)).toBeUndefined();
  });
});

/** F-153: `AlertCameraRow.viewUrl` is the branded `LinkOnlyUrl`, so even a hand-written test row must pass
 *  the SHARED policy to exist — a fixture link violating it throws here rather than reaching the mapper. */
function link(raw: string): LinkOnlyUrl {
  assertLinkOnlyUrl(raw, 'test fixture link');
  return raw;
}

describe('alertWildfireMapper.toCanonical', () => {
  const ROW: AlertCameraRow = {
    objectId: '10',
    title: 'Bald Mtn. (Butte) 1',
    position: [-121.482498, 39.952499],
    viewUrl: link('https://cameras.alertcalifornia.org/?id=Axis-BaldMtnButte1'),
    observedAt: '2026-07-16T13:23:42-07:00',
  };

  it('maps a row to a FIRE_CAMERA CameraFeed with the mandatory ALERTCalifornia credit as provider', () => {
    const cam = alertWildfireMapper.toCanonical(ROW, CTX);
    expect(cam.id).toBe('alertwildfire:10');
    expect(cam.kind).toBe('FIRE_CAMERA');
    expect(cam.title).toBe('Bald Mtn. (Butte) 1');
    expect(cam.provider).toBe(ALERT_PROVIDER);
    expect(cam.provider).toBe('ALERTCalifornia | UC San Diego');
    expect(cam.license).toBe(ALERT_LICENSE);
    expect(cam.viewUrl).toBe(ROW.viewUrl);
    expect(cam.isLive).toBe(true);
    expect(cam.position).toEqual([-121.482498, 39.952499]);
    expect(cam.observedAt).toBe('2026-07-16T13:23:42-07:00');
  });

  it('omits observedAt when the row has none', () => {
    const noTime: AlertCameraRow = {
      objectId: ROW.objectId,
      title: ROW.title,
      position: ROW.position,
      viewUrl: ROW.viewUrl,
    };
    const cam = alertWildfireMapper.toCanonical(noTime, CTX);
    expect(cam.observedAt).toBeUndefined();
  });

  it('every mapped fixture camera carries the credit + https link-only view page', () => {
    const { rows } = parseAlertCameras(FIXTURE);
    const cams = rows.map((r) => alertWildfireMapper.toCanonical(r, CTX));
    expect(cams).toHaveLength(15);
    expect(cams.every((c) => c.provider === 'ALERTCalifornia | UC San Diego')).toBe(true);
    expect(cams.every((c) => c.viewUrl.startsWith('https://'))).toBe(true);
    expect(cams.every((c) => c.kind === 'FIRE_CAMERA' && c.isLive)).toBe(true);
    expect(new Set(cams.map((c) => c.id)).size).toBe(cams.length); // stable, distinct ids
  });
});
