// BEACON — structural fitness function: THE TWO MODE VOCABULARIES CANNOT BE CONFUSED (ADR-041 §3; V2·A12).
//
// `LIVE | CACHED | MOCK` spells TWO different concepts in this codebase, and until A12 they were able to
// share one word because the sets were identical:
//   • the ADAPTER LADDER RUNG — a per-source CONFIGURATION (`SOURCE_<NAME>_MODE`, the adapter manifest, the
//     per-region override map). It answers: how should this adapter TRY to get its data?
//   • the SERVED-PROVENANCE MODE — `SourceRef.mode` on a response. It answers: where did the datum I am
//     showing you ACTUALLY come from?
//
// A12 gives operator-maintained rows a served-provenance word (`DB`) and deliberately does NOT give the
// ladder one, because no adapter can fetch `DB` and a config that cannot mean anything is worse than a
// missing one. That asymmetry is the whole decision, so it is pinned here in both directions: the served
// surfaces MUST carry `DB`, and the ladder surfaces MUST NOT. A future widening that forgets which axis it
// is on fails here rather than shipping a `SOURCE_FIRMS_MODE=DB` nobody can honour.
//
// The JSON-Schema and OpenAPI copies are pinned rather than derived for the reason domain-db-enum-pin.test.ts
// states: they are not importable TypeScript, so they are the copies that CAN still drift.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { SERVED_MODES, SOURCE_MODES } from '@/domain/source-record.js';
import {
  shelterProvenanceClaim,
  buildShelterStatusBoard,
} from '@/application/coordination/shelter-status.js';

const REPO = process.cwd();

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(REPO, file), 'utf8')) as Record<string, unknown>;
}

/** First value found under `key` anywhere in a JSON document (breadth-first) — the domain-db-enum-pin idiom:
 *  found by WALK, not by a hard-coded pointer, so a schema reshuffle cannot silently skip the check. */
function findKey(node: unknown, key: string): unknown {
  const queue: unknown[] = [node];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || typeof current !== 'object') continue;
    const record = current as Record<string, unknown>;
    if (key in record) return record[key];
    for (const value of Object.values(record)) queue.push(value);
  }
  return undefined;
}

const OPENAPI = parseYaml(readFileSync(resolve(REPO, 'docs/api/openapi.yaml'), 'utf8')) as {
  components: { schemas: Record<string, Record<string, unknown>> };
};

/** The enum a named OpenAPI component's `mode` property declares. */
function openapiModeEnum(component: string): readonly string[] {
  const schema = OPENAPI.components.schemas[component];
  expect(schema, `openapi.yaml has no components.schemas.${component}`).toBeDefined();
  const mode = (schema!['properties'] as Record<string, { enum?: string[] }>)['mode'];
  expect(mode?.enum, `openapi.yaml ${component} has no mode enum`).toBeDefined();
  return mode!.enum!;
}

describe('the served vocabulary is DERIVED from the ladder one, never re-typed', () => {
  it('SERVED_MODES is exactly the three ladder rungs plus DB', () => {
    expect(SERVED_MODES).toEqual([...SOURCE_MODES, 'DB']);
  });

  it('SOURCE_MODES itself is untouched — the ladder still has exactly three rungs', () => {
    expect(SOURCE_MODES).toEqual(['LIVE', 'CACHED', 'MOCK']);
  });
});

describe('SERVED-provenance surfaces carry DB', () => {
  const cases: ReadonlyArray<readonly [string, () => readonly string[]]> = [
    [
      'schemas/source-ref.schema.json $defs.sourceMode',
      () =>
        (readJson('schemas/source-ref.schema.json')['$defs'] as Record<string, { enum: string[] }>)[
          'sourceMode'
        ]!.enum,
    ],
    [
      'schemas/d5-shelter-status.schema.json $defs.provenance.mode',
      () =>
        (
          readJson('schemas/d5-shelter-status.schema.json')['$defs'] as Record<
            string,
            { properties: Record<string, { enum: string[] }> }
          >
        )['provenance']!.properties['mode']!.enum,
    ],
    [
      'schemas/d6-incident-summary.schema.json provenance[].mode',
      () =>
        (
          readJson('schemas/d6-incident-summary.schema.json')['properties'] as Record<
            string,
            { items: { properties: Record<string, { enum: string[] }> } }
          >
        )['provenance']!.items.properties['mode']!.enum,
    ],
    ['openapi.yaml SourceRef.mode', () => openapiModeEnum('SourceRef')],
    ['openapi.yaml SourceRecord.mode', () => openapiModeEnum('SourceRecord')],
    [
      'openapi.yaml IncidentSummaryProvenance.mode',
      () => openapiModeEnum('IncidentSummaryProvenance'),
    ],
  ];

  it.each(cases)('%s === SERVED_MODES', (_what, read) => {
    expect([...read()].sort()).toEqual([...SERVED_MODES].sort());
  });

  it('the envelope meta.mode (the served rung a degraded response reports) carries DB too', () => {
    const meta = (
      OPENAPI.components.schemas['ResponseEnvelope']!['properties'] as Record<
        string,
        Record<string, unknown>
      >
    )['meta']!;
    const mode = (meta['properties'] as Record<string, { enum?: string[] }>)['mode'];
    expect([...(mode!.enum as string[])].sort()).toEqual([...SERVED_MODES].sort());
  });
});

describe('LADDER-RUNG surfaces do NOT carry DB — no adapter can ever be configured to fetch it', () => {
  it('schemas/adapter-manifest.schema.json keeps exactly the three rungs, everywhere it spells them', () => {
    const manifest = readJson('schemas/adapter-manifest.schema.json');
    const found: string[][] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record['enum']) && (record['enum'] as string[]).includes('CACHED')) {
        found.push(record['enum'] as string[]);
      }
      for (const value of Object.values(record)) walk(value);
    };
    walk(manifest);
    expect(found.length).toBeGreaterThan(0);
    for (const e of found) expect(e).toEqual([...SOURCE_MODES]);
  });

  it('schemas/regions.schema.json per-region override map keeps exactly the three rungs', () => {
    const overrides = findKey(readJson('schemas/regions.schema.json'), 'source_mode_overrides') as {
      additionalProperties: { enum: string[] };
    };
    expect(overrides.additionalProperties.enum).toEqual([...SOURCE_MODES]);
  });

  it('openapi.yaml AdapterHealth.mode is the EFFECTIVE RUNG, so it stays three-valued', () => {
    expect(openapiModeEnum('AdapterHealth')).toEqual([...SOURCE_MODES]);
  });
});

describe('the shelter board speaks DB without ever speaking live (F-35 preserved, ADR-041 §3)', () => {
  const SEEDED = {
    sourceLabel: 'operator-maintained shelter records',
    asOf: '2026-07-05T22:00:00Z',
  } as const;

  it('accepts DB as a board provenance mode', () => {
    const board = buildShelterStatusBoard({ shelters: [], provenance: { ...SEEDED, mode: 'DB' } });
    expect(board.ok).toBe(true);
  });

  it('the DB claim names the operator, never claims live, and never calls operator data MOCK', () => {
    const claim = shelterProvenanceClaim({ ...SEEDED, mode: 'DB' });
    expect(claim).not.toMatch(/^Live/);
    expect(claim).not.toContain('MOCK');
    expect(claim).toContain('operator-maintained');
  });

  it('every served mode still produces a DISTINCT sentence — no two rungs read alike', () => {
    const claims = SERVED_MODES.map((mode) => shelterProvenanceClaim({ ...SEEDED, mode }));
    expect(new Set(claims).size).toBe(SERVED_MODES.length);
  });
});
