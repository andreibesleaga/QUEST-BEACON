// BEACON — structural fitness function: THE CASUALTY TALLY'S LABEL TRAVELS WITH THE NUMBER (F-174).
//
// ADR-035 §4 FR-D6-5 requires the caveat "unverified — not authoritative" at EVERY render and export site,
// "asserted by a test that enumerates those sites". The requirement is deliberately NOT "the label exists
// somewhere" — a constant nobody reads is a decoration. The guarantee this file enforces is:
//
//     THERE IS NO PATH IN THIS REPOSITORY THAT CAN SHOW THE CASUALTY NUMBER WITHOUT ITS LABEL.
//
// It is enforced in two directions, because either alone is escapable:
//
//   • DISCOVERY (the part that makes it a guard rather than a checklist). Every non-test source file under
//     src/ and app/ that so much as mentions "casualty" is discovered by a filesystem walk and must appear in
//     the enumeration below with a declared MECHANISM by which the label reaches the reader. Add a new panel,
//     a new CSV column, a new mapper — anything — and this test fails until the site is declared. A hand-
//     written list of known sites would pass forever while a new site quietly renders a bare number.
//
//   • MECHANISM EVIDENCE. Each declared mechanism has a FIXED evidence pattern (not a per-site escape hatch),
//     checked against the file's real text. Declaring a rendering site as "mentions the concept only" fails,
//     because that mechanism additionally requires the file to contain NO count-bearing reference at all.
//
// Plus behavioural arms proving the two stamping factories really do attach the caveat, and a conformance arm
// pinning the domain-side shape to the application value object across the layer boundary the domain may not
// import across.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import casualtyTallySchema from '../../schemas/d6-casualty-tally.schema.json';
import { asId } from '@/domain/value-objects/ids.js';
import type { PublicReportId, SourceId } from '@/domain/value-objects/ids.js';
import {
  makePublicReport,
  CASUALTY_TALLY_CAVEAT,
  CASUALTY_TALLY_AUTHORITATIVE,
  type ReportCasualtyTally,
} from '@/domain/public-report.js';
import {
  makeCasualtyTally,
  CASUALTY_TALLY_LABEL,
  type CasualtyTally,
} from '@/application/aggregate/casualty-tally.js';
import { buildIncidentSummary } from '@/application/aggregate/incident-summary.js';
import { makeSourceRecord } from '@/domain/source-record.js';

const REPO = process.cwd();
const SCANNED_ROOTS = ['src', 'app'] as const;
const AT = '2026-07-05T22:00:00Z'; // the project's fixed clock — this suite reads no wall clock

// =============================================================================================================
// The scan
// =============================================================================================================

/** Any mention of the concept, however spelled. Deliberately broad: the burden is on a new site to declare
 *  itself, not on this regex to anticipate how someone will name their variable. */
const MENTIONS_CASUALTY = /casualt/i;

/** A reference that can put the NUMBER in front of someone (or into a row/column/payload). */
const COUNT_BEARING =
  /casualtyCount|casualty_count|casualtyTallyCount|casualtyTally\s*\??\s*\.\s*count|makeCasualtyTally|CasualtyTally\b/;

/** The caveat is present in the file's own text, beside the number. */
const LABEL_IN_TEXT =
  /CASUALTY_TALLY_LABEL|CASUALTY_TALLY_CAVEAT|casualtyTallyLabel|casualtyTally\s*\??\s*\.\s*label/;

/** The caveat is READ from the one JSON-Schema `const` that defines it. */
const LABEL_FROM_SCHEMA = /d6-casualty-tally\.schema\.json/;

/** The count is routed through a factory that stamps the caveat onto it (proved behaviourally below). */
const STAMPING_FACTORY = /makePublicReport|makeCasualtyTally/;

type Mechanism =
  /** The file DEFINES the caveat by reading the schema `const`. */
  | 'DEFINES_LABEL_FROM_SCHEMA'
  /** The file shows/exports the number and carries the caveat in its own text, right beside it. */
  | 'LABEL_TRAVELS_IN_THIS_FILE'
  /** The file moves the number but hands it to a stamping factory, which attaches the caveat. */
  | 'LABEL_STAMPED_BY_FACTORY'
  /** A persistence column definition. The caveat is deliberately NOT a storable column — see the extra
   *  assertion below that the raw column can only be read back through the stamping mapper. */
  | 'RAW_COLUMN_LABEL_IS_UNSTORABLE'
  /** The file names the concept in prose or a flag id and never touches a number. */
  | 'NAMES_THE_CONCEPT_ONLY';

