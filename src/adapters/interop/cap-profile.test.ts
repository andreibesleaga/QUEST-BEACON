// BEACON — CAP profile validation battery (D3.1; ADR-036 §1 + V1/V2). Three things are under test:
//   1. the SHIPPED CONFIG is real and complete — every id the enum offers has a compilable rule set on disk
//      (ADR-012's "config, not code" is only true if the config is validated);
//   2. profile selection actually CHANGES the outcome and BLOCKS — the whole claim rests on this;
//   3. the validator never throws and always yields a non-empty, actionable error list (V1 fuzz posture).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeAlert } from '@/domain/alert.js';
import type { Alert } from '@/domain/alert.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import type { PolygonGeometry } from '@/domain/value-objects/geo.js';
import { alertToCap } from './cap-mapper.js';
import {
  CAP_PROFILE_IDS, DEFAULT_CAP_PROFILE, capProfilePath, isCapProfileId, toCapProfileId, validateCapProfile,
} from './cap-profile.js';

const PROFILE_DIR = fileURLToPath(new URL('../../../schemas/cap-profiles/', import.meta.url));
const SENT = '2026-07-05T22:00:00Z';

const RING: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [[[-121.7, 39.6], [-121.5, 39.6], [-121.5, 39.8], [-121.7, 39.8], [-121.7, 39.6]]],
};

/** An approved ACTUAL alert — the only kind that reaches a profile gate (Art. XIII). */
function actualAlert(): Alert {
  return makeAlert({
    id: asId<AlertId>('alert-profile-1'),
    incidentId: asId<IncidentId>('inc-1'),
    capStatus: 'ACTUAL',
    approvedBy: asId<AppUserId>('em-1'),
    category: 'Fire',
    severity: 'SEVERE',
    area: RING,
    sentAt: SENT,
  });
}

/** The options an operator must supply for a document to satisfy the transcribed IPAWS rules. */
const IPAWS_OPTS = {
  code: ['IPAWSv1.0'],
  expires: '2026-07-06T04:00:00Z',
  eventCode: [{ valueName: 'SAME', value: 'FRW' }],
  areaDesc: 'Butte County, California',
} as const;

