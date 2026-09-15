// BEACON — GET /incidents/:id/summary handler unit tests (E7·D6; FR-D6-4, ADR-035 §4; F-172). Deterministic:
// fixed past clock, no wall-clock/network. Covers RBAC, CSV/JSON serialization + Content-Disposition, RFC
// 4180 escaping (reused from `application/coordination/csv.ts`, not reimplemented here), and — the PLANT
// proof required by this task — that Layer D's guard actually fires on a real payload and the route
// propagates the error branch rather than ever serializing the document beside it.
import { describe, it, expect } from 'vitest';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, SourceId } from '@/domain/value-objects/ids.js';
import {
  CASUALTY_TALLY_LABEL,
  type CasualtyTally,
} from '@/application/aggregate/casualty-tally.js';
import { handleIncidentSummary } from './incident-summary.js';
import type { IncidentSummaryRequest, IncidentSummaryWireFigures } from './incident-summary.js';

const CLOCK = '2026-07-05T22:00:00Z';
const clock = (): string => CLOCK;
const deps = { clock };
const incident = (id = 'inc-summary-1'): IncidentId => asId<IncidentId>(id);

const MINIMAL_FIGURES: IncidentSummaryWireFigures = {
  alertsIssued: 3,
  tasksCompleted: 5,
  provenance: [
    {
      id: asId<SourceId>('src-1'),
      source: 'NASA FIRMS',
      adapter: 'firms-adapter',
      fetchedAt: '2026-07-05T20:00:00Z',
      license: 'MODIS/VIIRS use policy',
      mode: 'LIVE',
    },
  ],
};

function req(overrides: Partial<IncidentSummaryRequest> = {}): IncidentSummaryRequest {
  return {
    role: 'RESPONDER',
    incidentId: incident(),
    figures: MINIMAL_FIGURES,
    format: 'json',
    ...overrides,
  };
}

describe('handleIncidentSummary — RBAC (RESPONDER+, same gate as GET /pre-positioning / GET /resources)', () => {
  it('PUBLIC → 403 FORBIDDEN', () => {
    const res = handleIncidentSummary(req({ role: 'PUBLIC' }), deps);
    expect(res.status).toBe(403);
    const body = res.body as { errors?: readonly { code: string }[] };
    expect(body.errors?.[0]?.code).toBe('FORBIDDEN');
  });

  it('VERIFIER (below RESPONDER rank is false — VERIFIER outranks RESPONDER) → 200', () => {
    // Sanity: isResponder is a RANK gate (RESPONDER+), not an exact-role check.
    const res = handleIncidentSummary(req({ role: 'VERIFIER' }), deps);
    expect(res.status).toBe(200);
  });

  it('RESPONDER → 200', () => {
    const res = handleIncidentSummary(req({ role: 'RESPONDER' }), deps);
    expect(res.status).toBe(200);
  });
});

describe('handleIncidentSummary — JSON format', () => {
  it('returns the built document with Content-Disposition + application/json', () => {
    const res = handleIncidentSummary(req({ format: 'json' }), deps);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="incident-inc-summary-1-summary.json"',
    );
    const body = res.body as {
      incidentId: string;
      alertsIssued: number;
      generatedAt: string;
      caveats: readonly string[];
    };
    expect(body.incidentId).toBe('inc-summary-1');
    expect(body.alertsIssued).toBe(3);
    // generatedAt is the INJECTED clock, never a wall-clock read (Art. XII) — never client-supplied either
    // (it is not a field of IncidentSummaryWireFigures at all, so a client cannot forge it).
    expect(body.generatedAt).toBe(CLOCK);
    expect(body.caveats.length).toBeGreaterThan(0);
  });

  it('sanitizes an unsafe incidentId out of the Content-Disposition filename (header-injection guard)', () => {
    const res = handleIncidentSummary(
      req({ incidentId: incident('inc/1 "evil"\r\nX-Injected: 1') }),
      deps,
    );
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="incident-inc_1__evil___X-Injected__1-summary.json"',
    );
  });
});

