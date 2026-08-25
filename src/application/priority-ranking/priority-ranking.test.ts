import { describe, it, expect } from 'vitest';
import { asId } from '@/domain/value-objects/ids.js';
import type { InfrastructureNodeId } from '@/domain/value-objects/ids.js';
import {
  rankPriorities,
  scoreNode,
  DEFAULT_PRIORITY_CONFIG,
  type PriorityInput,
  type PriorityConfig,
} from './priority-ranking.js';

function input(over: Partial<PriorityInput> = {}): PriorityInput {
  return {
    nodeId: asId<InfrastructureNodeId>('n1'),
    nodeType: 'HOSPITAL',
    insideHazard: false,
    bufferM: 1000,
    exposedPopulation: 0,
    offline: false,
    ...over,
  };
}

describe('scoreNode', () => {
  it('applies the documented 0.45/0.35/0.20 weights on known inputs', () => {
    // distance 500 of 1000 → proximity 0.5; HOSPITAL base 1.0, online → vulnerability 1.0;
    // population 5000/10000 → 0.5. score = 0.45*0.5 + 0.35*1.0 + 0.20*0.5 = 0.675
    const s = scoreNode(input({ distanceM: 500, exposedPopulation: 5000 }));
    expect(s.proximity).toBeCloseTo(0.5, 10);
    expect(s.vulnerability).toBeCloseTo(1.0, 10);
    expect(s.population).toBeCloseTo(0.5, 10);
    expect(s.score).toBeCloseTo(0.675, 10);
  });

  it('clamps proximity to 1.0 when the node is inside the hazard', () => {
    const s = scoreNode(input({ insideHazard: true, distanceM: 999 }));
    expect(s.proximity).toBe(1.0);
  });

  it('treats a missing distance as proximity 0 when not inside', () => {
    expect(scoreNode(input()).proximity).toBe(0);
  });

  it('treats a non-positive buffer as proximity 0', () => {
    expect(scoreNode(input({ distanceM: 10, bufferM: 0 })).proximity).toBe(0);
  });

  it('applies the OFFLINE vulnerability boost, clamped to 1', () => {
    // HOSPITAL base 1.0 × 1.5 boost = 1.5 → clamped to 1.0
    expect(scoreNode(input({ offline: true })).vulnerability).toBe(1.0);
    // ROAD base 0.3 × 1.5 = 0.45 (not clamped)
    expect(scoreNode(input({ nodeType: 'ROAD', offline: true })).vulnerability).toBeCloseTo(0.45, 10);
  });

  it('scores an unknown node-type weight as 0 vulnerability', () => {
    const s = scoreNode(input({ nodeType: 'MYSTERY' as PriorityInput['nodeType'] }));
    expect(s.vulnerability).toBe(0);
  });

  it('caps population contribution at the basis and yields 0 for a zero basis', () => {
    expect(scoreNode(input({ exposedPopulation: 999999 })).population).toBe(1);
    const zeroBasis: PriorityConfig = {
      ...DEFAULT_PRIORITY_CONFIG,
      vulnerability: { ...DEFAULT_PRIORITY_CONFIG.vulnerability, populationBasis: 0 },
    };
    expect(scoreNode(input({ exposedPopulation: 100 }), zeroBasis).population).toBe(0);
  });
});

describe('rankPriorities', () => {
  it('orders by descending score', () => {
    const ranked = rankPriorities([
      input({ nodeId: asId<InfrastructureNodeId>('low'), nodeType: 'ROAD' }),
      input({ nodeId: asId<InfrastructureNodeId>('high'), insideHazard: true }),
    ]);
    expect(ranked.map((r) => String(r.nodeId))).toEqual(['high', 'low']);
  });

  it('breaks equal-score ties by stable key (node id) ascending', () => {
    const ranked = rankPriorities([
      input({ nodeId: asId<InfrastructureNodeId>('zeta') }),
      input({ nodeId: asId<InfrastructureNodeId>('alpha') }),
      input({ nodeId: asId<InfrastructureNodeId>('mike') }),
    ]);
    expect(ranked.map((r) => String(r.nodeId))).toEqual(['alpha', 'mike', 'zeta']);
  });

  it('keeps every blended score within [0,1] regardless of input permutation (property)', () => {
    const types: PriorityInput['nodeType'][] = ['HOSPITAL', 'ROAD', 'POWER', 'CELL', 'SHELTER'];
    for (let i = 0; i < 200; i++) {
      const s = scoreNode(
        input({
          nodeType: types[i % types.length]!,
          insideHazard: i % 2 === 0,
          distanceM: (i * 37) % 2000,
          bufferM: 1000,
          exposedPopulation: (i * 123) % 20000,
          offline: i % 3 === 0,
        }),
      );
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it('never crashes on an empty input list', () => {
    expect(rankPriorities([])).toEqual([]);
  });

  it('sorts an out-of-order equal-score pair so the greater key follows (tieBreakKey > arm)', () => {
    // Equal score, input pre-ordered high-key first → comparator hits the `a.tieBreakKey > b` (→1) arm.
    const ranked = rankPriorities([
      input({ nodeId: asId<InfrastructureNodeId>('b') }),
      input({ nodeId: asId<InfrastructureNodeId>('a') }),
    ]);
    expect(ranked.map((r) => String(r.nodeId))).toEqual(['a', 'b']);
  });

  it('treats an equal-score, equal-key pair as order-neutral (tieBreakKey equal → 0 arm)', () => {
    // Two nodes with identical id AND score → comparator returns 0 (the tie-break equal arm).
    const dup = asId<InfrastructureNodeId>('dup');
    const ranked = rankPriorities([input({ nodeId: dup }), input({ nodeId: dup })]);
    expect(ranked).toHaveLength(2);
    expect(ranked.every((r) => String(r.nodeId) === 'dup')).toBe(true);
    expect(ranked[0]!.score).toBe(ranked[1]!.score);
  });
});
