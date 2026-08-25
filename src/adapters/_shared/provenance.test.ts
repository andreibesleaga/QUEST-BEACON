// BEACON — Provenance stamper tests (E4·T-139; F1). Every stamped record is a SourceRecord that VALIDATES
// against source-ref.schema.json; a record without provenance fails. Also covers freshness computation.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { CanonicalRecord } from './contract.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import { buildFetchResult, newestFreshness, stampProvenance } from './provenance.js';

const schema = JSON.parse(readFileSync('schemas/source-ref.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSourceRecord = ajv.compile(schema); // root $ref → sourceRecord

const FIXED_ID = '22222222-2222-4222-8222-222222222222';

describe('stampProvenance (F1)', () => {
  it('produces a SourceRecord that validates against source-ref.schema.json', () => {
    const rec = stampProvenance({
      adapterId: 'firms',
      source: 'NASA FIRMS',
      license: 'Public Domain (NASA / US Gov)',
      mode: 'LIVE',
      fetchedAt: '2026-07-05T21:18:00Z',
      id: FIXED_ID,
    });
    expect(validateSourceRecord(rec)).toBe(true);
    expect(rec.adapter).toBe('firms');
    expect(rec.mode).toBe('LIVE');
  });

  it('rejects a record missing provenance fields (grounding is structural)', () => {
    expect(validateSourceRecord({ source: 'NASA FIRMS' })).toBe(false);
  });

  it('generates a uuid id when none is injected', () => {
    const rec = stampProvenance({
      adapterId: 'firms',
      source: 'NASA FIRMS',
      license: 'Public Domain',
      mode: 'MOCK',
      fetchedAt: '2026-07-05T21:18:00Z',
    });
    expect(validateSourceRecord(rec)).toBe(true); // uuid format check inside schema
  });
});

describe('freshness', () => {
  const rec = (fetchedAt: string): CanonicalRecord<number> => ({
    entity: 1,
    provenance: { id: asId<SourceId>(FIXED_ID), source: 'S', adapter: 's', fetchedAt, license: 'PD', mode: 'LIVE' },
  });

  it('newestFreshness returns the max fetchedAt', () => {
    const out = newestFreshness([rec('2026-07-05T10:00:00Z'), rec('2026-07-05T12:00:00Z')], 'fallback');
    expect(out).toBe('2026-07-05T12:00:00Z');
  });

  it('newestFreshness uses the fallback when there are no records', () => {
    expect(newestFreshness([], '2026-07-05T09:00:00Z')).toBe('2026-07-05T09:00:00Z');
  });

  it('buildFetchResult assembles records + mode + degraded + freshness', () => {
    const fr = buildFetchResult([rec('2026-07-05T11:00:00Z')], 'MOCK', true, 'x');
    expect(fr).toMatchObject({ mode: 'MOCK', degraded: true, freshness: '2026-07-05T11:00:00Z' });
  });
});
