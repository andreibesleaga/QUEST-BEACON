import { describe, it, expect } from 'vitest';
import {
  makeInfrastructureNode,
  transitionInfraNode,
  canTransitionInfraNode,
  INFRA_NODE_TYPES,
} from './infrastructure-node.js';
import { InvariantViolation, InvalidTransition } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { InfrastructureNodeId } from './value-objects/ids.js';
import type { Geometry } from './value-objects/geo.js';

const id = asId<InfrastructureNodeId>('66666666-6666-6666-6666-666666666666');
const geom: Geometry = { type: 'Point', coordinates: [-100, 40] };

describe('makeInfrastructureNode', () => {
  it('builds a valid node and defaults status to ONLINE', () => {
    expect(makeInfrastructureNode({ id, type: 'HOSPITAL', geom }).status).toBe('ONLINE');
  });

  it('accepts every schema type', () => {
    for (const type of INFRA_NODE_TYPES) {
      expect(makeInfrastructureNode({ id, type, geom }).type).toBe(type);
    }
  });

  it('rejects a type outside the enum', () => {
    // @ts-expect-error invalid enum
    expect(() => makeInfrastructureNode({ id, type: 'AIRPORT', geom })).toThrow(InvariantViolation);
  });

  it('rejects an invalid status', () => {
    // @ts-expect-error invalid enum
    expect(() => makeInfrastructureNode({ id, type: 'POWER', geom, status: 'DEGRADED' })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a malformed geom', () => {
    expect(() =>
      makeInfrastructureNode({ id, type: 'POWER', geom: { type: 'Blob' } as unknown as Geometry }),
    ).toThrow(InvariantViolation);
  });
});

describe('infrastructure node state machine (DOMAIN_MODEL §4)', () => {
  it('allows ONLINE -> AT_RISK -> OFFLINE and recovery to ONLINE', () => {
    const n = makeInfrastructureNode({ id, type: 'POWER', geom });
    const atRisk = transitionInfraNode(n, 'AT_RISK');
    expect(atRisk.status).toBe('AT_RISK');
    const offline = transitionInfraNode(atRisk, 'OFFLINE');
    expect(offline.status).toBe('OFFLINE');
    expect(transitionInfraNode(offline, 'ONLINE').status).toBe('ONLINE');
    expect(transitionInfraNode(atRisk, 'ONLINE').status).toBe('ONLINE');
  });

  it('rejects the illegal direct ONLINE -> OFFLINE hop', () => {
    const n = makeInfrastructureNode({ id, type: 'POWER', geom });
    expect(() => transitionInfraNode(n, 'OFFLINE')).toThrow(InvalidTransition);
    expect(canTransitionInfraNode('ONLINE', 'OFFLINE')).toBe(false);
    expect(canTransitionInfraNode('OFFLINE', 'AT_RISK')).toBe(false);
  });
});
