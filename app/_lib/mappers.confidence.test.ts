// @vitest-environment node
// BEACON — confidence-components mapper seam (E8·Phase-D W2c). Pipes the ACTUAL GET /reports handler
// output (real handleHttp as VERIFIER) through confidenceComponentsOf, so the deterministic blend the
// verifier UI renders can never drift from the wire. Ordered, labelled, present-only (Art. XII — the
// client renders exactly what the engine returned, never computes a score).
import { describe, it, expect } from 'vitest';
import { realGet } from './real-http.js';
import { reportsOf, confidenceComponentsOf } from './mappers.js';
import type { ReportsData, ReportSummary } from './types.js';

describe('seam: confidenceComponentsOf over REAL GET /reports output', () => {
  it('surfaces the deterministic blend components in fixed order for a seeded report', async () => {
    const { env } = await realGet<ReportsData>('/api/v1/reports', 'VERIFIER');
    const reports = reportsOf(env);
    const withComponents = reports.find((r) => r.confidenceComponents !== undefined);
    expect(withComponents).toBeDefined();

    const rows = confidenceComponentsOf(withComponents!);
    expect(rows.length).toBeGreaterThan(0);
    // Fixed display order (geocode → authority → classifier → corroboration).
    expect(rows.map((r) => r.key)).toEqual(['geocode', 'authority', 'classifier', 'corroboration']);
    for (const r of rows) {
      expect(typeof r.label).toBe('string');
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThanOrEqual(1);
    }
  });

  it('returns [] when a report carries no confidence components (never fabricates zeros)', () => {
    const bare: ReportSummary = { id: 'rep-x', status: 'TRIAGED' };
    expect(confidenceComponentsOf(bare)).toEqual([]);
  });

  it('omits absent sub-scores rather than rendering them as 0', () => {
    const partial: ReportSummary = { id: 'rep-y', status: 'TRIAGED', confidenceComponents: { corroboration: 0.2 } };
    const rows = confidenceComponentsOf(partial);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ key: 'corroboration', label: 'Corroboration', value: 0.2 });
  });
});
