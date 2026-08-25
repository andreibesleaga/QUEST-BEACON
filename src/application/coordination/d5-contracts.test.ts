// BEACON — D5 CONTRACT FITNESS TESTS (MW-D/D5; ADR-035 §4 Layer B, ADR-036 §7, Art. XIV).
//
// These are the D5 analogue of the D6 guard's schema walk (`tests/architecture/d6-no-pii.test.ts`, which
// walks `schemas/d6-*.schema.json` and is owned by the D6 lane). They REUSE that lane's shared primitives —
// `findPersonIdentifyingSchemaKeys` / `isPersonIdentifyingKey` from `src/domain/shared/aggregate-only.ts` —
// rather than building a second denylist, which is the whole point of finding F-141.
//
// Three properties are pinned here:
//   (A) NO PERSON-IDENTIFYING KEY may appear anywhere in any `schemas/d5-*.schema.json`;
//   (B) every object in those schemas is `additionalProperties:false`, so an unexpected field is a
//       validation failure rather than a silently-carried one;
//   (C) every CLOSED VOCABULARY in those schemas equals the TypeScript union it serialises. This is the
//       anti-drift half: a schema enum is a hand-written copy of a union, and copies drift (F-24/F-140).
//       The equality is asserted against the IMPORTED constants, so widening a union without widening its
//       schema (or vice-versa) fails this test the moment it happens.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { findPersonIdentifyingSchemaKeys } from '@/domain/shared/aggregate-only.js';
import { RESOURCE_TASK_STATUSES } from '@/domain/resource-task.js';
import { SHELTER_STATUSES } from '@/domain/shelter.js';
import { SOURCE_MODES } from '@/domain/source-record.js';
import { PUBLIC_REPORT_STATUSES } from '@/domain/public-report.js';
import {
  DAMAGE_REPORT_CATEGORIES,
  DAMAGE_SEVERITIES,
  NEED_KINDS,
} from '@/domain/damage-assessment.js';
import { OVERLAY_PRODUCT_TYPES } from '@/domain/damage-overlay.js';
import { D5_FEATURE_FLAGS } from './coordination-flags.js';
import { RUMOR_FLAG_REASONS } from './rumor-board.js';
import { MUTUAL_AID_CONFLICT_REASONS } from './mutual-aid-board.js';
import { EMS_REJECTION_REASONS } from './ems-overlay.js';

const D5_SCHEMA_FILES = readdirSync('schemas')
  .filter((f) => f.startsWith('d5-') && f.endsWith('.schema.json'))
  .sort();

function schemaOf(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`schemas/${file}`, 'utf8')) as Record<string, unknown>;
}

/** Every `properties`-bearing object in the document that is NOT `additionalProperties:false`. */
function openObjects(node: unknown, path = '(root)'): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => openObjects(n, `${path}[${i}]`));
  if (typeof node !== 'object' || node === null) return [];
  const obj = node as Record<string, unknown>;
  const here = 'properties' in obj && obj.additionalProperties !== false ? [path] : [];
  return [...here, ...Object.entries(obj).flatMap(([k, v]) => openObjects(v, `${path}.${k}`))];
}

/** Collect every `enum` array in the document, keyed by its dotted path. */
function enums(node: unknown, path = '', out: Record<string, readonly string[]> = {}): Record<string, readonly string[]> {
  if (Array.isArray(node)) {
    node.forEach((n, i) => enums(n, `${path}[${i}]`, out));
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'enum' && Array.isArray(value)) out[path] = value as readonly string[];
    else enums(value, path === '' ? key : `${path}.${key}`, out);
  }
  return out;
}

