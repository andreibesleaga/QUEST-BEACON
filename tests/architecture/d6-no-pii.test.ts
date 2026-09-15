// BEACON — D6 "no person-identifying field" structural fitness function (ADR-035 §4; FR-D6-6/FU-18/FUW-8;
// acceptance test 6, docs/requirements/EARS_FINAL_VERSION.md:342). Beside the existing structural fitness
// function tests/architecture/f9-domain-purity.test.ts, same idiom: walk real project state, not a mock.
//
// Verifies the four layers TASKS-FINAL-VERSION.md's D6.0 brief names EXACTLY:
//   A. tsc-time  — AggregateOnly<T> rejects a type carrying a person-identifying key (Gate 2).
//   B. schema    — a recursive walk of schemas/d6-*.schema.json (additionalProperties:false) against the
//                  exact + substring denylists, with a written-justification allowlist.
//   C. runtime   — an Object.keys() walk over maximal (every optional field populated) factory-shaped
//                  output — catches a spread/mapper Layer A cannot see.
//   D. export    — see src/application/privacy/incident-summary-guard.test.ts (Layer D lives beside the
//                  guard it tests, mirroring alert-sink.test.ts next to alert-sink.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AggregateOnly } from '@/domain/shared/aggregate-only.js';
import {
  PERSON_IDENTIFYING_KEYS,
  isPersonIdentifyingKey,
  findPersonIdentifyingSchemaKeys,
  findPersonIdentifyingRuntimeKeys,
} from '@/domain/shared/aggregate-only.js';

const SCHEMAS_DIR = resolve(process.cwd(), 'schemas');