interface TallySite {
  readonly file: string;
  readonly mechanism: Mechanism;
  /** Why this mechanism is the truth for this file — argued in the open, per ADR-035 §4's allowlist idiom. */
  readonly why: string;
}

// ── THE ENUMERATION. Every discovered site, with how the label reaches the reader. ──────────────────────────
const SITES: readonly TallySite[] = [
  {
    file: 'src/application/aggregate/casualty-tally.ts',
    mechanism: 'DEFINES_LABEL_FROM_SCHEMA',
    why: 'The FR-D6-5 value object. `label` is a REQUIRED field set by the factory from the schema `const`, never caller-supplied.',
  },
  {
    file: 'src/domain/public-report.ts',
    mechanism: 'DEFINES_LABEL_FROM_SCHEMA',
    why: 'The host entity (ADR-035 §4 puts the tally on the D4 damage report). `makePublicReport` STAMPS the caveat from the same schema `const`, so a bare count cannot be placed on a report.',
  },
  {
    file: 'src/application/aggregate/incident-summary.ts',
    mechanism: 'LABEL_TRAVELS_IN_THIS_FILE',
    why: 'EXPORT SITE (FR-D6-4 document). Re-emits the tally object and derives a caveat line from CASUALTY_TALLY_LABEL into `caveats[]`.',
  },
  {
    file: 'src/adapters/channels/http/routes/incident-summary.ts',
    mechanism: 'LABEL_TRAVELS_IN_THIS_FILE',
    why: 'EXPORT SITE (the CSV/JSON download). Emits `casualtyTallyCount` and `casualtyTallyLabel` as adjacent columns, so the label leaves the system in the same row as the number.',
  },
  {
    file: 'src/adapters/persistence/read-models.ts',
    mechanism: 'LABEL_STAMPED_BY_FACTORY',
    why: 'CARRIER. Writes the count to a column and re-runs `makePublicReport` on read (`reportFromRow`), so every hydrated report carries the caveat even though the database never stored it.',
  },
  {
    file: 'src/adapters/persistence/schema/intel-tables.ts',
    mechanism: 'RAW_COLUMN_LABEL_IS_UNSTORABLE',
    why: 'The `casualty_count` / `casualty_as_of` columns. There is deliberately NO label column: a caveat you cannot persist is a caveat you cannot fail to persist.',
  },
  {
    file: 'src/application/aggregate/d6-flags.ts',
    mechanism: 'NAMES_THE_CONCEPT_ONLY',
    why: 'Names the FEATURE_D6_CASUALTY_TALLY flag id. No number.',
  },
  {
    file: 'src/config/index.ts',
    mechanism: 'NAMES_THE_CONCEPT_ONLY',
    why: 'Declares the FEATURE_D6_CASUALTY_TALLY flag and its NEXT_PUBLIC_ mirror. No number.',
  },
  {
    file: 'src/domain/damage-assessment.ts',
    mechanism: 'NAMES_THE_CONCEPT_ONLY',
    why: 'Prose only: states that the assessment entry carries no casualty figure.',
  },
  {
    file: 'src/domain/damage-overlay.ts',
    mechanism: 'NAMES_THE_CONCEPT_ONLY',
    why: 'Prose only: states that no casualty concept may be added to the overlay.',
  },
  {
    file: 'src/application/coordination/damage-assessment.ts',
    mechanism: 'NAMES_THE_CONCEPT_ONLY',
    why: 'Prose only: points at FR-D6-5 as the owner of any casualty figure.',
  },
  {
    file: 'src/adapters/channels/http/routes/feature-router.ts',
    mechanism: 'NAMES_THE_CONCEPT_ONLY',
    why: 'Prose only: notes that no live casualty aggregation pipeline is reachable from the HTTP layer.',
  },
];

const EVIDENCE: Readonly<
  Record<Mechanism, { readonly required: RegExp; readonly forbidden?: RegExp }>
> = {
  DEFINES_LABEL_FROM_SCHEMA: { required: LABEL_FROM_SCHEMA },
  LABEL_TRAVELS_IN_THIS_FILE: { required: LABEL_IN_TEXT },
  LABEL_STAMPED_BY_FACTORY: { required: STAMPING_FACTORY },
  RAW_COLUMN_LABEL_IS_UNSTORABLE: {
    required: /casualty_count/,
    forbidden: /casualty_label|casualtyLabel/,
  },
  NAMES_THE_CONCEPT_ONLY: { required: MENTIONS_CASUALTY, forbidden: COUNT_BEARING },
};