describe('D5 schema surface', () => {
  it('ships one schema per feature-flagged surface', () => {
    expect(D5_SCHEMA_FILES).toEqual([
      'd5-damage-assessment.schema.json',
      'd5-ems-overlay.schema.json',
      'd5-mutual-aid-board.schema.json',
      'd5-rumor-board.schema.json',
      'd5-shelter-status.schema.json',
    ]);
    expect(D5_SCHEMA_FILES).toHaveLength(D5_FEATURE_FLAGS.length);
  });

  it.each(D5_SCHEMA_FILES)('%s declares no person-identifying key anywhere (Layer B, Art. XIV)', (file) => {
    // No allowlist: D5 needs no argued exemption. If a future field does, the reason belongs HERE, in
    // writing, at the call site — `isPersonIdentifyingKey` never grants one silently.
    expect(findPersonIdentifyingSchemaKeys(schemaOf(file))).toEqual([]);
  });

  it.each(D5_SCHEMA_FILES)('%s closes every object with additionalProperties:false', (file) => {
    expect(openObjects(schemaOf(file))).toEqual([]);
  });
});

describe('D5 closed vocabularies equal the TypeScript unions they serialise', () => {
  const expected: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['d5-mutual-aid-board.schema.json', '$defs.taskStatus', RESOURCE_TASK_STATUSES],
    ['d5-mutual-aid-board.schema.json', '$defs.conflict.properties.reason', MUTUAL_AID_CONFLICT_REASONS],
    ['d5-shelter-status.schema.json', '$defs.shelterStatus', SHELTER_STATUSES],
    ['d5-shelter-status.schema.json', '$defs.provenance.properties.mode', SOURCE_MODES],
    ['d5-rumor-board.schema.json', '$defs.rumorRow.properties.reason', RUMOR_FLAG_REASONS],
    ['d5-ems-overlay.schema.json', '$defs.productView.properties.productType', OVERLAY_PRODUCT_TYPES],
    ['d5-ems-overlay.schema.json', '$defs.rejected.properties.reason', EMS_REJECTION_REASONS],
    ['d5-damage-assessment.schema.json', '$defs.counts.properties.worstSeverity', DAMAGE_SEVERITIES],
  ];

  it.each(expected)('%s %s', (file, path, union) => {
    expect(enums(schemaOf(file))[path]).toEqual([...union]);
  });

  it('the damage buckets and count keys ARE the domain vocabularies, key for key', () => {
    const schema = schemaOf('d5-damage-assessment.schema.json') as {
      properties: { byTriageStatus: { required: string[] } };
      $defs: {
        counts: {
          properties: {
            byCategory: { required: string[] };
            bySeverity: { required: string[] };
            byNeed: { required: string[] };
          };
        };
      };
    };
    expect(schema.properties.byTriageStatus.required).toEqual([...PUBLIC_REPORT_STATUSES]);
    expect(schema.$defs.counts.properties.byCategory.required).toEqual([...DAMAGE_REPORT_CATEGORIES]);
    expect(schema.$defs.counts.properties.bySeverity.required).toEqual([...DAMAGE_SEVERITIES]);
    expect(schema.$defs.counts.properties.byNeed.required).toEqual([...NEED_KINDS]);
  });

  it('the mutual-aid status-count keys ARE the resource-task lifecycle', () => {
    const schema = schemaOf('d5-mutual-aid-board.schema.json') as {
      $defs: { statusCounts: { required: string[] } };
    };
    expect(schema.$defs.statusCounts.required).toEqual([...RESOURCE_TASK_STATUSES]);
  });

  it('the shelter status-count keys ARE the shelter statuses', () => {
    const schema = schemaOf('d5-shelter-status.schema.json') as {
      $defs: { totals: { properties: { byStatus: { required: string[] } } } };
    };
    expect(schema.$defs.totals.properties.byStatus.required).toEqual([...SHELTER_STATUSES]);
  });
});