describe('handleIncidentSummary — CSV format (reuses application/coordination/csv.ts, not a second writer)', () => {
  it('returns one header record + one CRLF-terminated data record, text/csv + Content-Disposition', () => {
    const res = handleIncidentSummary(req({ format: 'csv' }), deps);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="incident-inc-summary-1-summary.csv"',
    );
    const csv = res.body as string;
    const lines = csv.split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // header + exactly one document row (a summary is ONE incident, not a list)
    expect(lines[0]).toBe(
      'incidentId,regionId,generatedAt,closedAt,alertsIssued,tasksCompleted,tasksTotal,sheltersOpen,shelterOccupancyPeak,shelterCapacityTotal,affectedAreaKm2,casualtyTallyCount,casualtyTallyLabel,freshnessFetchedAt,provenanceSources,caveats',
    );
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes a caveat cell that contains a comma (RFC 4180) — the always-present aggregate-only caveat', () => {
    const res = handleIncidentSummary(req({ format: 'csv' }), deps);
    const csv = res.body as string;
    // The one caveat ALWAYS present regardless of input (incident-summary.ts's deriveCaveats) — contains a
    // comma, so csvCell must quote the whole cell. This is the last CSV column, so it runs to end of line.
    expect(csv).toContain(
      '"Aggregate-only: no person-identifying field is present. Verified at this export boundary by a fail-closed runtime key walk (ADR-035 §4 Layer D), not merely by the declared types."',
    );
  });

  it('quotes AND doubles an embedded double-quote in a provenance source name', () => {
    const res = handleIncidentSummary(
      req({
        format: 'csv',
        figures: {
          ...MINIMAL_FIGURES,
          provenance: [
            {
              id: asId<SourceId>('src-1'),
              source: 'Acme "Shelter" Feed, Inc',
              adapter: 'acme-adapter',
              fetchedAt: '2026-07-05T20:00:00Z',
              license: 'internal',
              mode: 'LIVE',
            },
          ],
        },
      }),
      deps,
    );
    const csv = res.body as string;
    // csvCell: comma forces quoting; an embedded `"` is doubled to `""` — both rules exercised at once.
    expect(csv).toContain('"Acme ""Shelter"" Feed, Inc (LIVE)"');
  });

  it('a present casualtyTally renders its count + SERVER-STAMPED label CSV cells (the "present" branch)', () => {
    const res = handleIncidentSummary(
      req({ format: 'csv', figures: { ...MINIMAL_FIGURES, casualtyTally: { count: 7 } } }),
      deps,
    );
    const csv = res.body as string;
    const [, row] = csv.split('\r\n');
    // The caller supplies ONLY the count; the label cell comes from CASUALTY_TALLY_LABEL, which
    // `makeCasualtyTally` reads from schemas/d6-casualty-tally.schema.json (F-346).
    expect(row).toContain(`,7,${CASUALTY_TALLY_LABEL},`);
  });

  it('an absent optional figure (affectedAreaKm2) renders as an empty CSV cell, never the string "undefined"', () => {
    const res = handleIncidentSummary(req({ format: 'csv', figures: MINIMAL_FIGURES }), deps);
    const csv = res.body as string;
    const [, row] = csv.split('\r\n');
    expect(row).toBeDefined();
    expect(row).not.toContain('undefined');
  });
});

