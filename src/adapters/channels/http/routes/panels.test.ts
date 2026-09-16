// BEACON — dock-panel HTTP handler tests (S3·U1/U2; FR-D6-1/2, FR-D4-3/4/5, F1, Art. XIII/XIV/XVI).
// Two layers, deliberately:
//   • PURE handler tests — RBAC by rank, the mandatory envelope shape (non-empty provenance[] + freshness),
//     and the module-specific honesty properties (the MOCK provenance claim, the never-summed damage
//     buckets, the rejected future-dated EMS product) under the fixed project clock.
//   • INTEGRATION through the REAL dispatcher (`handleHttp`) — route matching, the flag-off posture (OFF ⇒
//     the SAME generic 404 an unmatched route returns, the incident-summary precedent) and the §196 public
//     error vocabulary, which only exists after feature-router's remap.
// Deterministic: fixed past clock, counter ids, no network, no wall clock.
import { describe, it, expect } from 'vitest';
import type { Envelope } from '@/ports/interaction.js';
import { PUBLIC_REPORT_STATUSES } from '@/domain/public-report.js';
import { TEAM_AVAILABILITY } from '@/application/aggregate/volunteer-team.js';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { createHttpDeps, handleHttp, type CreateHttpDepsOptions } from '../http-dispatcher.js';
import type { HttpDeps, HttpRequest } from '../http-types.js';
import {
  handleSuppliesGet,
  handleVolunteerTeamsGet,
  handleShelterStatusGet,
  handleDamageReportsGet,
  handleEmsOverlayGet,
} from './panels.js';
import type {
  PanelHttpResult,
  SuppliesGetData,
  VolunteerTeamsGetData,
  ShelterStatusGetData,
  DamageReportsGetData,
  EmsOverlayGetData,
} from './panels.js';

const FIXED = '2026-07-05T22:00:00Z';
const clock = (): string => FIXED;

/** Every panel handler under one loop-friendly name (the five share one contract). */
const HANDLERS = [
  ['supplies', handleSuppliesGet],
  ['volunteer-teams', handleVolunteerTeamsGet],
  ['shelter-status', handleShelterStatusGet],
  ['damage-reports', handleDamageReportsGet],
  ['ems-overlay', handleEmsOverlayGet],
] as const;

function dataOf<T>(res: PanelHttpResult): T {
  return (res.body as Envelope<T>).data;
}

describe('dock-panel handlers — the shared contract', () => {
  it('403s below RESPONDER on every panel (the logistics-dock gate; PUBLIC sees no row at all)', async () => {
    for (const [name, handler] of HANDLERS) {
      const res = await handler({ role: 'PUBLIC' }, { clock });
      expect(res.status, name).toBe(403);
      expect((res.body as Envelope).errors?.[0]?.code, name).toBe('UNAUTHORIZED');
    }
  });

  it('answers RESPONDER with a grounded envelope: non-empty MOCK provenance[] + freshness (F1, Art. XVI)', async () => {
    for (const [name, handler] of HANDLERS) {
      const res = await handler({ role: 'RESPONDER' }, { clock });
      expect(res.status, name).toBe(200);
      const env = res.body as Envelope;
      expect(env.provenance.length, name).toBeGreaterThan(0);
      // Fixture-fed data must say MOCK — never presented as a live feed (Art. XVI).
      expect(env.provenance[0]?.mode, name).toBe('MOCK');
      expect(env.freshness, name).toBe(FIXED);
    }
  });

  it('EM (rank above RESPONDER) passes every gate — a rank comparison, not an exact-role check', async () => {
    for (const [name, handler] of HANDLERS) {
      expect((await handler({ role: 'EM' }, { clock })).status, name).toBe(200);
    }
  });
});

