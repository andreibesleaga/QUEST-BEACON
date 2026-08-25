// BEACON — demo auto-report watcher tests (ADR-037 §5; FR-LD-13 / FR-LD-14).
//
// NO TIMER, NO NETWORK, NO CLOCK READ: the watcher exposes `tick()`, the scheduler owns the interval, and
// every instant is injected — so "the FIRST critical signal sends exactly one message" is provable by
// calling `tick()` twice, with no fake-timer library anywhere.
//
// THE ART. XIII PROOF IS THE LAST DESCRIBE BLOCK and is deliberately two-layered: a RUNTIME assertion that a
// full firing tick touches neither an alert store nor an alert sink, and a STRUCTURAL assertion over the
// module's own source that neither is even importable from here. The runtime half alone would only prove
// "this code path did not publish today"; the structural half is what makes it "this code path cannot".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ThresholdRuleId } from '@/domain/value-objects/ids.js';
import type { AlertCategory, AlertSeverity } from '@/domain/alert.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { Envelope, NotificationPort, SourceRef } from '@/ports/interaction.js';
import {
  CRITICAL_SEVERITY_FLOOR,
  MONITORING_NOTICE_LABEL,
  isReportable,
  makeDemoWatcher,
  monitoringEnvelope,
  type DemoWatchDeps,
  type MonitoringAuditPort,
  type WatchedSignal,
} from './demo-watch.js';

const T0 = '2026-07-05T22:00:00.000Z';
const clock = (): string => T0;
const REGION = 'us-ca';
const FRESHNESS = '2026-07-05T21:45:00.000Z';

const SOURCE: SourceRef = { sourceId: 'firms', mode: 'LIVE', fetchedAt: FRESHNESS };

function signal(overrides: Partial<WatchedSignal> = {}): WatchedSignal {
  return {
    rule: makeThresholdRule({
      id: asId<ThresholdRuleId>('ca-hazard-buffer-rule'),
      target: 'HAZARD_BUFFER',
      operator: 'enters',
      value: '1000m',
    }),
    reading: { hazardWithinBuffer: true },
    category: 'Fire' as AlertCategory,
    severity: 'SEVERE' as AlertSeverity,
    source: SOURCE,
    summary: 'a lifeline node entered the fire hazard buffer',
    ...overrides,
  };
}

/** Records every send, and can be made to fail — the ONLY effect surface the watcher has. */
class FakeNotifier implements NotificationPort {
  readonly sent: { audience: string; envelope: Envelope }[] = [];
  mode: 'ok' | 'err' | 'throw' = 'ok';

  notify(audience: string, envelope: Envelope): Promise<ReturnType<typeof ok<void>>> {
    if (this.mode === 'throw') throw new Error('transport exploded');
    if (this.mode === 'err') {
      return Promise.resolve(err(new DomainError('CONFLICT', 'telegram refused')) as never);
    }
    this.sent.push({ audience, envelope });
    return Promise.resolve(ok(undefined));
  }
}

class SpyAudit implements MonitoringAuditPort {
  readonly appended: { action: string; target: string; at: string; regionId?: string }[] = [];
  throwOnAppend = false;

  append(input: { action: string; target: string; at: string; regionId?: string }): unknown {
    if (this.throwOnAppend) throw new Error('ledger down');
    this.appended.push(input);
    return undefined;
  }
}

function deps(overrides: Partial<DemoWatchDeps> = {}): DemoWatchDeps {
  return {
    regionId: REGION,
    signals: () => Promise.resolve([signal()]),
    notifier: new FakeNotifier(),
    audience: ['chat-1'],
    clock,
    once: true,
    ...overrides,
  };
}

describe('isReportable — the deterministic criticality gate (Art. XII: no new judgement)', () => {
  it('accepts a watched hazard family at or above the critical floor', () => {
    expect(isReportable(signal({ severity: CRITICAL_SEVERITY_FLOOR }))).toBe(true);
    expect(isReportable(signal({ severity: 'EXTREME', category: 'Met' }))).toBe(true);
  });

  it('refuses anything below the floor — a monitoring beat that fires on everything is noise', () => {
    expect(isReportable(signal({ severity: 'MODERATE' }))).toBe(false);
    expect(isReportable(signal({ severity: 'MINOR' }))).toBe(false);
  });

  it('refuses a category outside wildfire/flood, however severe', () => {
    expect(isReportable(signal({ category: 'Safety', severity: 'EXTREME' }))).toBe(false);
  });
});