describe('shipped profile config (ADR-012 — config is only config if it is validated)', () => {
  it('ships exactly one rule-set file per profile id, and no orphan files', () => {
    const onDisk = readdirSync(PROFILE_DIR)
      .filter((f) => f.endsWith('.schema.json'))
      .map((f) => f.replace(/\.schema\.json$/, ''))
      .sort();
    expect(onDisk).toEqual([...CAP_PROFILE_IDS].sort());
  });

  it('every shipped rule set is a compilable JSON Schema (a broken profile must fail the build, not an emit)', () => {
    for (const id of CAP_PROFILE_IDS) {
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const schema = JSON.parse(readFileSync(capProfilePath(id), 'utf8')) as object;
      expect(() => ajv.compile(schema), `schemas/cap-profiles/${id}.schema.json`).not.toThrow();
    }
  });

  it('every IPAWS rule carries the verbatim requirement text and its citation (never invented)', () => {
    const raw = readFileSync(capProfilePath('ipaws'), 'utf8');
    const doc = JSON.parse(raw) as Record<string, unknown>;
    // The document-level citation names the exact published specification and its approval date.
    expect(String(doc['$comment'])).toContain(
      'Integrated Public Alert and Warning System Profile Version 1.0',
    );
    expect(String(doc['$comment'])).toContain('13 October 2009');
    expect(String(doc['$comment'])).toContain('docs.oasis-open.org');
    // And the rules the profile states but BEACON does not enforce are enumerated with a reason, so the
    // transcription is complete and the gaps are visible.
    const gaps = doc['x-transcribed-not-enforced'] as readonly Record<string, string>[];
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap['verbatim']?.length ?? 0).toBeGreaterThan(0);
      expect(gap['reason']?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('resolves the default profile and rejects an unknown id (defensive floor under the boot check)', () => {
    expect(DEFAULT_CAP_PROFILE).toBe('base');
    expect(isCapProfileId('ipaws')).toBe(true);
    expect(isCapProfileId('IPAWS')).toBe(false);
    expect(isCapProfileId('../../etc/passwd')).toBe(false);
    expect(toCapProfileId('nope')).toBe('base');
    expect(toCapProfileId(undefined)).toBe('base');
    expect(toCapProfileId('ipaws')).toBe('ipaws');
  });
});

describe('profile selection is real and BLOCKING (V2)', () => {
  it('base accepts a document the IPAWS profile rejects', () => {
    const alert = actualAlert();
    expect(alertToCap(alert, { profile: 'base', areaDesc: 'Butte County' }).ok).toBe(true);

    const strict = alertToCap(alert, { profile: 'ipaws', areaDesc: 'Butte County' });
    expect(strict.ok).toBe(false);
    if (strict.ok) return;
    expect(strict.error.code).toBe('PARSE_ERROR');
    // Actionable: the message names the profile and the failing rules, not just "invalid".
    expect(strict.error.message).toContain('CAP profile "ipaws"');
    expect(strict.error.message).toContain('code');
  });

  it('accepts an IPAWS-shaped document once the operator supplies the required elements', () => {
    const res = alertToCap(actualAlert(), { profile: 'ipaws', ...IPAWS_OPTS });
    expect(res.ok, res.ok ? '' : res.error.message).toBe(true);
    if (!res.ok) return;
    expect(res.value.code).toEqual(['IPAWSv1.0']);
    expect(res.value.info[0]?.expires).toBe('2026-07-06T04:00:00Z');
    expect(res.value.info[0]?.eventCode).toEqual([{ valueName: 'SAME', value: 'FRW' }]);
  });

  it('enforces the transcribed rules one at a time (each rule is load-bearing, not decoration)', () => {
    const alert = actualAlert();
    const cases: readonly (readonly [string, Record<string, unknown>])[] = [
      ['code', { ...IPAWS_OPTS, code: ['SOMETHING_ELSE'] }],
      ['expires', { ...IPAWS_OPTS, expires: undefined }],
      ['eventCode', { ...IPAWS_OPTS, eventCode: undefined }],
      // "one and only one instance ... with a <valueName> of 'SAME'"
      ['two SAME codes', {
        ...IPAWS_OPTS,
        eventCode: [{ valueName: 'SAME', value: 'FRW' }, { valueName: 'SAME', value: 'FFW' }],
      }],
      // "using a SAME-standard three-letter value"
      ['four-letter SAME code', { ...IPAWS_OPTS, eventCode: [{ valueName: 'SAME', value: 'FRWX' }] }],
    ];
    for (const [label, opts] of cases) {
      const res = alertToCap(alert, { profile: 'ipaws', ...opts });
      expect(res.ok, `IPAWS profile should reject: ${label}`).toBe(false);
    }
  });

  it('rejects an alert with no <area> under IPAWS ("At least one <area> block MUST be present")', () => {
    const noArea = makeAlert({
      id: asId<AlertId>('alert-no-area'),
      incidentId: asId<IncidentId>('inc-1'),
      capStatus: 'ACTUAL',
      approvedBy: asId<AppUserId>('em-1'),
      category: 'Fire',
      severity: 'SEVERE',
      sentAt: SENT,
    });
    expect(alertToCap(noArea, { profile: 'base' }).ok).toBe(true);
    expect(alertToCap(noArea, { profile: 'ipaws', ...IPAWS_OPTS }).ok).toBe(false);
  });

  it('rejects a Draft document under IPAWS (status SHALL be Actual for public dissemination)', () => {
    const draft = makeAlert({
      id: asId<AlertId>('alert-draft-1'),
      incidentId: asId<IncidentId>('inc-1'),
      category: 'Fire',
      severity: 'SEVERE',
      area: RING,
      sentAt: SENT,
    });
    expect(alertToCap(draft, { profile: 'base' }).ok).toBe(true);
    const res = alertToCap(draft, { profile: 'ipaws', ...IPAWS_OPTS });
    expect(res.ok).toBe(false);
  });

  it('defaults to base when no profile is selected (byte-identical to pre-ADR-036 behaviour)', () => {
    const withDefault = alertToCap(actualAlert(), { areaDesc: 'Butte County' });
    const explicitBase = alertToCap(actualAlert(), { profile: 'base', areaDesc: 'Butte County' });
    expect(withDefault.ok).toBe(true);
    expect(explicitBase.ok).toBe(true);
    if (!withDefault.ok || !explicitBase.ok) return;
    expect(withDefault.value).toEqual(explicitBase.value);
  });
});

describe('the validator never throws and always explains (V1)', () => {
  const hostile: readonly unknown[] = [
    undefined, null, 0, '', 'a string', [], {}, { identifier: '' }, { info: null },
    { identifier: 'x', sender: 'y', sent: 'not-a-date', status: 'Actual', msgType: 'Alert', scope: 'Public' },
    { __proto__: { evil: true }, identifier: 'x' },
    { info: [{ category: ['NotACategory'], event: 'e', urgency: 'Nope', severity: 'Severe', certainty: 'Likely' }] },
  ];

  it('returns a typed failure with a non-empty message for every hostile document, on every profile', () => {
    for (const profile of CAP_PROFILE_IDS) {
      for (const doc of hostile) {
        const res = validateCapProfile(doc, profile);
        if (res.ok) continue; // `base` legitimately accepts some shapes; what matters is it never throws
        expect(res.error.code).toBe('PARSE_ERROR');
        expect(res.error.message.length).toBeGreaterThan(0);
        expect(res.error.message).toContain(`CAP profile "${profile}"`);
      }
    }
  });

  it('never returns ok for a document missing a required root element', () => {
    for (const profile of CAP_PROFILE_IDS) {
      expect(validateCapProfile({ identifier: 'x' }, profile).ok).toBe(false);
    }
  });
});