describe('GET /supplies — relief supply lots (FR-D6-2)', () => {
  it('serves the fixture lots through the REAL factory: every quantity carries a unit, no PII key anywhere', async () => {
    const { supplies } = dataOf<SuppliesGetData>(
      await handleSuppliesGet({ role: 'RESPONDER' }, { clock }),
    );
    expect(supplies.length).toBeGreaterThan(0);
    for (const lot of supplies) {
      expect(lot.kind).toBe('SUPPLY');
      if (lot.quantity !== undefined) expect(lot.unit).toBeDefined(); // the quantity-requires-unit invariant
    }
    // ADR-035 §4 Layer C posture, applied to what actually leaves this handler.
    expect(findPersonIdentifyingRuntimeKeys(supplies)).toEqual([]);
  });
});

describe('GET /volunteer-teams — team units (FR-D6-1)', () => {
  it('serves UNIT aggregates only: closed availability vocabulary, a tally, and no person key anywhere', async () => {
    const { teams } = dataOf<VolunteerTeamsGetData>(
      await handleVolunteerTeamsGet({ role: 'RESPONDER' }, { clock }),
    );
    expect(teams.length).toBeGreaterThan(0);
    for (const team of teams) {
      expect(team.kind).toBe('TEAM');
      if (team.availability !== undefined) expect(TEAM_AVAILABILITY).toContain(team.availability);
      if (team.headcount !== undefined) expect(Number.isInteger(team.headcount)).toBe(true);
    }
    expect(findPersonIdentifyingRuntimeKeys(teams)).toEqual([]);
  });
});

describe('GET /shelter-status — the aggregate shelter board (FR-D4-3)', () => {
  it('serves the module board with derived totals, the injected asOf, and a claim that says MOCK (F-35)', async () => {
    const { board } = dataOf<ShelterStatusGetData>(
      await handleShelterStatusGet({ role: 'RESPONDER' }, { clock }),
    );
    // The fixture: one OPEN-with-space, one FULL, one CLOSED, one zero-capacity OPEN.
    expect(board.totals.shelters).toBe(board.rows.length);
    expect(board.totals.available).toBe(board.totals.capacity - board.totals.occupancy);
    // availableOpen counts OPEN shelters only — a CLOSED shelter's spare hall is not intake capacity.
    const openSpare = board.rows.reduce(
      (sum, r) => sum + (r.status === 'OPEN' ? r.available : 0),
      0,
    );
    expect(board.totals.availableOpen).toBe(openSpare);
    expect(board.provenance.asOf).toBe(FIXED);
    expect(board.provenance.mode).toBe('MOCK');
    expect(board.provenanceClaim).toContain('MOCK');
    expect(board.provenanceClaim).not.toMatch(/^Live/);
  });
});

describe('GET /damage-reports — per-triage-state buckets (FR-D4-4)', () => {
  it('keeps the verified/unverified split structural: one bucket per pipeline state, NO grand total', async () => {
    const { assessment } = dataOf<DamageReportsGetData>(
      await handleDamageReportsGet({ role: 'RESPONDER' }, { clock }),
    );
    expect(Object.keys(assessment.byTriageStatus).sort()).toEqual(
      [...PUBLIC_REPORT_STATUSES].sort(),
    );
    // `verified` IS the VERIFIED bucket by reference — the two can never disagree.
    expect(assessment.verified).toBe(assessment.byTriageStatus.VERIFIED);
    // The fixture seeds every bucket non-empty, including REJECTED (a refused claim is information too).
    expect(assessment.verified.entries).toBeGreaterThan(0);
    expect(assessment.byTriageStatus.UNVERIFIED.entries).toBeGreaterThan(0);
    expect(assessment.byTriageStatus.REJECTED.entries).toBeGreaterThan(0);
    expect(assessment.unverifiedLabel).toBe('unverified — not authoritative');
    // No field of the payload is a cross-bucket sum — the laundering Art. XIII forbids upstream.
    expect(assessment).not.toHaveProperty('total');
    expect(assessment).not.toHaveProperty('totalEntries');
  });
});