describe('handleIncidentSummary — PLANT/FAIL/REVERT: a person-identifying key never reaches the document', () => {
  it('a casualtyTally carrying reporterId (denylisted, aggregate-only.ts) is BLOCKED — never serialized', () => {
    const res = handleIncidentSummary(
      req({
        figures: {
          ...MINIMAL_FIGURES,
          // A cast/DB-row/JS-caller bypass of the typed `makeCasualtyTally` factory. BEFORE F-346 this
          // travelled by reference into the document and was caught downstream by Layer D (422); it is now
          // caught EARLIER and harder, at the transport boundary, by name (400) — the key never enters the
          // builder at all. Layer D remains proven at the boundary it actually guards, the by-reference
          // application input (src/application/aggregate/incident-summary.test.ts).
          // @ts-expect-error — deliberately injecting a denylisted key a real cast/DB-row bypass could carry
          casualtyTally: { count: 2, reporterId: 'user-99' },
        },
      }),
      deps,
    );
    expect(res.status).toBe(400);
    const body = res.body as { errors?: readonly { code: string; message: string }[] };
    expect(body.errors?.[0]?.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.[0]?.message).toBe(
      'figures.casualtyTally.reporterId is not an accepted field; send only {reportId, count, asOf}',
    );
    // The payload is NEVER handed back beside the error — this is the load-bearing assertion (F-143's own
    // invariant): a document leak here would satisfy every other test in this file while still violating
    // Art. XIV, so it must be checked explicitly and not merely inferred from the status code.
    expect(JSON.stringify(body)).not.toContain('alertsIssued');
    expect(JSON.stringify(body)).not.toContain('user-99');
  });

  it('REVERT: the identical request WITHOUT the denylisted key succeeds (proves the block was the key, not the shape)', () => {
    const res = handleIncidentSummary(
      req({ figures: { ...MINIMAL_FIGURES, casualtyTally: { count: 2 } } }),
      deps,
    );
    expect(res.status).toBe(200);
  });
});

