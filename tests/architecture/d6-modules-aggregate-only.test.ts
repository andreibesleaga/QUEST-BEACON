// BEACON — the five D6 aggregate MODULES held to the guard D6.0 already built (ADR-035 §4; FR-D6-1…FR-D6-5;
// closes F-142's "whichever lane builds FR-D6-2…FR-D6-5 must (a)…(d)" and F-143).
//
// This file adds NO new denylist, NO new validator and NO second guard. It imports the one guard
// (src/domain/shared/aggregate-only.ts) and the one export-time gate
// (src/application/privacy/incident-summary-guard.ts) and points them at the five real modules — the F-141
// lesson (two independently-built denylists) applied by not repeating it.
//
// What it proves, beyond the per-module tests:
//   1. the five D6 schemas exist and are the five ADR-035 §4 names — no module shipped without one;
//   2. (MOVED — F-176) the recursive `additionalProperties:false` walk this file used to own now lives, in
//      one strictly stronger form, in tests/architecture/d6-no-pii.test.ts Layer B; see section 2 below;
//   3. every schema's declared property set EQUALS its factory's maximal-output key set — the drift guard
//      that makes "the schema Layer B walks" and "the object Layer C walks" provably the same shape;
//   4. every schema `enum` equals the TypeScript union beside it (config/locales.json ↔ LOCALE_IDS idiom);
//   5. Layer C over all five factories' MAXIMAL output, in one place, against the shared denylist.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  findPersonIdentifyingRuntimeKeys,
  findPersonIdentifyingSchemaKeys,
} from '@/domain/shared/aggregate-only.js';
import { SERVED_MODES, type SourceRecord } from '@/domain/source-record.js';
import { asId, type SourceId } from '@/domain/value-objects/ids.js';
import {
  makeVolunteerTeamFields,
  TEAM_AVAILABILITY,
} from '@/application/aggregate/volunteer-team.js';
import { makeSupplyFields, SUPPLY_UNITS } from '@/application/aggregate/supplies.js';
import {
  buildReunificationLinks,
  REUNIFICATION_RUNGS,
} from '@/application/aggregate/reunification-links.js';
import { makeCasualtyTally } from '@/application/aggregate/casualty-tally.js';
import { buildIncidentSummary } from '@/application/aggregate/incident-summary.js';

const SCHEMAS_DIR = resolve(process.cwd(), 'schemas');
const AT = '2026-07-05T22:00:00.000Z'; // fixed clock — no wall-clock dependence anywhere in this file

function readSchema(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf8')) as Record<string, unknown>;
}

function unwrapOrThrow<T>(res: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!res.ok) throw new Error(`factory failed: ${JSON.stringify(res.error)}`);
  return res.value;
}

// ── The five modules' MAXIMAL output (every optional field supplied) — ADR-035 §4 Layer C ────────────────
const SOURCE: SourceRecord = {
  id: asId<SourceId>('src-1'),
  source: 'NASA FIRMS',
  adapter: 'firms-adapter',
  fetchedAt: '2026-07-05T18:30:00.000Z',
  license: 'NASA open data',
  mode: 'CACHED',
};

const maximalCasualtyTally = unwrapOrThrow(
  makeCasualtyTally({ reportId: 'rep-1', count: 2, asOf: AT }),
);

interface D6Module {
  readonly fr: string;
  readonly schemaFile: string;
  /** Maximal factory output, or the union of a builder's emitted objects. */
  readonly maximal: unknown;
  /** Every key the maximal output declares, union-ed across list-returning builders. */
  readonly keys: readonly string[];
}

function keysOf(value: unknown): readonly string[] {
  const objects = Array.isArray(value) ? value : [value];
  return [...new Set(objects.flatMap((o) => Object.keys(o as object)))].sort();
}