describe('GET /ems-overlay — link-only Copernicus EMS products (FR-D4-5)', () => {
  it('serves attributed, dated, link-only products; the future-dated fixture product lands in rejected', async () => {
    const { overlay } = dataOf<EmsOverlayGetData>(
      await handleEmsOverlayGet({ role: 'RESPONDER' }, { clock }),
    );
    // The fixture carries three products; the 2026-07-09 one is AFTER the fixed clock and must be flagged,
    // never rendered with a negative age (Art. XVI).
    expect(overlay.products).toHaveLength(2);
    expect(overlay.rejected).toEqual([
      {
        productId: 'EMSR773_AOI03_DEL_PRODUCT_r2',
        reason: 'PRODUCED_AFTER_AS_OF',
        producedAt: '2026-07-09T09:00:00Z',
      },
    ]);
    expect(overlay.asOf).toBe(FIXED);
    for (const product of overlay.products) {
      expect(product.linkOnly).toBe(true);
      expect(product.productionLabel).toContain(product.producedAt);
      expect(product.viewUrl.startsWith('https://')).toBe(true);
    }
    expect(overlay.attribution.length).toBeGreaterThan(0);
  });
});

// ── Through the REAL dispatcher: route matching, §196 public error vocab, and the flag-off posture ──────

const PANEL_PATHS = [
  ['/api/v1/supplies', 'FEATURE_D6_SUPPLIES'],
  ['/api/v1/volunteer-teams', 'FEATURE_D6_VOLUNTEER_TEAMS'],
  ['/api/v1/shelter-status', 'FEATURE_D4_SHELTER_STATUS'],
  ['/api/v1/damage-reports', 'FEATURE_D4_DAMAGE_REPORTS'],
  ['/api/v1/ems-overlay', 'FEATURE_D4_EMS_OVERLAY'],
] as const;

function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

function deps(env: Record<string, string> = {}): HttpDeps {
  const options: CreateHttpDepsOptions = {
    core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_DEV_TRUST_HEADER: 'on', ...env } },
    rateLimit: { capacity: 1000, refillPerSec: 0 },
  };
  return createHttpDeps(options);
}

function req(path: string, role?: string): HttpRequest {
  return {
    method: 'GET',
    path,
    query: {},
    headers: role !== undefined ? { 'x-beacon-role': role } : {},
  };
}

describe('dock-panel routes through handleHttp', () => {
  it('RESPONDER → 200 grounded envelope on all five (flags default ON)', async () => {
    const d = deps();
    for (const [path] of PANEL_PATHS) {
      const res = await handleHttp(req(path, 'RESPONDER'), d);
      expect(res.status, path).toBe(200);
      expect((res.body as Envelope).provenance.length, path).toBeGreaterThan(0);
    }
  });

  it('PUBLIC → 403 in the stable §196 vocabulary (FORBIDDEN, remapped from the raw domain code)', async () => {
    const d = deps();
    for (const [path] of PANEL_PATHS) {
      const res = await handleHttp(req(path), d);
      expect(res.status, path).toBe(403);
      expect((res.body as Envelope).errors?.[0]?.code, path).toBe('FORBIDDEN');
    }
  });

  it('flag OFF → the SAME generic 404 an unmatched route returns (never "exists but disabled")', async () => {
    for (const [path, flag] of PANEL_PATHS) {
      // The NEXT_PUBLIC mirror must agree with the server flag (config/index.ts's fail-fast refinement) —
      // set both OFF, mirroring the incident-summary gate test.
      const off = deps({ [flag]: 'off', [`NEXT_PUBLIC_${flag}`]: 'off' });
      const disabled = await handleHttp(req(path, 'RESPONDER'), off);
      const unmatched = await handleHttp(req('/api/v1/no-such-route-at-all', 'RESPONDER'), off);
      expect(disabled.status, path).toBe(404);
      expect(disabled.body, path).toEqual(unmatched.body);
    }
  });

  it('a disabled flag turns off ONLY its own panel — the other four keep serving', async () => {
    const off = deps({ FEATURE_D6_SUPPLIES: 'off', NEXT_PUBLIC_FEATURE_D6_SUPPLIES: 'off' });
    expect((await handleHttp(req('/api/v1/supplies', 'RESPONDER'), off)).status).toBe(404);
    for (const [path] of PANEL_PATHS.slice(1)) {
      expect((await handleHttp(req(path, 'RESPONDER'), off)).status, path).toBe(200);
    }
  });
});