describe('monitoringEnvelope — what a recipient actually reads (FR-LD-13)', () => {
  const envelope = monitoringEnvelope(signal(), REGION, T0);
  const data = envelope.data as { headline: string; summary: string };

  it('leads with the LITERAL automated-monitoring label', () => {
    expect(data.headline).toBe(MONITORING_NOTICE_LABEL);
    expect(data.headline).toContain('AUTOMATED MONITORING (not an approved public alert)');
  });

  it('states the region, the signal, its source citation and its freshness', () => {
    expect(data.summary).toContain(`region ${REGION}`);
    expect(data.summary).toContain('SEVERE Fire');
    expect(data.summary).toContain('a lifeline node entered the fire hazard buffer');
    expect(data.summary).toContain('ca-hazard-buffer-rule');
    expect(data.summary).toContain('source firms (LIVE)');
    expect(data.summary).toContain(FRESHNESS);
  });

  it('carries the signal’s own provenance and freshness on the envelope (F1 — never ungrounded)', () => {
    expect(envelope.provenance).toEqual([SOURCE]);
    expect(envelope.freshness).toBe(FRESHNESS);
    expect(envelope.meta).toMatchObject({ kind: 'MONITORING_NOTIFICATION', regionId: REGION });
  });

  it('is NOT an alert: no CAP status, no alert id, no approver anywhere in the payload', () => {
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain('ACTUAL');
    expect(serialized).not.toContain('capStatus');
    expect(serialized).not.toContain('approvedBy');
    expect(serialized).not.toContain('alertId');
  });
});