// =============================================================================================================
// F-346 — the forged tally, at the handler boundary (the HTTP-level proof lives in the integration suite)
// =============================================================================================================
describe('handleIncidentSummary — F-346: the casualty tally is SERVER-derived (Art. XII)', () => {
  it('rejects a client-supplied `label` by name — not silently dropped (the actorId precedent)', () => {
    const res = handleIncidentSummary(
      req({
        figures: {
          ...MINIMAL_FIGURES,
          // @ts-expect-error — `label` is not on IncidentSummaryWireCasualtyTally; a real client sends JSON,
          // so the type alone cannot stop it. THIS DIRECTIVE IS PART OF THE GUARANTEE: widen the wire type
          // back to `CasualtyTally` and tsc fails right here on the now-unused directive.
          casualtyTally: { count: 3, label: 'CONFIRMED by County Coroner' },
        },
      }),
      deps,
    );
    expect(res.status).toBe(400);
    const body = res.body as { errors?: readonly { code: string; message: string }[] };
    expect(body.errors?.[0]?.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.[0]?.message).toContain(
      'figures.casualtyTally.label is derived server-side',
    );
    expect(JSON.stringify(body)).not.toContain('Coroner');
  });

  it('rejects a client-supplied `authoritative` by name', () => {
    const res = handleIncidentSummary(
      // @ts-expect-error — `authoritative` is server-stamped `false`; a caller may never assert it.
      req({ figures: { ...MINIMAL_FIGURES, casualtyTally: { count: 3, authoritative: true } } }),
      deps,
    );
    expect(res.status).toBe(400);
    const body = res.body as { errors?: readonly { code: string }[] };
    expect(body.errors?.[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('the count invariant is enforced by the SHARED factory, not a second copy of the rule', () => {
    for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const res = handleIncidentSummary(
        req({ figures: { ...MINIMAL_FIGURES, casualtyTally: { count } } }),
        deps,
      );
      expect(res.status).toBe(400);
      const body = res.body as { errors?: readonly { code: string; message: string }[] };
      // makeCasualtyTally's OWN message — proof the route delegates rather than re-implementing the rule.
      expect(body.errors?.[0]?.message).toContain('non-negative integer');
    }
  });

  it('a non-object tally is a typed 400, never a throw', () => {
    const res = handleIncidentSummary(
      // @ts-expect-error — untrusted JSON can be any shape; the type is not the guard, the check is.
      req({ figures: { ...MINIMAL_FIGURES, casualtyTally: 'boom' } }),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('the caller-owned fields survive verbatim (reportId/count/asOf) and only those', () => {
    const res = handleIncidentSummary(
      req({
        figures: {
          ...MINIMAL_FIGURES,
          casualtyTally: { count: 4, reportId: 'rep-7', asOf: '2026-07-05T21:00:00Z' },
        },
      }),
      deps,
    );
    expect(res.status).toBe(200);
    const body = res.body as { casualtyTally?: CasualtyTally };
    expect(body.casualtyTally).toEqual({
      reportId: 'rep-7',
      count: 4,
      asOf: '2026-07-05T21:00:00Z',
      label: CASUALTY_TALLY_LABEL,
      authoritative: false, // CASUALTY_TALLY_AUTHORITATIVE — structural, never caller-chosen
    });
  });

  it('no tally at all ⇒ no tally in the document (the server never invents a zero)', () => {
    const res = handleIncidentSummary(req({ figures: MINIMAL_FIGURES }), deps);
    expect(res.status).toBe(200);
    expect((res.body as { casualtyTally?: unknown }).casualtyTally).toBeUndefined();
  });
});

// =============================================================================================================
// F-350 — every failure is TYPED and non-fatal (Art. XVI: degrade, don't break)
// =============================================================================================================
describe('handleIncidentSummary — F-350: malformed provenance is a typed 400, never a raw throw', () => {
  it.each([
    ['a null row', [null], 'figures.provenance[0] must be a SOURCE_RECORD object'],
    ['a string row', ['oops'], 'figures.provenance[0] must be a SOURCE_RECORD object'],
    [
      'a missing field',
      [{ id: 'src-1', source: 'NASA FIRMS' }],
      'figures.provenance[0].adapter is required',
    ],
    [
      'a blank field',
      [{ id: ' ', source: 's', adapter: 'a', fetchedAt: 'f', license: 'l', mode: 'LIVE' }],
      'figures.provenance[0].id is required',
    ],
  ])('%s → 400 VALIDATION_ERROR naming the row', (_case, provenance, expected) => {
    const res = handleIncidentSummary(
      // @ts-expect-error — untrusted JSON reaches this handler cast to the wire type (feature-router.ts:283)
      req({ figures: { ...MINIMAL_FIGURES, provenance } }),
      deps,
    );
    expect(res.status).toBe(400);
    const body = res.body as { errors?: readonly { code: string; message: string }[] };
    expect(body.errors?.[0]?.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.[0]?.message).toContain(expected);
  });

  it('an unknown provenance mode is rejected against the DOMAIN vocabulary (never exported as LIVE)', () => {
    const res = handleIncidentSummary(
      req({
        figures: {
          ...MINIMAL_FIGURES,
          // prettier-ignore
          // @ts-expect-error — a wire value outside SOURCE_MODES; Art. XVI forbids relabelling it LIVE
          provenance: [{ id: 'src-1', source: 's', adapter: 'a', fetchedAt: '2026-07-05T20:00:00Z', license: 'l', mode: 'REALTIME' }],
        },
      }),
      deps,
    );
    expect(res.status).toBe(400);
    expect(
      (res.body as { errors?: readonly { message: string }[] }).errors?.[0]?.message,
    ).toContain('LIVE|CACHED|MOCK');
  });

  it('a THROWING injected dependency degrades to a typed 500 envelope — handleIncidentSummary never throws', () => {
    const boom = (): string => {
      throw new Error('clock exploded: postgres://user:secret@db/beacon');
    };
    const res = handleIncidentSummary(req(), { clock: boom });
    expect(res.status).toBe(500);
    const body = res.body as { errors?: readonly { code: string; message: string }[] };
    expect(body.errors?.[0]?.code).toBe('INTERNAL_ERROR');
    // No stack, no internal message, no leaked connection string (SECURITY_BASELINE, Art. IV).
    expect(body.errors?.[0]?.message).toBe('internal error');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});

describe('handleIncidentSummary — ordinary DomainError still maps through the public vocabulary', () => {
  it('a negative alertsIssued (INVARIANT_VIOLATION) → 422 VALIDATION_ERROR, not a 500', () => {
    const res = handleIncidentSummary(
      req({ figures: { ...MINIMAL_FIGURES, alertsIssued: -1 } }),
      deps,
    );
    expect(res.status).toBe(422);
    const body = res.body as { errors?: readonly { code: string }[] };
    expect(body.errors?.[0]?.code).toBe('VALIDATION_ERROR');
  });
});
