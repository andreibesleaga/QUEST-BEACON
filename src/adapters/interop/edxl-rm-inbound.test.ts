// BEACON — INBOUND EDXL-RM schema-gate tests (MW-D/D5.2; finding F-31, ADR-036 §7 G11, V13).
// The emit side has always validated (`resourceTaskToEdxlRm` → validatedByFile). The INGEST side did not:
// `feature-router.ts:287` casts a parsed JSON body straight to `EdxlRmMessage`. These tests pin the closure.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { edxlRmToResourceTask, parseInboundEdxlRm } from './edxl-rm-mapper.js';
import type { EdxlRmMessage } from './edxl-rm-mapper.js';

const FIXTURE = JSON.parse(readFileSync('fixtures/coordination/edxl-rm-inbound.json', 'utf8')) as Record<
  string,
  Record<string, unknown>
>;

const INVALID_CASES = [
  'invalidUnknownMember',
  'invalidMessageType',
  'invalidMissingCorrelationId',
  'invalidSentDateTime',
] as const;

interface ReadableInfo {
  readonly resourceInfoElementID?: string;
  readonly resource?: { readonly resourceID?: string; readonly resourceStatus?: { readonly deploymentStatus?: string } };
}

function firstResourceInfo(doc: Record<string, unknown>): ReadableInfo {
  const content = doc.contentObject as { resourceInformation?: ReadableInfo[] }[] | undefined;
  return content?.[0]?.resourceInformation?.[0] ?? {};
}

function firstIncidentId(doc: Record<string, unknown>): string | undefined {
  return (doc.incidentInformation as { incidentID?: string }[] | undefined)?.[0]?.incidentID;
}

/** The four elements `edxlRmToResourceTask` actually reads to rebuild a canonical task. */
function carriesEverythingTheMapperReads(doc: Record<string, unknown>): boolean {
  const info = firstResourceInfo(doc);
  const status = info.resource?.resourceStatus;
  const reads = [
    info.resourceInfoElementID,
    info.resource?.resourceID,
    status?.deploymentStatus,
    firstIncidentId(doc),
  ];
  return reads.every((value) => value !== undefined);
}

describe('parseInboundEdxlRm (the inbound schema gate — F-31)', () => {
  it('accepts a schema-valid inbound document and hands back the typed message', () => {
    const res = parseInboundEdxlRm(FIXTURE.valid);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.originatingMessageID).toBe('urn:beacon:rm:req-7781');
  });

  it('rejects a non-object payload outright (an unvalidated body is not an EdxlRmMessage)', () => {
    for (const raw of [undefined, null, 42, 'RequestResource', []]) {
      const res = parseInboundEdxlRm(raw);
      expect(res.ok, JSON.stringify(raw)).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('PARSE_ERROR');
    }
  });

  it.each(INVALID_CASES)('rejects %s against schemas/edxl-rm.schema.json', (name) => {
    const res = parseInboundEdxlRm(FIXTURE[name]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PARSE_ERROR');
    expect(res.error.message).toContain('schemas/edxl-rm.schema.json');
  });
});

describe('edxlRmToResourceTask validates BEFORE it maps', () => {
  it('maps a schema-valid document to a canonical ResourceTask', () => {
    const res = edxlRmToResourceTask(FIXTURE.valid as unknown as EdxlRmMessage);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({
      id: 'task-inbound-1',
      resourceId: 'res-engine-7',
      incidentId: 'inc-1',
      status: 'PROPOSED',
      edxlRmRef: 'urn:beacon:rm:req-7781',
    });
  });

  it.each(INVALID_CASES)(
    'refuses %s even though it carries every element the mapper reads — so ONLY the schema can be rejecting it',
    (name) => {
      const doc = FIXTURE[name]!;
      // This is what makes the assertion meaningful: each of these documents would have mapped cleanly
      // under the old raw-cast path, because the mapper's own guards never look at the fields the schema
      // rejects (unknown members, messageType, sentDateTime format, the correlation id).
      expect(carriesEverythingTheMapperReads(doc), name).toBe(true);
      const res = edxlRmToResourceTask(doc as unknown as EdxlRmMessage);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('PARSE_ERROR');
      expect(res.error.message).toContain('Inbound EDXL-RM message failed');
    },
  );

  it('still reports the mapper-level reason for a schema-valid but unmappable document', () => {
    // A document that PASSES the schema and fails on a mapping rule keeps its specific error (no regression
    // in the pre-existing inbound guards): `Unknown` has no canonical task status.
    const unmappable = structuredClone(FIXTURE.valid) as unknown as EdxlRmMessage;
    const info = unmappable.contentObject[0]!.resourceInformation[0]!;
    const withUnknownStatus = {
      ...unmappable,
      contentObject: [
        {
          resourceInformation: [
            { ...info, resource: { ...info.resource, resourceStatus: { deploymentStatus: 'Unknown' as const } } },
          ],
        },
      ],
    };
    const res = edxlRmToResourceTask(withUnknownStatus);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toMatch(/deploymentStatus does not map to a canonical task status/);
  });
});