describe('the D5 barrel', () => {
  it('re-exports every public symbol of the five surfaces (a missing export is a silently unusable module)', async () => {
    const barrel = await import('./index.js');
    expect(Object.keys(barrel).sort()).toEqual(
      [
        // gate
        'D5_FEATURE_FLAGS', 'DEFAULT_COORDINATION_FLAGS', 'gateCoordinationFeature', 'isCoordinationFeatureEnabled',
        // D5.1 rumor
        'RUMOR_BOARD_CAVEAT', 'RUMOR_FLAG_REASONS', 'buildRumorBoard', 'isFlaggedFact',
        // D5.2 mutual aid
        'MUTUAL_AID_BOARD_CAVEAT', 'MUTUAL_AID_CONFLICT_REASONS', 'buildMutualAidBoard',
        // export primitive
        'CSV_RECORD_SEPARATOR', 'csvCell', 'toCsv',
        // D5.3 shelter
        'SHELTER_CSV_COLUMNS', 'buildShelterStatusBoard', 'shelterProvenanceClaim', 'shelterStatusCsv',
        // D5.4 damage/needs
        'DAMAGE_ASSESSMENT_CAVEAT', 'UNVERIFIED_LABEL', 'assessDamage',
        // D5.5 EMS overlay
        'EMS_OVERLAY_CAVEAT', 'EMS_REJECTION_REASONS', 'buildEmsOverlay',
      ].sort(),
    );
  });

  it('is NOT re-exported from src/application/index.ts — nothing here is wired into a running surface yet', () => {
    // Honest scope statement (finding F-152), asserted rather than asserted-in-prose: if a future lane wires
    // a D5 panel it must add the export deliberately, and this test is where that decision gets recorded.
    expect(readFileSync('src/application/index.ts', 'utf8')).not.toContain('coordination');
  });
});

describe('POSITIVE CONTROL — the walk really reaches behind an intra-document $ref (finding F-175)', () => {
  // F-175 (raised against the D6 schemas): `findPersonIdentifyingSchemaKeys` does NOT resolve `$ref`, so a
  // property moved behind a reference could silently leave the walk. Every D5 `$ref` is an INTRA-document
  // `#/$defs/…` pointer, and the walker descends `$defs` independently of any reference to it
  // (`walkSchemaNamedDefs`, aggregate-only.ts) — so D5's property names ARE walked. That is a claim about
  // someone else's code, so it is EXERCISED here rather than asserted in prose: this control fails the day
  // the walker stops descending `$defs`, which is precisely the day the D5 schemas would need inlining.
  const shapedLikeD5 = {
    type: 'object',
    additionalProperties: false,
    required: ['rows'],
    properties: { rows: { type: 'array', items: { $ref: '#/$defs/row' } } },
    $defs: {
      row: {
        type: 'object',
        additionalProperties: false,
        properties: { shelterId: { type: 'string' }, contactEmail: { type: 'string' } },
      },
    },
  };

  it('finds a person-identifying key that appears ONLY inside $defs', () => {
    expect(findPersonIdentifyingSchemaKeys(shapedLikeD5)).toEqual(['$defs.row.contactEmail']);
  });

  it('and the real D5 schemas keep every property name inside walked constructs', () => {
    // properties / patternProperties / items / allOf / anyOf / oneOf / $defs / definitions are the walked
    // constructs; a D5 schema that introduced a property under anything else would be invisible to Layer B.
    const WALKED = new Set([
      'properties', 'patternProperties', 'items', 'allOf', 'anyOf', 'oneOf', '$defs', 'definitions',
    ]);
    for (const file of D5_SCHEMA_FILES) {
      const text = readFileSync(`schemas/${file}`, 'utf8');
      for (const construct of ['prefixItems', 'if', 'then', 'else', 'not', 'dependentSchemas', 'contains']) {
        expect(text.includes(`"${construct}":`), `${file} uses un-walked construct ${construct}`).toBe(false);
        expect(WALKED.has(construct)).toBe(false);
      }
      expect(text.includes('"$ref": "http')).toBe(false); // no cross-document reference
    }
  });
});