const MODULES: readonly D6Module[] = (() => {
  const volunteerTeam = unwrapOrThrow(
    makeVolunteerTeamFields({
      callsign: 'TEAM ALPHA 3',
      headcount: 6,
      skills: ['chainsaw', 'swiftwater'],
      availability: 'COMMITTED',
    }),
  );
  const supply = unwrapOrThrow(makeSupplyFields({ quantity: 240, unit: 'CASE', expiresAt: AT }));
  const links = buildReunificationLinks('us-ca'); // a region with BOTH rungs ⇒ the union includes `iso`
  const summary = unwrapOrThrow(
    buildIncidentSummary({
      incidentId: 'inc-1',
      regionId: 'us-ca',
      generatedAt: AT,
      closedAt: '2026-07-05T21:00:00.000Z',
      alertsIssued: 4,
      tasksCompleted: 7,
      tasksTotal: 9,
      sheltersOpen: 2,
      shelterOccupancyPeak: 118,
      shelterCapacityTotal: 200,
      affectedAreaKm2: 42.5,
      casualtyTally: maximalCasualtyTally,
      provenance: [SOURCE],
    }),
  );
  return [
    {
      fr: 'FR-D6-1 volunteer teams',
      schemaFile: 'd6-volunteer-team.schema.json',
      maximal: volunteerTeam,
      keys: keysOf(volunteerTeam),
    },
    {
      fr: 'FR-D6-2 supplies',
      schemaFile: 'd6-supply.schema.json',
      maximal: supply,
      keys: keysOf(supply),
    },
    {
      fr: 'FR-D6-3 reunification link-out',
      schemaFile: 'd6-reunification-link.schema.json',
      maximal: links,
      keys: keysOf(links),
    },
    {
      fr: 'FR-D6-4 incident summary export',
      schemaFile: 'd6-incident-summary.schema.json',
      maximal: summary,
      keys: keysOf(summary),
    },
    {
      fr: 'FR-D6-5 casualty tally',
      schemaFile: 'd6-casualty-tally.schema.json',
      maximal: maximalCasualtyTally,
      keys: keysOf(maximalCasualtyTally),
    },
  ];
})();

// =============================================================================================================
// 1. All five modules have a schema, and Layer B's glob picks every one of them up with zero guard changes
// =============================================================================================================
describe('the five D6 schemas', () => {
  it('exist — one per FR-D6-1…FR-D6-5 (F-142 said only one of the five did)', () => {
    const onDisk = readdirSync(SCHEMAS_DIR)
      .filter((f) => /^d6-.*\.schema\.json$/.test(f))
      .sort();
    expect(onDisk).toEqual(MODULES.map((m) => m.schemaFile).sort());
    expect(onDisk).toHaveLength(5);
  });

  it('carry a $id matching their filename (so a schema cannot be silently renamed out of the glob)', () => {
    for (const { schemaFile } of MODULES) {
      expect(readSchema(schemaFile).$id).toBe(`https://beacon.local/schemas/${schemaFile}`);
    }
  });

  it('pass the SHARED Layer B walk — the same function tests/architecture/d6-no-pii.test.ts calls', () => {
    for (const { schemaFile } of MODULES) {
      expect(findPersonIdentifyingSchemaKeys(readSchema(schemaFile))).toEqual([]);
    }
  });

  // F-175. Layer B's walker deliberately does NOT resolve `$ref`. That is a TRAP, not a bug: a future author
  // who reaches for the obvious refactor — replacing the inlined casualty tally with a `$ref` — would move
  // those property names OUT of the walk entirely, and Layer B would go on reporting [] while the PII door
  // stood open. Nothing would fail; the guard would simply stop guarding, silently. So the ban is asserted
  // here rather than left as a comment nobody reads at the moment they need it. If `$ref` is ever genuinely
  // needed, teach the WALKER to resolve it FIRST, then delete this test — in that order, never the reverse.
  it('contain NO $ref anywhere — Layer B does not resolve refs, so a ref is a silent hole in the walk', () => {
    for (const { schemaFile } of MODULES) {
      const raw = readFileSync(join(SCHEMAS_DIR, schemaFile), 'utf8');
      expect(raw, `${schemaFile} must not use $ref — see F-175`).not.toMatch(/"\$ref"/);
    }
  });
});

// =============================================================================================================
// 2. additionalProperties:false — MOVED, not deleted (F-176)
// =============================================================================================================
// This file used to carry its own recursive `additionalProperties:false` walk because the sibling
// tests/architecture/d6-no-pii.test.ts asserted the document ROOT only. Two overlapping checks in two files
// is the same defect class this file's own header warns about (F-141: two independently-built denylists), so
// MW-E converged them: ONE check now lives in the sibling's Layer B, and it is strictly stronger than the
// union of the two it replaces — it walks every object subschema INCLUDING the root, over the whole
// `d6-*.schema.json` glob rather than these five named files, and it recognises an object subschema by
// `type:'object'` OR the presence of `properties`. Its planted-violation proof moved with it and grew the
// root and typeless cases. Nothing is asserted here anymore, deliberately: re-adding a local copy would
// re-open F-176. Test 1 above (the glob equals exactly these five files) is what ties the sibling's
// glob-driven check back to these five modules.

