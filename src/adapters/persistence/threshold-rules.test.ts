// BEACON — threshold rules read back from the table (ADR-044 follow-up). The one translation that matters:
// the row scopes a rule by the region's uuid, the evaluator scopes by the config id.
import { describe, expect, it } from 'vitest';
import type { Db } from './client';
import { loadThresholdRules } from './threshold-rules';

type Row = { rule: Record<string, unknown>; regionDomainId: string | null };

function fakeDb(rows: readonly Row[]): { db: Db; joins: unknown[] } {
  const joins: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({
        leftJoin: (table: unknown, on: unknown) => {
          joins.push({ table, on });
          return Promise.resolve(rows);
        },
      }),
    }),
  };
  return { db: db as unknown as Db, joins };
}

const row = (
  id: string,
  scope: string | null,
  regionDomainId: string | null,
  extra: Record<string, unknown> = {},
): Row => ({
  rule: {
    id,
    target: 'HAZARD_BUFFER',
    operator: 'enters',
    value: '2000m',
    scope,
    hysteresis: null,
    cooldown: null,
    createdAt: new Date('2026-07-05T22:00:00Z'),
    updatedAt: new Date('2026-07-05T22:00:00Z'),
    ...extra,
  },
  regionDomainId,
});

describe('loadThresholdRules', () => {
  it('scopes each rule by the region CONFIG id the evaluator speaks, not the row uuid', async () => {
    const { db, joins } = fakeDb([row('r-ca', '5f1c1e2a-0000-4000-8000-000000000001', 'us-ca')]);
    const rules = await loadThresholdRules(db);
    expect(rules).toHaveLength(1);
    expect(String(rules[0]!.id)).toBe('r-ca');
    expect(String(rules[0]!.scope)).toBe('us-ca');
    expect(rules[0]!.target).toBe('HAZARD_BUFFER');
    expect(rules[0]!.value).toBe('2000m');
    expect(joins).toHaveLength(1); // one region join, never a query per rule
  });

  it('keeps the uuid scope when the region row carries no natural key (a rule nobody can attribute)', async () => {
    const { db } = fakeDb([row('r-old', '5f1c1e2a-0000-4000-8000-000000000002', null)]);
    const [rule] = await loadThresholdRules(db);
    expect(String(rule!.scope)).toBe('5f1c1e2a-0000-4000-8000-000000000002');
  });

  it('carries hysteresis and cooldown as numbers, and an unscoped rule as unscoped', async () => {
    const { db } = fakeDb([row('r-any', null, null, { hysteresis: '0.5', cooldown: '600' })]);
    const [rule] = await loadThresholdRules(db);
    expect(rule!.scope).toBeUndefined();
    expect(rule!.hysteresis).toBe(0.5);
    expect(rule!.cooldown).toBe(600);
  });

  it('an empty table reads as no rules (the composition then evaluates nothing, not the file)', async () => {
    const { db } = fakeDb([]);
    expect(await loadThresholdRules(db)).toEqual([]);
  });
});