// =============================================================================================================
// Layer A — tsc-time (Gate 2)
// =============================================================================================================
describe('Layer A — AggregateOnly<T> fails tsc for a person-identifying key', () => {
  interface CleanFields {
    readonly headcount: number;
    readonly skills: readonly string[];
  }
  interface DirtyFields {
    readonly headcount: number;
    readonly contactName: string; // exactly the kind of key the D6 boundary forbids
  }

  it('passes a clean aggregate-only type through unchanged', () => {
    const clean: AggregateOnly<CleanFields> = { headcount: 3, skills: ['chainsaw'] };
    expect(clean.headcount).toBe(3);
    expect(clean.skills).toEqual(['chainsaw']);
  });

  it(
    'rejects a type carrying a person-identifying key. THIS DIRECTIVE IS ITSELF THE GUARANTEE: if ' +
      'AggregateOnly<> is ever weakened so the assignment below type-checks, tsc turns the now-unnecessary ' +
      '\'@ts-expect-error\' into an "unused directive" ERROR (Gate 2) — the guard cannot silently rot. Same ' +
      'idiom as src/adapters/alerting/alert-sink.test.ts:156 (EmittableAlert).',
    () => {
      // @ts-expect-error — DirtyFields.contactName ∈ PERSON_IDENTIFYING_KEYS, so AggregateOnly<DirtyFields>
      // resolves to the error-carrying branch (`{ __PII_FIELD_FOUND__: 'contactName' }`), not DirtyFields
      // itself. THIS IS THE GUARANTEE — remove this directive locally and `tsc --noEmit` fails right here.
      const dirty: AggregateOnly<DirtyFields> = { headcount: 1, contactName: 'Jane Doe' };
      // The compiler is deliberately overridden above; prove the VALUE still carries the key the type says
      // is impossible — exactly why Layers B/C/D exist independently of the type system. A raw object
      // literal, an `as` cast, or a spread bypasses Layer A the same way this directive does.
      expect((dirty as unknown as DirtyFields).contactName).toBe('Jane Doe');
    },
  );

  it('PERSON_IDENTIFYING_KEYS is the one shared denylist every layer checks against', () => {
    expect(PERSON_IDENTIFYING_KEYS).toContain('contactName');
    expect(PERSON_IDENTIFYING_KEYS).toContain('reporterId');
    expect(new Set(PERSON_IDENTIFYING_KEYS).size).toBe(PERSON_IDENTIFYING_KEYS.length); // no duplicates
    expect(PERSON_IDENTIFYING_KEYS.length).toBeGreaterThan(30);
  });

  it(
    'F-347 Layer A: a D6 type declaring a PRECISE LOCATION is a tsc error. Same self-proving directive as ' +
      'the contactName case above — weaken the denylist and the unused @ts-expect-error fails Gate 2 here.',
    () => {
      interface LocatedFields {
        readonly headcount: number;
        readonly geomPrecise: {
          readonly type: 'Point';
          readonly coordinates: readonly [number, number];
        };
      }
      // prettier-ignore
      // @ts-expect-error — geomPrecise ∈ PERSON_IDENTIFYING_KEYS since F-347 (Art. XIV names precise location
      // as the flagship class), so AggregateOnly<LocatedFields> resolves to the error-carrying branch.
      const located: AggregateOnly<LocatedFields> = { headcount: 1, geomPrecise: { type: 'Point', coordinates: [0, 0] } };
      expect((located as unknown as LocatedFields).headcount).toBe(1);
    },
  );

  it('F-347: the denylist now covers location / device+channel handle / image, not just names and ids', () => {
    // The four keys the E3 audit demonstrated walking straight through — all real key names in this repo
    // (geomPrecise: intel-tables.ts:33 · chatId: subscriber-registry.ts:12).
    for (const key of ['geomPrecise', 'latitude', 'chatId', 'photo']) {
      expect(isPersonIdentifyingKey(key)).toBe(true);
    }
    // …and the near-miss net catches the prefixed/suffixed forms a mapper actually produces.
    for (const key of [
      'reporterGeomPrecise',
      'centroidLatitude',
      'telegramChatId',
      'sosPhotoRef',
      'precisePoint',
    ]) {
      expect(isPersonIdentifyingKey(key)).toBe(true);
    }
    // NOT a ban on geography or on imagery: aggregate place facts and satellite-product references stay
    // usable, which is what keeps the denylist honest rather than allowlisted into uselessness.
    for (const key of [
      'regionId',
      'affectedAreaKm2',
      'geohashPrefix',
      'elevationM',
      'latencyMs',
      'translationKey',
      'relatedIncidents',
      'viewUrl',
    ]) {
      expect(isPersonIdentifyingKey(key)).toBe(false);
    }
  });

  it('isPersonIdentifyingKey: exact denylist, substring denylist, and allowlist exemption', () => {
    expect(isPersonIdentifyingKey('email')).toBe(true); // exact
    expect(isPersonIdentifyingKey('reporterPhone')).toBe(true); // substring ("phone" and "reporter")
    expect(isPersonIdentifyingKey('headcount')).toBe(false); // clean
    // 'regionName' is a BENIGN collision (a place name, not a person's) — the exact shape the allowlist
    // exists for: substring "name" hits it, so it is denied WITHOUT an allowlist entry…
    expect(isPersonIdentifyingKey('regionName')).toBe(true);
    // …and exempted only once a caller argues it in writing at the call site (ADR-035 §4 Layer B).
    expect(isPersonIdentifyingKey('regionName', new Set(['regionName']))).toBe(false);
    expect(isPersonIdentifyingKey('email', new Set(['regionName']))).toBe(true); // allowlist is per-key, not global
  });
});

// =============================================================================================================
// Layer B — schemas/d6-*.schema.json recursive property walk
// =============================================================================================================
// Every ALLOWLIST entry MUST carry its written reason HERE — this is where a benign collision is argued in
// the open, never assumed (ADR-035 §4). Currently empty: d6-volunteer-team.schema.json needs no exemption.
const JUSTIFIED_COLLISIONS: ReadonlySet<string> = new Set([
  // Example of the FORM a future entry takes (left commented — nothing is exempted today):
  //   'orgId', // an ORGANISATION id, not a person — ADR-035 §4 Layer B worked example
]);

function d6SchemaFiles(): string[] {
  return readdirSync(SCHEMAS_DIR)
    .filter((f) => /^d6-.*\.schema\.json$/.test(f))
    .map((f) => join(SCHEMAS_DIR, f));
}

