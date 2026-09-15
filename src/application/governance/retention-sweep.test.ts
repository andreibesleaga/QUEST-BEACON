// BEACON — Art. XIV retention sweep tests (MW-D/D4.3; finding F-25).
// NO DATABASE: the sweep talks to `RetentionStorePort`, so the whole executor is provable against an
// in-memory fake. NO wall clock: every instant is injected and pinned to the project's fixed test clock.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import {
  FakeGovernanceLedger,
  FakeRetentionStore,
} from '../../../tests/_harness/fakes/fake-governance.js';
import { retentionCutoff, runRetentionSweep } from './retention-sweep.js';
import { DEFAULT_GOVERNANCE_CONFIG } from './governance-config.js';
import type { RetentionConfig } from './governance-config.js';

const T0 = '2026-07-05T22:00:00.000Z';
const clockAt = (iso: string) => (): string => iso;
const noGrace: RetentionConfig = { publicReportRetentionDays: 30, sweepGraceMinutes: 0 };

// Three rows: one long expired, one expiring exactly AT the sweep instant, one still inside its window.
const rows = {
  'rep-expired': '2026-06-05T22:00:00.000Z',
  'rep-exactly-due': T0,
  'rep-live': '2026-08-04T22:00:00.000Z',
} as const;

describe('retentionCutoff', () => {
  it('is the sweep instant itself when no grace is configured', () => {
    const res = retentionCutoff(T0, noGrace);
    expect(isOk(res) && res.value).toBe(T0);
  });

  it('subtracts the configured grace, so grace DELAYS a deletion rather than hastening it', () => {
    const res = retentionCutoff(T0, { publicReportRetentionDays: 30, sweepGraceMinutes: 90 });
    expect(isOk(res) && res.value).toBe('2026-07-05T20:30:00.000Z');
  });

  it('refuses a non-instant clock instead of computing a garbage cutoff', () => {
    const res = retentionCutoff('whenever', noGrace);
    expect(isErr(res) && res.error.code).toBe('PARSE_ERROR');
  });
});