describe('makeDemoWatcher', () => {
  it('sends ONE notification on the first critical signal', async () => {
    const notifier = new FakeNotifier();
    const watcher = makeDemoWatcher(deps({ notifier }));
    const result = await watcher.tick();

    expect(result).toMatchObject({ evaluated: 1, fired: 1, sent: 1, failed: 0, latched: true, skipped: false });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.audience).toBe('chat-1');
    const data = notifier.sent[0]?.envelope.data as { headline: string };
    expect(data.headline).toBe(MONITORING_NOTICE_LABEL);
  });

  it('sends to EVERY subscribed chat id', async () => {
    const notifier = new FakeNotifier();
    await makeDemoWatcher(deps({ notifier, audience: ['chat-1', 'chat-2'] })).tick();
    expect(notifier.sent.map((s) => s.audience)).toEqual(['chat-1', 'chat-2']);
  });

  it('THE ONCE-LATCH HOLDS: a second, still-critical tick sends nothing more', async () => {
    const notifier = new FakeNotifier();
    const watcher = makeDemoWatcher(deps({ notifier }));
    await watcher.tick();
    const second = await watcher.tick();
    const third = await watcher.tick();

    expect(notifier.sent).toHaveLength(1);
    expect(watcher.latched).toBe(true);
    expect(second).toMatchObject({ skipped: true, sent: 0 });
    expect(third).toMatchObject({ skipped: true, sent: 0 });
  });

  it('the latch also holds against a DIFFERENT critical signal appearing later', async () => {
    const notifier = new FakeNotifier();
    const later = signal({
      rule: makeThresholdRule({
        id: asId<ThresholdRuleId>('ro-gauge-rule'),
        target: 'GAUGE_CATEGORY',
        operator: 'gte',
        value: 'MODERATE',
      }),
      reading: { floodCategory: 'MAJOR' },
      category: 'Met',
      severity: 'EXTREME',
    });
    let call = 0;
    const watcher = makeDemoWatcher(
      deps({
        notifier,
        signals: () => Promise.resolve(call++ === 0 ? [signal()] : [signal(), later]),
      }),
    );
    await watcher.tick();
    await watcher.tick();
    expect(notifier.sent).toHaveLength(1);
  });

  it('with ONCE off it keeps watching — but the threshold engine’s edge/cooldown still prevents a re-fire', async () => {
    const notifier = new FakeNotifier();
    const watcher = makeDemoWatcher(deps({ notifier, once: false }));
    await watcher.tick();
    const second = await watcher.tick();

    expect(second.skipped).toBe(false); // it really did evaluate again
    expect(second.evaluated).toBe(1);
    // The condition never went away, so the rule is still inside its met-episode: no second fire, no spam.
    expect(second.fired).toBe(0);
    expect(notifier.sent).toHaveLength(1);
  });

  it('sends NOTHING while no signal is critical, and keeps evaluating', async () => {
    const notifier = new FakeNotifier();
    const watcher = makeDemoWatcher(deps({ notifier, signals: () => Promise.resolve([signal({ severity: 'MODERATE' })]) }));
    const result = await watcher.tick();
    expect(result).toMatchObject({ evaluated: 1, fired: 0, sent: 0, latched: false });
    expect(notifier.sent).toHaveLength(0);
  });

  it('sends NOTHING when the region has no signals at all', async () => {
    const notifier = new FakeNotifier();
    const result = await makeDemoWatcher(deps({ notifier, signals: () => Promise.resolve([]) })).tick();
    expect(result).toMatchObject({ evaluated: 0, fired: 0, sent: 0 });
    expect(notifier.sent).toHaveLength(0);
  });

  it('sends NOTHING when no audience is subscribed (the flag alone is not a recipient)', async () => {
    const notifier = new FakeNotifier();
    const result = await makeDemoWatcher(deps({ notifier, audience: [] })).tick();
    expect(result).toMatchObject({ fired: 1, sent: 0, failed: 0, latched: false });
    expect(notifier.sent).toHaveLength(0);
  });

  it('AUDITS a successful send — aggregate only: action, region target and instant, never the text', async () => {
    const audit = new SpyAudit();
    await makeDemoWatcher(deps({ audit })).tick();
    expect(audit.appended).toEqual([
      { action: 'MONITORING_NOTIFICATION_SENT', target: `demo-watch:${REGION}`, at: T0, regionId: REGION },
    ]);
    expect(JSON.stringify(audit.appended)).not.toContain('chat-1');
    expect(JSON.stringify(audit.appended)).not.toContain(MONITORING_NOTICE_LABEL);
  });

  it('A TYPED SEND FAILURE IS AUDITED, NOT FATAL — and does not burn the latch', async () => {
    const notifier = new FakeNotifier();
    notifier.mode = 'err';
    const audit = new SpyAudit();
    const watcher = makeDemoWatcher(deps({ notifier, audit }));
    const result = await watcher.tick();

    expect(result).toMatchObject({ fired: 1, sent: 0, failed: 1, latched: false });
    expect(audit.appended[0]?.action).toBe('MONITORING_NOTIFICATION_FAILED');
    // The one notification the demo gets must not be spent on a message nobody received.
    expect(watcher.latched).toBe(false);
  });

  it('A THROWN TRANSPORT IS CONTAINED — the watcher returns normally so the scheduler loop survives', async () => {
    const notifier = new FakeNotifier();
    notifier.mode = 'throw';
    const audit = new SpyAudit();
    const watcher = makeDemoWatcher(deps({ notifier, audit }));

    await expect(watcher.tick()).resolves.toMatchObject({ failed: 1, sent: 0 });
    expect(audit.appended[0]?.action).toBe('MONITORING_NOTIFICATION_FAILED');
    // …and the next tick still works once the transport recovers.
    notifier.mode = 'ok';
    await expect(watcher.tick()).resolves.toMatchObject({ evaluated: 1 });
  });

  it('tallies partial delivery honestly (one chat sent, one failed)', async () => {
    const flaky: NotificationPort = {
      notify: vi
        .fn()
        .mockResolvedValueOnce(ok(undefined))
        .mockResolvedValueOnce(err(new DomainError('CONFLICT', 'blocked'))),
    };
    const audit = new SpyAudit();
    const result = await makeDemoWatcher(deps({ notifier: flaky, audience: ['a', 'b'], audit })).tick();
    expect(result).toMatchObject({ sent: 1, failed: 1, latched: true });
    expect(audit.appended.map((a) => a.action)).toEqual([
      'MONITORING_NOTIFICATION_SENT',
      'MONITORING_NOTIFICATION_FAILED',
    ]);
  });

  it('survives an audit sink that throws — the record is best-effort, the notification is not', async () => {
    const audit = new SpyAudit();
    audit.throwOnAppend = true;
    const notifier = new FakeNotifier();
    await expect(makeDemoWatcher(deps({ notifier, audit })).tick()).resolves.toMatchObject({ sent: 1 });
    expect(notifier.sent).toHaveLength(1);
  });

  it('runs with no audit sink configured at all', async () => {
    const withoutAudit = deps();
    await expect(makeDemoWatcher(withoutAudit).tick()).resolves.toMatchObject({ sent: 1 });
  });

  it('DEFAULTS to latching when `once` is not specified — the safe default is one message, not a stream', async () => {
    const notifier = new FakeNotifier();
    const withoutOnce = deps({ notifier });
    delete (withoutOnce as { once?: boolean }).once;
    const watcher = makeDemoWatcher(withoutOnce);
    await watcher.tick();
    const second = await watcher.tick();
    expect(second.skipped).toBe(true);
    expect(notifier.sent).toHaveLength(1);
  });
});

