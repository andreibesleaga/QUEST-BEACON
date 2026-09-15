// BEACON — shelter status board + CSV export tests (MW-D/D5.3; FR-D4-3, FEV-22, V14 aggregate-only clause).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeShelter, SHELTER_STATUSES } from '@/domain/shelter.js';
import type { MakeShelterInput, Shelter } from '@/domain/shelter.js';
import { SERVED_MODES } from '@/domain/source-record.js';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { CSV_RECORD_SEPARATOR } from './csv.js';
import {
  SHELTER_CSV_COLUMNS,
  buildShelterStatusBoard,
  shelterProvenanceClaim,
  shelterStatusCsv,
  type ShelterStatusBoard,
  type ShelterStatusProvenance,
} from './shelter-status.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateBoard = ajv.compile(
  JSON.parse(readFileSync('schemas/d5-shelter-status.schema.json', 'utf8')) as object,
);

const FIXTURE = JSON.parse(readFileSync('fixtures/coordination/shelters.json', 'utf8')) as {
  shelters: readonly MakeShelterInput[];
};

// The fixture goes through the REAL domain factory: every capacity/occupancy invariant holds on it.
const SHELTERS: readonly Shelter[] = FIXTURE.shelters.map((s) => makeShelter(s));

const SEEDED: ShelterStatusProvenance = {
  mode: 'MOCK',
  sourceLabel: 'hand-seeded demo shelters (no shelter source adapter exists — F-35)',
  asOf: '2026-07-05T22:00:00Z',
};

function board(provenance: ShelterStatusProvenance = SEEDED): ShelterStatusBoard {
  const res = buildShelterStatusBoard({ shelters: SHELTERS, provenance });
  if (!res.ok) throw res.error;
  return res.value;
}