describe('runRetentionSweep', () => {
  it('DELETES every row past its deadline — the guarantee is enforced, not merely stamped (F-25)', async () => {
    const store = new FakeRetentionStore(rows, 'memory');
    const res = await runRetentionSweep({ store, clock: clockAt(T0), config: noGrace });
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value).toMatchObject({
        asOf: T0,
        store: 'memory',
        dataset: 'public_report',
        expired: 2,
        purged: 2,
      });
    }
    // The rows are actually GONE — not flagged, not hidden. `purgeAfter` inclusive at the boundary.
    expect(store.remaining).toEqual(['rep-live']);
    expect(store.purgeCalls).toEqual([['rep-expired', 'rep-exactly-due']]);
  });

  it('is idempotent: a second sweep at the same instant finds nothing left and calls no purge', async () => {
    const store = new FakeRetentionStore(rows);
    await runRetentionSweep({ store, clock: clockAt(T0), config: noGrace });
    const again = await runRetentionSweep({ store, clock: clockAt(T0), config: noGrace });
    expect(isOk(again) && again.value.expired).toBe(0);
    expect(isOk(again) && again.value.purged).toBe(0);
    expect(store.purgeCalls).toHaveLength(1); // no empty purge round-trip
  });

  it('is DETERMINISTIC in the injected clock — an earlier sweep deletes strictly less', async () => {
    const early = new FakeRetentionStore(rows);
    const res = await runRetentionSweep({
      store: early,
      clock: clockAt('2026-06-01T00:00:00.000Z'),
      config: noGrace,
    });
    expect(isOk(res) && res.value.purged).toBe(0);
    expect(early.remaining).toHaveLength(3);
    // …and the same store swept twice at the same instant yields identical reports (no hidden state).
    const a = await runRetentionSweep({
      store: new FakeRetentionStore(rows),
      clock: clockAt(T0),
      config: noGrace,
    });
    const b = await runRetentionSweep({
      store: new FakeRetentionStore(rows),
      clock: clockAt(T0),
      config: noGrace,
    });
    expect(isOk(a) && isOk(b) && a.value).toEqual(isOk(b) ? b.value : undefined);
  });

  it('honours the configured grace: a row exactly due survives until the grace elapses', async () => {
    const store = new FakeRetentionStore(rows);
    const res = await runRetentionSweep({
      store,
      clock: clockAt(T0),
      config: { publicReportRetentionDays: 30, sweepGraceMinutes: 60 },
    });
    expect(isOk(res) && res.value.purged).toBe(1); // only the long-expired one
    expect(store.remaining).toEqual(['rep-exactly-due', 'rep-live']);
  });

  it('records an AGGREGATE-ONLY governance entry: counts and instants, never the purged ids', async () => {
    const store = new FakeRetentionStore(rows, 'postgres');
    const ledger = new FakeGovernanceLedger();
    const res = await runRetentionSweep({ store, ledger, clock: clockAt(T0), config: noGrace });
    expect(isOk(res) && res.value.ledgerHash).toBe('h-1');
    const entry = ledger.entries[0];
    expect(entry?.action).toBe('RETENTION_PURGE');
    expect(entry?.target).toBe('retention:public_report');
    expect(entry?.at).toBe(T0);
    expect(entry?.actorId).toBeUndefined(); // a machine sweep has no human actor
    expect(ledger.evidenceFor(entry?.evidenceDigest ?? '')).toEqual({
      evidence: {
        store: 'postgres',
        dataset: 'public_report',
        cutoff: T0,
        retentionDays: 30,
        graceMinutes: 0,
        expired: 2,
        purged: 2,
      },
    });
    // The record must not become a shadow copy of what was purged.
    expect(JSON.stringify(ledger.appended)).not.toContain('rep-expired');
  });

  it('records a ZERO-purge sweep too, so an auditor can see the sweep RAN and found nothing', async () => {
    const ledger = new FakeGovernanceLedger();
    const res = await runRetentionSweep({
      store: new FakeRetentionStore({}),
      ledger,
      clock: clockAt(T0),
      config: noGrace,
    });
    expect(isOk(res)).toBe(true);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.action).toBe('RETENTION_PURGE');
  });

  it('propagates a store query failure without claiming a purge happened', async () => {
    const store = new FakeRetentionStore(rows);
    store.failExpired = true;
    const res = await runRetentionSweep({ store, clock: clockAt(T0), config: noGrace });
    expect(isErr(res) && res.error.code).toBe('PARSE_ERROR');
    expect(store.remaining).toHaveLength(3);
  });

  it('propagates a delete failure', async () => {
    const store = new FakeRetentionStore(rows);
    store.failPurge = true;
    const res = await runRetentionSweep({ store, clock: clockAt(T0), config: noGrace });
    expect(isErr(res) && res.error.code).toBe('CONFLICT');
  });

  it('refuses a non-instant clock (no cutoff, no deletion)', async () => {
    const store = new FakeRetentionStore(rows);
    const res = await runRetentionSweep({ store, clock: clockAt('sometime'), config: noGrace });
    expect(isErr(res) && res.error.code).toBe('PARSE_ERROR');
    expect(store.remaining).toHaveLength(3);
  });

  it('DELETES FIRST and reports a failed ledger append — privacy is never blocked on the audit', async () => {
    // The mirror image of alert-sink.ts, which audits BEFORE emitting: an emission is an irreversible public
    // act that must not go unrecorded, whereas refusing to delete because the ledger is down would breach
    // the very article the sweep enforces. The error must therefore state that rows WERE deleted.
    const store = new FakeRetentionStore(rows);
    const ledger = new FakeGovernanceLedger();
    ledger.failNextAppend = 'CONFLICT';
    const res = await runRetentionSweep({ store, ledger, clock: clockAt(T0), config: noGrace });
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('CONFLICT');
      expect(res.error.message).toMatch(/purged 2 row\(s\).*governance record failed to append/);
    }
    expect(store.remaining).toEqual(['rep-live']); // the deletion stands
  });

  it('reports the store’s own count when it differs from the requested set (no optimistic reporting)', async () => {
    const store = new FakeRetentionStore(rows);
    store.purgedOverride = 1; // a row vanished between the query and the delete
    const res = await runRetentionSweep({ store, clock: clockAt(T0), config: noGrace });
    expect(isOk(res) && res.value).toMatchObject({ expired: 2, purged: 1 });
  });

  it('defaults to the SHIPPED retention config when none is injected', async () => {
    const store = new FakeRetentionStore(rows);
    const ledger = new FakeGovernanceLedger();
    const res = await runRetentionSweep({ store, ledger, clock: clockAt(T0) });
    expect(isOk(res)).toBe(true);
    expect(ledger.evidenceFor(ledger.entries[0]?.evidenceDigest ?? '')).toMatchObject({
      evidence: {
        retentionDays: DEFAULT_GOVERNANCE_CONFIG.retention.publicReportRetentionDays,
        graceMinutes: DEFAULT_GOVERNANCE_CONFIG.retention.sweepGraceMinutes,
      },
    });
  });
});