function readJsonSchema(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('Layer B — schemas/d6-*.schema.json recursive property walk', () => {
  const files = d6SchemaFiles();

  it('finds at least one D6 schema to walk (a guard that checks nothing proves nothing)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // ── F-176: the ONE additionalProperties check in this repo ────────────────────────────────────────────
  // It replaces TWO overlapping checks: this file's former ROOT-ONLY assertion
  // (`expect(schema.additionalProperties).toBe(false)`) and the RECURSIVE walk that
  // tests/architecture/d6-modules-aggregate-only.test.ts added in its own file rather than editing this
  // sibling. The recursive one survives, and the converged check is strictly STRONGER than their union:
  //   · it walks EVERY object subschema INCLUDING the root, so the root-only assertion is subsumed;
  //   · it runs over the whole `d6-*.schema.json` GLOB, not just the five named modules, so a NEW D6 schema
  //     is covered the day it lands, with no edit here;
  //   · it recognises an object subschema by `type:'object'` OR the mere presence of `properties` — the old
  //     recursive walk keyed on `type` alone, so a subschema that declared fields without a `type` (legal
  //     JSON-Schema, and exactly what a hand-edit produces) could be widened without either check noticing.
  // A widenable subschema is REPORTED BY PATH rather than asserted true/false, so a failure names the field.
  function widenableObjectPaths(node: unknown, path = '$'): readonly string[] {
    if (Array.isArray(node))
      return node.flatMap((n, i) => widenableObjectPaths(n, `${path}[${i}]`));
    if (typeof node !== 'object' || node === null) return [];
    const record = node as Record<string, unknown>;
    const isObjectSchema = record['type'] === 'object' || 'properties' in record;
    const here = isObjectSchema && record['additionalProperties'] !== false ? [path] : [];
    return [
      ...here,
      ...Object.entries(record).flatMap(([k, v]) => widenableObjectPaths(v, `${path}.${k}`)),
    ];
  }

  it.each(files.map((f) => [f.slice(SCHEMAS_DIR.length + 1), f] as const))(
    '%s declares additionalProperties:false on EVERY object subschema, root included (F-176)',
    (_name, file) => {
      expect(widenableObjectPaths(readJsonSchema(file))).toEqual([]);
    },
  );

  it('F-176 the converged check DOES fail on a planted widenable subschema — root, nested, and typeless', () => {
    // (a) the ROOT case the old root-only assertion caught…
    expect(widenableObjectPaths({ type: 'object', properties: { a: { type: 'string' } } })).toEqual(
      ['$'],
    );
    // (b) …the NESTED case only the recursive walk caught — a clean root hiding a widenable child…
    expect(
      widenableObjectPaths({
        type: 'object',
        additionalProperties: false,
        properties: { nested: { type: 'object', properties: { a: { type: 'string' } } } },
      }),
    ).toEqual(['$.properties.nested']);
    // (c) …and the case NEITHER of the two old checks caught: an object subschema with no `type` at all,
    // plus one inside an array-valued keyword. Delete the `'properties' in record` clause and (c) regresses.
    expect(
      widenableObjectPaths({
        type: 'object',
        additionalProperties: false,
        properties: {
          typeless: { properties: { a: { type: 'string' } } },
          variants: {
            anyOf: [{ type: 'object', additionalProperties: false }, { properties: { b: {} } }],
          },
        },
      }),
    ).toEqual(['$.properties.typeless', '$.properties.variants.anyOf[1]']);
  });

  it('F-176 the converged check passes a fully-closed shape (it is not simply always-failing)', () => {
    expect(
      widenableObjectPaths({
        type: 'object',
        additionalProperties: false,
        properties: { nested: { type: 'object', additionalProperties: false, properties: {} } },
      }),
    ).toEqual([]);
  });

  it.each(files.map((f) => [f.slice(SCHEMAS_DIR.length + 1), f] as const))(
    '%s has no person-identifying property, exact or substring, outside the justified allowlist',
    (_name, file) => {
      const hits = findPersonIdentifyingSchemaKeys(readJsonSchema(file), {
        allowlist: JUSTIFIED_COLLISIONS,
      });
      expect(hits).toEqual([]);
    },
  );

  it('the walker DOES fail on a PLANTED violation (proves the guard is real, not decorative)', () => {
    const violating = {
      type: 'object',
      additionalProperties: false,
      properties: {
        headcount: { type: 'integer' },
        contactName: { type: 'string' }, // PLANTED — exact denylist hit
        reporterPhone: { type: 'string' }, // PLANTED — substring denylist hit ("phone" + "reporter")
        nested: {
          type: 'object',
          properties: { donorAmount: { type: 'string' } }, // PLANTED — nested substring hit
        },
        variants: { anyOf: [{ properties: { ssn: { type: 'string' } } }] }, // PLANTED — inside anyOf
        rows: { items: { properties: { patientId: { type: 'string' } } } }, // PLANTED — inside items
      },
    };
    const hits = findPersonIdentifyingSchemaKeys(violating);
    expect(hits).toEqual(
      expect.arrayContaining([
        'contactName',
        'reporterPhone',
        'nested.donorAmount',
        'variants.ssn',
        'rows.patientId',
      ]),
    );
    expect(hits.length).toBe(5);
  });

  it('the justified allowlist exempts exactly what it names, and nothing else', () => {
    // 'regionName' is a benign collision (substring "name"; it names a REGION, not a person).
    const shape = {
      properties: { regionName: { type: 'string' }, contactName: { type: 'string' } },
    };
    expect(findPersonIdentifyingSchemaKeys(shape, { allowlist: new Set(['regionName']) })).toEqual([
      'contactName',
    ]);
    expect(findPersonIdentifyingSchemaKeys(shape)).toEqual(
      expect.arrayContaining(['regionName', 'contactName']), // no allowlist ⇒ regionName also hits
    );
  });

  it('walks $defs/definitions and patternProperties value schemas too', () => {
    const shape = {
      $defs: { person: { properties: { fullName: { type: 'string' } } } },
      definitions: { legacy: { properties: { ssn: { type: 'string' } } } },
      patternProperties: { '^x-': { properties: { email: { type: 'string' } } } },
    };
    const hits = findPersonIdentifyingSchemaKeys(shape);
    expect(hits).toEqual(
      expect.arrayContaining(['$defs.person.fullName', 'definitions.legacy.ssn', 'email']),
    );
  });

  it('ignores non-object schema fragments instead of throwing (booleans, null, undefined)', () => {
    expect(findPersonIdentifyingSchemaKeys(true)).toEqual([]);
    expect(findPersonIdentifyingSchemaKeys(null)).toEqual([]);
    expect(findPersonIdentifyingSchemaKeys(undefined)).toEqual([]);
  });

  it('walks tuple-form `items` (an array of schemas), not just single-schema `items`', () => {
    const tupleShape = {
      items: [
        { properties: { ssn: { type: 'string' } } },
        { properties: { headcount: { type: 'integer' } } },
      ],
    };
    expect(findPersonIdentifyingSchemaKeys(tupleShape)).toEqual(['ssn']);
  });
});

// =============================================================================================================
// Layer C — runtime Object.keys() walk over maximal factory-shaped output
// =============================================================================================================
describe('Layer C — runtime key enumeration over maximal (every optional field set) output', () => {
  // Stands in for "a D6 factory's output with every optional field supplied" (ADR-035 §4 Layer C). No D6
  // factory exists yet — D6.0 builds the guard mechanism, not the D6 modules — so the maximal shape used
  // here is exactly schemas/d6-volunteer-team.schema.json's declared fields plus the pre-existing Resource
  // fields (src/domain/resource.ts) it would extend, which is precisely what a spread/mapper could plausibly
  // produce once FR-D6-1 lands.
  function maximalCleanTeamOutput(): Record<string, unknown> {
    return {
      id: 'res-team-1',
      kind: 'TEAM',
      status: 'AVAILABLE',
      orgId: 'org-1',
      callsign: 'TEAM ALPHA 3',
      headcount: 6,
      skills: ['chainsaw', 'swiftwater'],
      availability: 'AVAILABLE',
    };
  }

  it('the clean maximal shape has no person-identifying key', () => {
    expect(findPersonIdentifyingRuntimeKeys(maximalCleanTeamOutput())).toEqual([]);
  });

  it('catches a key a SPREAD introduces that no declared type mentions (the exact failure Layer A cannot see)', () => {
    const spreadPollutedByAMapper = {
      ...maximalCleanTeamOutput(),
      ...{ contactName: 'Jane Doe' }, // simulates a mapper/spread widening the object at runtime
    };
    expect(findPersonIdentifyingRuntimeKeys(spreadPollutedByAMapper)).toContain('contactName');
  });

  it('catches a nested/array violation (a DB row shape, or a mapper over a list)', () => {
    const nested = {
      ...maximalCleanTeamOutput(),
      members: [{ headcount: 1 }, { headcount: 1, reporterId: 'u-1' }], // PLANTED, one level into an array
    };
    expect(findPersonIdentifyingRuntimeKeys(nested)).toContain('members[1].reporterId');
  });

  it('is not fooled by non-plain-object values (arrays of primitives, null, Date)', () => {
    expect(findPersonIdentifyingRuntimeKeys(['a', 'b'])).toEqual([]);
    expect(findPersonIdentifyingRuntimeKeys(null)).toEqual([]);
    expect(findPersonIdentifyingRuntimeKeys(42)).toEqual([]);
  });

  it('honours a caller-supplied allowlist at runtime the same way Layer B does', () => {
    const withRegionName = { ...maximalCleanTeamOutput(), regionName: 'central-valley' }; // benign collision
    expect(findPersonIdentifyingRuntimeKeys(withRegionName)).toContain('regionName'); // denied by default…
    expect(
      findPersonIdentifyingRuntimeKeys(withRegionName, { allowlist: new Set(['regionName']) }),
    ).toEqual([]); // …exempted once a caller argues it, same mechanism as Layer B
  });
});

// =============================================================================================================
// V12 — the RECORDED RESIDUAL RISK: structure cannot stop a human typing a person's name into a free-text
// `callsign`. This is NOT a fifth layer of the PII guard — it is a DIFFERENT, narrower mitigation (a schema
// `pattern`/`maxLength`) for a gap the four layers above cannot close, because "callsign" itself is not a
// person-identifying KEY (it is a legitimate field name for a unit designator) — the risk is in the VALUE a
// human types into it. Accepted and documented per ADR-035 §4, not claimed solved.
// =============================================================================================================
describe('V12 — callsign residual risk is MITIGATED (pattern/maxLength), not eliminated', () => {
  const schema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'd6-volunteer-team.schema.json'), 'utf8'),
  ) as { properties: { callsign: { pattern: string; maxLength: number } } };
  const callsignPattern = new RegExp(schema.properties.callsign.pattern);

  it("rejects a person's name typed into callsign (the exact residual-risk example, ADR-035 §4)", () => {
    expect(callsignPattern.test('John Smith')).toBe(false);
    expect(callsignPattern.test('jane doe')).toBe(false);
  });

  it('accepts the shape the field is FOR: an uppercase unit designator', () => {
    expect(callsignPattern.test('TEAM ALPHA 3')).toBe(true);
    expect(callsignPattern.test('ENGINE-7')).toBe(true);
  });

  it('maxLength bounds the field regardless of pattern (defense in depth against a long free-text name)', () => {
    expect(schema.properties.callsign.maxLength).toBe(24);
    expect('TEAM ALPHA 3'.length).toBeLessThanOrEqual(schema.properties.callsign.maxLength);
  });

  it('the mitigation is honestly RECORDED, not silently assumed — the schema description states the residual risk', () => {
    const description = (schema.properties.callsign as unknown as { description: string })
      .description;
    expect(description).toMatch(/RESIDUAL RISK/);
    expect(description).toMatch(/does not eliminate|MITIGATE/);
  });
});
