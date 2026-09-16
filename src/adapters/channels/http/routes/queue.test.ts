// BEACON — GET /reports queue projection tests (Live Views v1.2, ADR-029). Deterministic: pure handler,
// fixed clock, no IO. Asserts the verifier-queue row projects a report's `receivedAt` onto the wire's
// `submittedAt` (the ~2h live-view TTL basis) — present-only, and omitted when the report carries none.
import { describe, it, expect } from 'vitest';
import { ok, type Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { PublicReportId } from '@/domain/value-objects/ids.js';
import { makePublicReport, type PublicReport } from '@/domain/public-report.js';
import { handleReportsGet, type ReportQueueItem } from './queue.js';

const FIXED = '2026-07-05T22:00:00.000Z';
const clock = (): string => FIXED;

function storeOf(reports: readonly PublicReport[]): {
  list: () => Promise<Result<readonly PublicReport[], DomainError>>;
} {
  return { list: () => Promise.resolve(ok(reports)) };
}

function report(over: { receivedAt?: string; liveViewUrl?: string; text?: string }): PublicReport {
  return makePublicReport({
    id: asId<PublicReportId>('rep-1'),
    source: 'WEB',
    status: 'TRIAGED',
    consent: true,
    purgeAfter: '2026-08-05T22:00:00.000Z',
    ...(over.receivedAt !== undefined ? { receivedAt: over.receivedAt } : {}),
    ...(over.liveViewUrl !== undefined ? { liveViewUrl: over.liveViewUrl } : {}),
    ...(over.text !== undefined ? { text: over.text } : {}),
  });
}

function rowsOf(body: unknown): readonly ReportQueueItem[] {
  return (body as { data: { reports: readonly ReportQueueItem[] } }).data.reports;
}

describe('handleReportsGet — submittedAt projection', () => {
  it('projects the report receivedAt onto the wire submittedAt', async () => {
    const res = await handleReportsGet(
      { role: 'VERIFIER' },
      {
        reports: storeOf([report({ receivedAt: FIXED, liveViewUrl: 'https://twitch.tv/x' })]),
        clock,
      },
    );
    expect(res.status).toBe(200);
    const row = rowsOf(res.body)[0];
    expect(row?.submittedAt).toBe(FIXED);
    expect(row?.liveViewUrl).toBe('https://twitch.tv/x');
  });

  // The claim is the EVIDENCE the Art. XIII decision rests on. It reached this row through a chain that
  // was broken end-to-end until 2026-08-04 (intake required it, no store persisted it), so it is asserted
  // here rather than assumed: a queue row without it turns approve/reject into a blind click.
  it('serves the reporter claim to a VERIFIER so approve/reject is an informed decision', async () => {
    const claim = 'Heavy smoke on the ridge above the canyon road; we are leaving now.';
    const res = await handleReportsGet(
      { role: 'VERIFIER' },
      { reports: storeOf([report({ text: claim })]), clock },
    );
    expect(res.status).toBe(200);
    expect(rowsOf(res.body)[0]?.text).toBe(claim);
  });

  // The endpoint gate IS the audience control for the claim (no second, driftable gate on the field):
  // below VERIFIER there is no row at all, so there is no text to leak.
  it('never exposes the claim below VERIFIER — the endpoint itself 403s', async () => {
    const res = await handleReportsGet(
      { role: 'PUBLIC' },
      { reports: storeOf([report({ text: 'sensitive claim' })]), clock },
    );
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('sensitive claim');
  });

  it('omits submittedAt when the report carries no receipt time (present-only)', async () => {
    const res = await handleReportsGet(
      { role: 'VERIFIER' },
      { reports: storeOf([report({})]), clock },
    );
    const row = rowsOf(res.body)[0];
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('submittedAt');
  });
});