describe('buildShelterStatusBoard', () => {
  it('projects one row per shelter, ordered by id, with available and utilization derived', () => {
    expect(board().rows).toEqual([
      {
        shelterId: 'shelter-annex-standby',
        status: 'OPEN',
        capacity: 0,
        occupancy: 0,
        available: 0,
        utilization: 0,
      },
      {
        shelterId: 'shelter-civic-center',
        status: 'OPEN',
        capacity: 250,
        occupancy: 90,
        available: 160,
        utilization: 0.36,
      },
      {
        shelterId: 'shelter-north-high',
        status: 'FULL',
        capacity: 120,
        occupancy: 120,
        available: 0,
        utilization: 1,
      },
      // A CLOSED shelter still reports its PHYSICAL spare space; `totals.availableOpen` is what excludes it.
      {
        shelterId: 'shelter-riverside-gym',
        status: 'CLOSED',
        capacity: 80,
        occupancy: 0,
        available: 80,
        utilization: 0,
      },
    ]);
  });

  it('totals capacity/occupancy and counts every status key, zeros included', () => {
    expect(board().totals).toEqual({
      shelters: 4,
      capacity: 450,
      occupancy: 210,
      available: 240,
      availableOpen: 160,
      utilization: 0.47,
      byStatus: { OPEN: 2, FULL: 1, CLOSED: 1 },
    });
    expect(Object.keys(board().totals.byStatus).sort()).toEqual([...SHELTER_STATUSES].sort());
  });

  it('rounds the utilization ratio to 2 dp — no float residue on a labelled figure (the F-96 lesson)', () => {
    // 210/450 = 0.4666… — the raw quotient must never reach the wire.
    expect(210 / 450).not.toBe(0.47);
    expect(board().totals.utilization).toBe(0.47);
    expect(String(board().totals.utilization)).toBe('0.47');
  });

  it('never divides by a zero capacity', () => {
    const zeroCapacity = board().rows.find((r) => r.capacity === 0);
    expect(zeroCapacity?.utilization).toBe(0);
    const emptyBoard = buildShelterStatusBoard({ shelters: [], provenance: SEEDED });
    expect(emptyBoard.ok && emptyBoard.value.totals).toEqual({
      shelters: 0,
      capacity: 0,
      occupancy: 0,
      available: 0,
      availableOpen: 0,
      utilization: 0,
      byStatus: { OPEN: 0, FULL: 0, CLOSED: 0 },
    });
  });

  it('separates PHYSICAL spare space from OPEN intake capacity (a closed hall is not intake capacity)', () => {
    const totals = board().totals;
    // 160 (civic-center, OPEN) + 0 (annex, OPEN, zero capacity) — the CLOSED gym's 80 and the FULL
    // school's 0 are excluded. `available` keeps the physical total so neither figure is hidden.
    expect(totals.availableOpen).toBe(160);
    expect(totals.available).toBe(240);
    expect(totals.available - totals.availableOpen).toBe(80);
  });

  it('rejects a provenance mode outside the domain vocabulary', () => {
    const res = buildShelterStatusBoard({
      shelters: SHELTERS,
      provenance: { ...SEEDED, mode: 'SEEDED' as 'MOCK' },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PARSE_ERROR');
    expect(res.error.message).toContain(SERVED_MODES.join('|'));
  });

  it('is deterministic', () => {
    expect(board()).toEqual(board());
  });

  it('validates against schemas/d5-shelter-status.schema.json', () => {
    expect(validateBoard(board()), JSON.stringify(validateBoard.errors)).toBe(true);
  });
});

describe('provenance honesty (Art. XVI — never claim LIVE for seeded data)', () => {
  it('says MOCK/seeded for seeded rows and does not contain the word "Live"', () => {
    const claim = board().provenanceClaim;
    expect(claim).toMatch(/MOCK\/seeded shelter data/);
    expect(claim).toMatch(/NOT an operational feed/);
    expect(claim).not.toMatch(/^Live/);
    expect(claim).toContain('as of 2026-07-05T22:00:00Z');
  });

  it('labels CACHED as not-current, and only LIVE claims live', () => {
    expect(shelterProvenanceClaim({ ...SEEDED, mode: 'CACHED' })).toMatch(
      /CACHED shelter data .* not a current reading/,
    );
    expect(
      shelterProvenanceClaim({ ...SEEDED, mode: 'LIVE', sourceLabel: 'FEMA Open Shelters' }),
    ).toBe('Live shelter data from FEMA Open Shelters (as of 2026-07-05T22:00:00Z).');
  });

  it('covers every mode in the domain vocabulary with a distinct claim', () => {
    const claims = SERVED_MODES.map((mode) => shelterProvenanceClaim({ ...SEEDED, mode }));
    expect(new Set(claims).size).toBe(SERVED_MODES.length);
  });
});

describe('shelterStatusCsv (the export boundary)', () => {
  it('writes RFC 4180 CSV with the declared columns, header first', () => {
    const res = shelterStatusCsv(board());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const records = res.value.split(CSV_RECORD_SEPARATOR).filter((r) => r !== '');
    expect(records[0]).toBe('shelter_id,status,capacity,occupancy,available,utilization');
    expect(records[1]).toBe('shelter-annex-standby,OPEN,0,0,0,0');
    expect(records[4]).toBe('shelter-riverside-gym,CLOSED,80,0,80,0');
    expect(records).toHaveLength(5); // header + 4 shelters
    expect(SHELTER_CSV_COLUMNS.map((c) => c.header)).toEqual([
      'shelter_id',
      'status',
      'capacity',
      'occupancy',
      'available',
      'utilization',
    ]);
  });

  it('exports counts only — no geometry, no occupant, no person (Art. XIV)', () => {
    const res = shelterStatusCsv(board());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).not.toMatch(/Point|coordinates|-118\./);
    expect(findPersonIdentifyingRuntimeKeys(board().rows)).toEqual([]);
  });

  it('FAILS CLOSED when a person-identifying key reaches the rows (Layer D re-check at export)', () => {
    // Simulates the case Layer A cannot see: a value that acquired a key its declared type never mentions
    // (a spread, a mapper, a DB row). The guard walks the ACTUAL object graph immediately before export.
    const contaminated = {
      ...board(),
      rows: [...board().rows, { ...board().rows[0]!, contactName: 'J. Doe' }],
    } as ShelterStatusBoard;
    const res = shelterStatusCsv(contaminated);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('CONFLICT');
    expect(res.error.message).toMatch(/person-identifying field\(s\) present: \[4\]\.contactName/);
    // Terminal: no document at all, never a redacted one.
    expect(res).not.toHaveProperty('value');
  });
});
