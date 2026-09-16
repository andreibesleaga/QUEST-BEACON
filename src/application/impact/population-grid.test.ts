// BEACON — population-grid artifact tests (MW-D/D1.2; ADR-035 §1 "Grid format" + V4; finding F-27).
// Covers the format contract (row-major, south-west origin, quantized integers, consistent lattice), the
// fail-fast parser, and the FAIL-CLOSED integrity check: a grid whose SHA-256 does not match the manifest is
// refused outright, never used at reduced confidence.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { isErr, isOk } from '@/domain/shared/result.js';
import {
  canonicalGridBytes,
  parsePopulationGrid,
  populationGridCells,
  populationGridTotal,
  verifyPopulationGridIntegrity,
} from './population-grid.js';

const sha256 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');

/** A 2x2 grid of 0.5° cells over [10,20]-[11,21], 10 persons per stored unit. */
const RAW = {
  version: 1,
  id: 'test-grid',
  bbox: [10, 20, 11, 21],
  cellSizeDeg: 0.5,
  cols: 2,
  rows: 2,
  quantumPersons: 10,
  counts: [1, 2, 3, 0],
  provenance: {
    product: 'WorldPop wpgppop',
    vintage: '2020',
    resolutionLabel: '~100 m',
    licence: 'CC BY 4.0',
    disaggregation: 'native product cells area-summed to the grid cell',
    limitation: 'Modelled residential population; below one cell the value carries no information.',
  },
} as const;

function parsed(over: Record<string, unknown> = {}) {
  const res = parsePopulationGrid({ ...RAW, ...over });
  if (!isOk(res)) throw new Error(`expected ok, got ${res.error.message}`);
  return res.value;
}

describe('parsePopulationGrid', () => {
  it('accepts a well-formed grid', () => {
    const g = parsed();
    expect(g.cols * g.rows).toBe(g.counts.length);
    expect(populationGridTotal(g)).toBe(60); // (1+2+3+0) x 10
  });

  it('rejects every malformed shape with a typed error, never a partial grid', () => {
    const cases: readonly [string, unknown][] = [
      ['not an object', 42],
      ['null', null],
      ['bad version', { ...RAW, version: 2 }],
      ['empty id', { ...RAW, id: '  ' }],
      ['bbox not four numbers', { ...RAW, bbox: [1, 2, 3] }],
      ['bbox with a non-finite bound', { ...RAW, bbox: [1, 2, Number.NaN, 4] }],
      ['inverted bbox', { ...RAW, bbox: [11, 21, 10, 20] }],
      ['non-positive cellSizeDeg', { ...RAW, cellSizeDeg: 0 }],
      ['non-integer cols', { ...RAW, cols: 2.5 }],
      ['non-integer rows', { ...RAW, rows: 0 }],
      ['non-positive quantum', { ...RAW, quantumPersons: -1 }],
      ['counts not an array', { ...RAW, counts: 'x' }],
      ['counts of the wrong length', { ...RAW, counts: [1, 2, 3] }],
      ['a fractional count (not quantized)', { ...RAW, counts: [1, 2, 3, 0.5] }],
      ['a negative count', { ...RAW, counts: [1, 2, 3, -1] }],
      ['provenance missing', { ...RAW, provenance: undefined }],
      ['provenance field blank', { ...RAW, provenance: { ...RAW.provenance, licence: '' } }],
      ['lattice width disagrees with cols', { ...RAW, cols: 4, counts: [1, 2, 3, 0, 0, 0, 0, 0] }],
      ['lattice height disagrees with rows', { ...RAW, bbox: [10, 20, 11, 25] }],
    ];
    for (const [label, raw] of cases) {
      const res = parsePopulationGrid(raw);
      expect(isErr(res), label).toBe(true);
    }
  });
});

describe('populationGridCells', () => {
  it('is ROW-MAJOR from the SOUTH-WEST corner, applies the quantum, and drops empty cells', () => {
    const cells = populationGridCells(parsed());
    expect(cells).toEqual([
      { bbox: [10, 20, 10.5, 20.5], count: 10 },
      { bbox: [10.5, 20, 11, 20.5], count: 20 },
      { bbox: [10, 20.5, 10.5, 21], count: 30 },
    ]);
  });
});

describe('verifyPopulationGridIntegrity — fail-closed (ADR-035 V4, master plan §5.8)', () => {
  it('accepts the grid when the digest matches, case-insensitively and whitespace-tolerantly', () => {
    const g = parsed();
    const digest = sha256(canonicalGridBytes(g));
    expect(isOk(verifyPopulationGridIntegrity(g, digest, sha256))).toBe(true);
    expect(isOk(verifyPopulationGridIntegrity(g, `  ${digest.toUpperCase()} `, sha256))).toBe(true);
  });

  it('REFUSES the grid when any value changed — a single resident moving one cell breaks the hash', () => {
    const original = parsed();
    const digest = sha256(canonicalGridBytes(original));
    const tampered = parsed({ counts: [2, 1, 3, 0] }); // same total, different distribution
    const res = verifyPopulationGridIntegrity(tampered, digest, sha256);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.message).toContain('failed integrity check');
  });

  it('REFUSES the grid when its stated provenance changed, even with identical counts', () => {
    const digest = sha256(canonicalGridBytes(parsed()));
    const relabelled = parsed({ provenance: { ...RAW.provenance, vintage: '2015' } });
    expect(isErr(verifyPopulationGridIntegrity(relabelled, digest, sha256))).toBe(true);
  });

  it('the digest is reproducible from the PARSED grid, so a reformat of the file does not break it', () => {
    const fromCompact = parsePopulationGrid(JSON.parse(JSON.stringify(RAW)) as unknown);
    const fromPretty = parsePopulationGrid(JSON.parse(JSON.stringify(RAW, null, 4)) as unknown);
    if (!isOk(fromCompact) || !isOk(fromPretty)) throw new Error('expected ok');
    expect(sha256(canonicalGridBytes(fromCompact.value))).toBe(
      sha256(canonicalGridBytes(fromPretty.value)),
    );
  });
});