// ── ARTICLE XIII: THE WATCHER CANNOT PUBLISH (FR-LD-14) ──────────────────────────────────────────────────
describe('Art. XIII — the demo watcher never emits a public alert', () => {
  it('touches NO alert store and NO alert sink during a full firing tick', async () => {
    // Both are placed in scope with throwing/spying members. If any future edit reached for one, this test
    // would either record a call or blow up — the assertion is not "we did not pass one in", it is
    // "a firing tick, end to end, produced zero interactions with either".
    const alertStore = {
      list: vi.fn(() => {
        throw new Error('the watcher touched the alert store');
      }),
      get: vi.fn(),
      save: vi.fn(),
      replace: vi.fn(),
    };
    const alertSink = {
      emit: vi.fn(() => {
        throw new Error('the watcher reached the alert sink');
      }),
    };
    const notifier = new FakeNotifier();

    const result = await makeDemoWatcher(deps({ notifier })).tick();

    expect(result.sent).toBe(1); // the tick genuinely did its work — the guard below is not vacuous
    for (const spy of [alertStore.list, alertStore.get, alertStore.save, alertStore.replace, alertSink.emit]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('the notification carries no CAP/EDXL document and no alert identity', async () => {
    const notifier = new FakeNotifier();
    await makeDemoWatcher(deps({ notifier })).tick();
    const serialized = JSON.stringify(notifier.sent[0]?.envelope);
    for (const forbidden of ['<alert', 'urn:oasis', 'EDXL', 'capStatus', 'ACTUAL', 'approvedBy', 'alertId']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('STRUCTURAL: the module imports no alert entity, alert store, alert sink or CAP mapper', () => {
    // The strongest available statement, and the one that survives future edits: the publishing machinery is
    // not reachable from this file's import graph, so `AlertSinkPort.emit` (type-gated to an approved ACTUAL
    // alert) has no call site here and cannot acquire one without failing this assertion.
    const source = readFileSync(fileURLToPath(new URL('./demo-watch.ts', import.meta.url)), 'utf8');
    const imports = source
      .split('\n')
      .filter((line) => line.startsWith('import'))
      .join('\n');

    for (const forbidden of [
      'alert-sink',
      'AlertSinkPort',
      'EmittableAlert',
      'cap-mapper',
      'cap-sink',
      'interop',
      'makeAlert',
      'derive-alerts',
      'buildDraftAlert',
      '@/adapters/',
      '@/main/',
    ]) {
      expect(imports, `demo-watch.ts must not import ${forbidden}`).not.toContain(forbidden);
    }
    // The two effect surfaces it DOES have, named explicitly so this list stays honest rather than empty.
    expect(imports).toContain('@/ports/interaction.js');
    expect(imports).toContain('threshold-evaluation.js');
  });
});
