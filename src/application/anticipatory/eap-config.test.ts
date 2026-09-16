// BEACON — EAP registry parser tests (D2; ADR-034 §1, V1). Deterministic: static config, no clock, no I/O.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InvariantViolation } from '@/domain/errors.js';
import { SHIPPED_EAPS, parseEarlyActionProtocol, shippedEap } from './eap-config.js';

const RO = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../config/eap/ro-danube-flood.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, unknown>;

const withRo = (over: Record<string, unknown>): Record<string, unknown> => ({ ...RO, ...over });

describe('the SHIPPED protocol set', () => {
  it('is parsed at import time and looked up by id, never substituted', () => {
    expect(shippedEap('ro-danube-flood')?.scope.regionId).toBe('ro');
    expect(shippedEap('us-ca-wildfire')?.hazard).toBe('WILDFIRE');
    expect(shippedEap('no-such-protocol')).toBeUndefined();
  });

  it('carries all six IFRC elements on every protocol', () => {
    for (const eap of SHIPPED_EAPS) {
      expect(eap.triggers.readiness.leadTimeHours, eap.id).toBeGreaterThan(
        eap.triggers.activation.leadTimeHours,
      );
      expect(eap.actions.length, eap.id).toBeGreaterThan(0);
      expect(eap.resourceCeiling.maxResources, eap.id).toBeGreaterThan(0);
      expect(eap.approval.fallbackRole, eap.id).not.toBe(eap.approval.authorizerRole);
      expect(eap.scope.geometry.type, eap.id).toBe('Polygon');
      expect(eap.stop.conditions.length, eap.id).toBeGreaterThan(0);
      expect(eap.stop.maxDurationHours, eap.id).toBeGreaterThan(0);
    }
  });

  it('states in EVERY protocol that its numbers came from a cached file, not a live ensemble (F-34)', () => {
    for (const eap of SHIPPED_EAPS) {
      for (const trigger of [eap.triggers.readiness, eap.triggers.activation]) {
        expect(trigger.source, eap.id).toMatch(/cached forecast file/i);
        expect(trigger.source, eap.id).toMatch(
          /no live ensemble product|queries no live ensemble/i,
        );
      }
    }
  });

  it('is frozen — the registry cannot be mutated at runtime', () => {
    expect(Object.isFrozen(SHIPPED_EAPS)).toBe(true);
  });
});

describe('parseEarlyActionProtocol fails fast', () => {
  const bad: readonly [string, unknown][] = [
    ['a non-object file', 'nope'],
    ['a null file', null],
    ['an array', []],
    ['a wrong version', withRo({ version: 2 })],
    ['a missing id', withRo({ id: '' })],
    ['a non-string label', withRo({ label: 42 })],
    ['a missing provenance', withRo({ provenance: '   ' })],
    ['a scope that is not an object', withRo({ scope: 'ro' })],
    [
      'a region that BEACON does not ship',
      withRo({ scope: { ...(RO['scope'] as object), regionId: 'atlantis' } }),
    ],
    [
      'a geometry that is not a Polygon',
      withRo({
        scope: { ...(RO['scope'] as object), geometry: { type: 'Point', coordinates: [0, 0] } },
      }),
    ],
    [
      'a geometry with an empty ring list',
      withRo({
        scope: { ...(RO['scope'] as object), geometry: { type: 'Polygon', coordinates: [] } },
      }),
    ],
    [
      'a geometry position that is not a pair',
      withRo({
        scope: {
          ...(RO['scope'] as object),
          geometry: { type: 'Polygon', coordinates: [[[1, 2, 3]]] },
        },
      }),
    ],
    [
      'a geometry coordinate that is not a number',
      withRo({
        scope: {
          ...(RO['scope'] as object),
          geometry: { type: 'Polygon', coordinates: [[['a', 2]]] },
        },
      }),
    ],
    ['triggers that are not an object', withRo({ triggers: null })],
    [
      'a trigger with a non-numeric threshold',
      withRo({ triggers: { ...triggersWith({ threshold: 'high' }) } }),
    ],
    ['actions that are empty', withRo({ actions: [] })],
    ['an action that is not an object', withRo({ actions: ['preposition'] })],
    ['a ceiling that is not an object', withRo({ resourceCeiling: 12 })],
    [
      'a ceiling with a non-numeric maximum',
      withRo({ resourceCeiling: { maxResources: 'lots', basis: 'x'.repeat(20) } }),
    ],
    [
      'a maxByKind that is not an object',
      withRo({ resourceCeiling: { ...(RO['resourceCeiling'] as object), maxByKind: 4 } }),
    ],
    ['an approval that is not an object', withRo({ approval: 'EM' })],
    ['a stop block that is missing', withRo({ stop: undefined })],
    [
      'a stop block with no conditions array',
      withRo({ stop: { ...(RO['stop'] as object), conditions: [] } }),
    ],
    [
      'a stop condition that is not an object',
      withRo({ stop: { ...(RO['stop'] as object), conditions: ['stop-it'] } }),
    ],
    [
      'a stop condition with a blank label',
      withRo({ stop: { ...(RO['stop'] as object), conditions: [{ id: 'x-y', label: '' }] } }),
    ],
  ];

  function triggersWith(over: Record<string, unknown>): Record<string, unknown> {
    const triggers = RO['triggers'] as Record<string, Record<string, unknown>>;
    return {
      readiness: { ...triggers['readiness'], ...over },
      activation: triggers['activation'] as object,
    };
  }

  for (const [what, cfg] of bad) {
    it(`rejects ${what}`, () => {
      expect(() => parseEarlyActionProtocol(cfg)).toThrow(/Invalid config\/eap/);
    });
  }

  it('delegates structural invariants to the domain factory (one definition of a valid EAP)', () => {
    const triggers = RO['triggers'] as Record<string, Record<string, unknown>>;
    expect(() =>
      parseEarlyActionProtocol(
        withRo({
          triggers: {
            readiness: triggers['readiness'],
            activation: { ...triggers['activation'], leadTimeHours: 999 },
          },
        }),
      ),
    ).toThrow(InvariantViolation);
  });

  it('round-trips the shipped Romania protocol unchanged', () => {
    expect(parseEarlyActionProtocol(RO)).toEqual(shippedEap('ro-danube-flood'));
  });

  it('accepts a protocol with no per-kind ceiling', () => {
    const parsed = parseEarlyActionProtocol(
      withRo({ resourceCeiling: { maxResources: 3, basis: 'illustrative demonstration ceiling' } }),
    );
    expect(parsed.resourceCeiling.maxByKind).toBeUndefined();
  });
});