/** Non-test source files under a root, as repo-relative POSIX paths. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(relative(REPO, full).split(sep).join('/'));
    }
  }
  return out;
}

const ALL_SOURCES = SCANNED_ROOTS.flatMap((r) => sourceFiles(resolve(REPO, r)));
const read = (file: string): string => readFileSync(resolve(REPO, file), 'utf8');
const DISCOVERED = ALL_SOURCES.filter((f) => MENTIONS_CASUALTY.test(read(f))).sort();

describe('F-174 — every casualty-tally site is enumerated, and the label travels to each', () => {
  it('the scan actually walked the tree (a walker that finds nothing would pass everything)', () => {
    expect(ALL_SOURCES.length).toBeGreaterThan(100);
    expect(DISCOVERED.length).toBeGreaterThan(5);
  });

  it('DISCOVERY: no source file touches the casualty tally without being enumerated here', () => {
    const enumerated = SITES.map((s) => s.file).sort();
    const undeclared = DISCOVERED.filter((f) => !enumerated.includes(f));
    const stale = enumerated.filter((f) => !DISCOVERED.includes(f));
    expect(
      undeclared,
      'NEW CASUALTY-TALLY SITE(S) FOUND. ADR-035 §4 requires the caveat "unverified — not authoritative" at ' +
        'EVERY render and export site. Add each file to SITES with the MECHANISM by which the label reaches ' +
        'the reader — and make that mechanism true in the file, because the evidence check below reads the ' +
        'file, not the declaration.',
    ).toEqual([]);
    expect(
      stale,
      'ENUMERATED SITE(S) NO LONGER MENTION THE TALLY. Remove them from SITES so the list keeps describing ' +
        'the repository as it is (a list nobody prunes stops being evidence).',
    ).toEqual([]);
  });

  it.each(SITES.map((s) => [`${s.file} [${s.mechanism}]`, s] as const))(
    'MECHANISM: %s holds in the file itself',
    (_label, site) => {
      const text = read(site.file);
      const { required, forbidden } = EVIDENCE[site.mechanism];
      expect(
        required.test(text),
        `${site.file} is declared "${site.mechanism}" (${site.why}) but its text does not match ${String(required)} — ` +
          'the declaration is not true of the file. Either make the label travel here, or declare the mechanism ' +
          'that is actually true.',
      ).toBe(true);
      if (forbidden !== undefined) {
        expect(
          forbidden.test(text),
          `${site.file} is declared "${site.mechanism}" but matches ${String(forbidden)} — it handles the NUMBER, ` +
            'so it needs a mechanism that makes the label travel with it.',
        ).toBe(false);
      }
    },
  );

  it('the raw persisted column has exactly ONE read path, and that path re-stamps the caveat', () => {
    // `casualty_count` is stored without a label; that is only safe while nothing reads the column except the
    // mapper that runs the stamping factory. Anything else selecting it would be a bare number with no caveat.
    const columnReaders = ALL_SOURCES.filter((f) =>
      /casualtyCount|casualty_count/.test(read(f)),
    ).sort();
    expect(columnReaders).toEqual([
      'src/adapters/persistence/read-models.ts',
      'src/adapters/persistence/schema/intel-tables.ts',
    ]);
    expect(read('src/adapters/persistence/read-models.ts')).toMatch(/makePublicReport/);
  });
});

// =============================================================================================================
// Behavioural arms — the mechanisms above are only worth asserting if the factories really stamp.
// =============================================================================================================

describe('F-174 — the stamping factories attach the caveat, and callers cannot opt out', () => {
  const reportWith = (tally: { count: number; asOf?: string } | undefined) =>
    makePublicReport({
      id: asId<PublicReportId>('rep-1'),
      source: 'WEB',
      category: 'DAMAGE',
      consent: true,
      purgeAfter: AT,
      ...(tally !== undefined ? { casualtyTally: tally } : {}),
    });

  it('makePublicReport stamps the caveat onto a bare count', () => {
    const report = reportWith({ count: 3, asOf: AT });
    expect(report.casualtyTally).toEqual({
      count: 3,
      asOf: AT,
      label: CASUALTY_TALLY_CAVEAT,
      authoritative: false,
    });
  });

  it('a count of ZERO is preserved and still carries the caveat ("none observed here" is a report)', () => {
    expect(reportWith({ count: 0 })?.casualtyTally).toEqual({
      count: 0,
      label: CASUALTY_TALLY_CAVEAT,
      authoritative: CASUALTY_TALLY_AUTHORITATIVE,
    });
  });

  it('a caller-supplied softened label cannot survive: the factory stamps, it does not copy', () => {
    const smuggled = { count: 5, label: 'approximate', authoritative: true } as never;
    expect(reportWith(smuggled)?.casualtyTally?.label).toBe(CASUALTY_TALLY_CAVEAT);
    expect(reportWith(smuggled)?.casualtyTally?.authoritative).toBe(false);
  });

  it('no tally ⇒ no field at all — an absent tally is never a labelled zero', () => {
    expect(reportWith(undefined).casualtyTally).toBeUndefined();
  });

  it('the count is still a count: non-integer/negative is rejected rather than labelled', () => {
    expect(() => reportWith({ count: -1 })).toThrow(/non-negative integer/);
    expect(() => reportWith({ count: 1.5 })).toThrow(/non-negative integer/);
    expect(() => reportWith({ count: 2, asOf: 'yesterday' })).toThrow(/valid ISO timestamp/);
  });

  it('makeCasualtyTally stamps the same caveat — one string, two factories, no drift', () => {
    const res = makeCasualtyTally({ count: 7, asOf: AT });
    expect(res.ok && res.value.label).toBe(CASUALTY_TALLY_CAVEAT);
    expect(CASUALTY_TALLY_LABEL).toBe(CASUALTY_TALLY_CAVEAT);
    expect(CASUALTY_TALLY_CAVEAT).toBe(casualtyTallySchema.properties.label.const);
  });

  it('the EXPORT document cannot serialize the number without the caveat appearing in the same payload', () => {
    const tally = makeCasualtyTally({ count: 4, asOf: AT });
    expect(tally.ok).toBe(true);
    const source = makeSourceRecord({
      id: asId<SourceId>('src-1'),
      source: 'seed',
      adapter: 'seed',
      fetchedAt: AT,
      license: 'CC0',
      mode: 'MOCK',
    });
    const summary = buildIncidentSummary({
      incidentId: 'inc-1',
      generatedAt: AT,
      alertsIssued: 1,
      tasksCompleted: 1,
      provenance: [source],
      ...(tally.ok ? { casualtyTally: tally.value } : {}),
    });
    expect(summary.ok).toBe(true);
    const wire = JSON.stringify(summary.ok ? summary.value : {});
    expect(wire).toContain('"count":4');
    // The number and the caveat leave together — twice over: on the value itself and in `caveats[]`.
    expect(wire).toContain(CASUALTY_TALLY_CAVEAT);
    expect(
      summary.ok ? summary.value.caveats.some((c) => c.includes(CASUALTY_TALLY_CAVEAT)) : false,
    ).toBe(true);
  });
});

// =============================================================================================================
// Conformance arm — the domain-side shape and the application value object are one contract, not two.
// =============================================================================================================

describe('F-174 — the report-hosted tally and the D6 value object are pinned to one schema', () => {
  it('an application CasualtyTally is assignable to the report-hosted shape (compile-time + runtime)', () => {
    const built = makeCasualtyTally({ reportId: 'rep-9', count: 2, asOf: AT });
    expect(built.ok).toBe(true);
    const value: CasualtyTally = built.ok ? built.value : ({} as CasualtyTally);
    // THIS ASSIGNMENT IS THE ASSERTION: `domain-is-pure` forbids src/domain importing src/application, so the
    // two shapes cannot be one declaration. If either side changes independently, this line stops compiling.
    const hosted: ReportCasualtyTally = value;
    expect(hosted.label).toBe(CASUALTY_TALLY_CAVEAT);
    expect(hosted.authoritative).toBe(false);
  });

  it('the report-hosted shape is the schema minus `reportId` (which the host report already is)', () => {
    const report = makePublicReport({
      id: asId<PublicReportId>('rep-2'),
      source: 'WEB',
      consent: true,
      purgeAfter: AT,
      casualtyTally: { count: 1, asOf: AT },
    });
    const hostedKeys = Object.keys(report.casualtyTally ?? {}).sort();
    const schemaKeys = Object.keys(casualtyTallySchema.properties).sort();
    expect([...hostedKeys, 'reportId'].sort()).toEqual(schemaKeys);
  });

  it('`label` and `authoritative` are REQUIRED by the schema — the caveat is not optional decoration', () => {
    expect(casualtyTallySchema.required).toContain('label');
    expect(casualtyTallySchema.required).toContain('authoritative');
    expect(casualtyTallySchema.properties.authoritative.const).toBe(false);
  });
});