// =============================================================================================================
// 3. Schema ↔ factory drift guard: the shape Layer B walks IS the shape Layer C walks
// =============================================================================================================
describe('schema property set === factory maximal-output key set', () => {
  it.each(MODULES.map((m) => [m.fr, m] as const))('%s', (_fr, module) => {
    const properties = readSchema(module.schemaFile)['properties'] as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([...module.keys]);
  });
});

// =============================================================================================================
// 4. Schema enum === TypeScript union (the config/locales.json ↔ LOCALE_IDS drift-guard idiom)
// =============================================================================================================
describe('every D6 enum has exactly one definition, drift-guarded against its schema', () => {
  const cases: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
    [
      'TEAM_AVAILABILITY',
      TEAM_AVAILABILITY,
      (
        readSchema('d6-volunteer-team.schema.json')['properties'] as Record<
          string,
          { enum: string[] }
        >
      )['availability']!.enum,
    ],
    [
      'SUPPLY_UNITS',
      SUPPLY_UNITS,
      (readSchema('d6-supply.schema.json')['properties'] as Record<string, { enum: string[] }>)[
        'unit'
      ]!.enum,
    ],
    [
      'REUNIFICATION_RUNGS',
      REUNIFICATION_RUNGS,
      (
        readSchema('d6-reunification-link.schema.json')['properties'] as Record<
          string,
          { enum: string[] }
        >
      )['rung']!.enum,
    ],
    [
      'SERVED_MODES (reused, not re-declared, by the export provenance rows)',
      SERVED_MODES,
      (
        (
          readSchema('d6-incident-summary.schema.json')['properties'] as Record<
            string,
            { items: { properties: Record<string, { enum: string[] }> } }
          >
        )['provenance']!.items.properties as Record<string, { enum: string[] }>
      )['mode']!.enum,
    ],
  ];

  it.each(cases)('%s', (_name, tsUnion, schemaEnum) => {
    expect([...tsUnion].sort()).toEqual([...schemaEnum].sort());
  });
});

// =============================================================================================================
// 5. The casualty tally is INLINED into the export schema (Layer B does not resolve $ref) — drift-guarded
// =============================================================================================================
describe('the inlined casualty tally in the export schema cannot drift from its own schema', () => {
  const tallySchema = readSchema('d6-casualty-tally.schema.json');
  const inlined = (
    readSchema('d6-incident-summary.schema.json')['properties'] as Record<
      string,
      Record<string, unknown>
    >
  )['casualtyTally']!;

  it('declares the same property set', () => {
    expect(Object.keys(inlined['properties'] as object).sort()).toEqual(
      Object.keys(tallySchema['properties'] as object).sort(),
    );
  });

  it('pins the same mandatory caveat consts', () => {
    const a = tallySchema['properties'] as Record<string, { const: unknown }>;
    const b = inlined['properties'] as Record<string, { const: unknown }>;
    expect(b['label']!.const).toBe(a['label']!.const);
    expect(b['authoritative']!.const).toBe(a['authoritative']!.const);
  });

  it('requires the same fields', () => {
    expect(inlined['required']).toEqual(tallySchema['required']);
  });
});

// =============================================================================================================
// 6. Layer C — one runtime walk over all five factories' MAXIMAL output
// =============================================================================================================
describe('Layer C — maximal factory output of all five D6 modules', () => {
  it.each(MODULES.map((m) => [m.fr, m] as const))(
    '%s has no person-identifying key at runtime',
    (_fr, module) => {
      expect(findPersonIdentifyingRuntimeKeys(module.maximal)).toEqual([]);
    },
  );

  it("the walk is not vacuous: every module's maximal output actually has keys to walk", () => {
    for (const module of MODULES) expect(module.keys.length).toBeGreaterThan(0);
  });

  it("a planted key in ANY module's maximal output is caught, at whatever depth it appears", () => {
    const planted = MODULES.map((m) => ({
      ...(Array.isArray(m.maximal) ? { list: m.maximal } : (m.maximal as object)),
      reporterId: 'u-1',
    }));
    const hits = findPersonIdentifyingRuntimeKeys(planted);
    expect(hits).toEqual(MODULES.map((_m, i) => `[${i}].reporterId`));
  });
});
