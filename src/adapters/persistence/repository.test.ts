// BEACON — RepositoryPort wrapper tests (E3·T-114/T-116). Proves the contract holds WITHOUT a live DB:
// every op returns a typed Result and a thrown driver/mapper error never escapes as an exception.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { apiCodeForError, statusForError } from '@/adapters/channels/http/error-mapping.js';
import { makeRepository, toDomainError, tryResult } from './repository';
import type { RepositoryOps } from './repository';

interface Thing {
  readonly id: string;
  readonly n: number;
}

function opsThatSucceed(): RepositoryOps<Thing, string> {
  const store = new Map<string, Thing>();
  return {
    getById: (id) => Promise.resolve(store.get(id) ?? null),
    upsert: (e) => {
      store.set(e.id, e);
      return Promise.resolve(e);
    },
    remove: (id) => {
      store.delete(id);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...store.values()]),
  };
}

function opsThatThrow(error: unknown): RepositoryOps<Thing, string> {
  const boom = () => Promise.reject(error);
  return { getById: boom, upsert: boom, remove: boom, list: boom };
}

describe('makeRepository — happy path', () => {
  it('save then getById returns ok(entity)', async () => {
    const repo = makeRepository(opsThatSucceed());
    const saved = await repo.save({ id: 'a', n: 1 });
    expect(isOk(saved)).toBe(true);
    const got = await repo.getById('a');
    expect(got).toEqual({ ok: true, value: { id: 'a', n: 1 } });
  });

  it('getById of a missing id returns ok(null)', async () => {
    const repo = makeRepository(opsThatSucceed());
    expect(await repo.getById('missing')).toEqual({ ok: true, value: null });
  });
});

describe('makeRepository — failure never throws upstream', () => {
  it('a thrown driver error becomes err(DomainError), not an exception', async () => {
    const repo = makeRepository(opsThatThrow(new Error('connection reset')));
    const r = await repo.getById('a');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error).toBeInstanceOf(DomainError);
  });

  it('preserves a mapper-thrown DomainError verbatim', async () => {
    const original = new DomainError('INVARIANT_VIOLATION', 'bad row');
    const repo = makeRepository(opsThatThrow(original));
    const r = await repo.save({ id: 'a', n: 1 });
    expect(isErr(r) && r.error).toBe(original);
  });
});

describe('toDomainError — Postgres SQLSTATE mapping', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['23505', 'CONFLICT'],
    ['23503', 'CONFLICT'],
    ['23514', 'INVARIANT_VIOLATION'],
    ['23502', 'INVARIANT_VIOLATION'],
    ['08006', 'PARSE_ERROR'],
    ['42P01', 'INTERNAL_ERROR'],
    ['42703', 'INTERNAL_ERROR'],
  ];
  it.each(cases)('SQLSTATE %s -> %s', (code, expected) => {
    const err = toDomainError(Object.assign(new Error('pg'), { code }));
    expect(err.code).toBe(expected);
  });

  it('non-pg values fall back to PARSE_ERROR', () => {
    expect(toDomainError('weird').code).toBe('PARSE_ERROR');
  });
});

// A missing migration is the SERVER's fault. Asserting the SQLSTATE mapping alone would not have caught the
// original defect — 42P01 was already mapped, just onto a code the HTTP channel renders as "you sent bad
// data". What matters is the status and the public code a caller actually sees, so both are pinned here.
describe('schema faults surface as 5xx, caller-input faults stay 4xx', () => {
  const relationMissing = Object.assign(new Error('relation "shelter" does not exist'), {
    code: '42P01',
  });
  const columnMissing = Object.assign(new Error('column "occupancy" does not exist'), {
    code: '42703',
  });

  it.each([relationMissing, columnMissing])(
    'an unmigrated schema is a 500 INTERNAL_ERROR',
    (cause) => {
      const err = toDomainError(cause);
      expect(statusForError(err.code)).toBe(500);
      expect(apiCodeForError(err.code)).toBe('INTERNAL_ERROR');
    },
  );

  it('a malformed value from the CALLER is still a 400 VALIDATION_ERROR', () => {
    // 22P02 invalid_text_representation — e.g. a non-uuid id in the request path.
    const err = toDomainError(
      Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }),
    );
    expect(statusForError(err.code)).toBe(400);
    expect(apiCodeForError(err.code)).toBe('VALIDATION_ERROR');
  });

  it('a DB constraint the caller violated is still a 4xx (409/422), not a server fault', () => {
    const conflict = toDomainError(Object.assign(new Error('duplicate key'), { code: '23505' }));
    const invariant = toDomainError(Object.assign(new Error('check violation'), { code: '23514' }));
    expect(statusForError(conflict.code)).toBe(409);
    expect(statusForError(invariant.code)).toBe(422);
  });
});

describe('tryResult', () => {
  it('wraps a resolving fn as ok', async () => {
    expect(await tryResult(() => Promise.resolve(7))).toEqual({ ok: true, value: 7 });
  });
});
