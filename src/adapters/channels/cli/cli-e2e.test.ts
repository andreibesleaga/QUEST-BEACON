// BEACON — CLI channel e2e (E10·T-461). Drives the golden path monitor → assess → report → verify →
// act(DRAFT) fully OFFLINE against DEFAULT_SEED for BOTH regions (US us-ca, RO ro). Deterministic per the
// flaky-test rule: a FIXED past clock + counter-based newId + empty env (no wall-clock, no network).
//
// Asserts the guarantees hold on the CLI exactly as on the HTTP API (ADR-023 §guarantees):
//   • every response envelope carries non-empty provenance (F1)
//   • sitrep carries citations[] (F2) and aiMode 'deterministic-only' (AI-off offline, F7)
//   • verify requires VERIFIER (PUBLIC → exitCode 1 / UNAUTHORIZED)   — HITL gate (Art. XIII)
//   • alert:draft returns capStatus DRAFT + the approval note; there is NO way to emit
import { describe, it, expect } from 'vitest';
import type { CliDeps } from './run.js';
import { run } from './run.js';
import { buildInteraction } from '@/main/build-core.js';
import type { Envelope } from '@/ports/interaction.js';

const NOW = '2026-07-05T22:00:00Z'; // safely in the past (matches the seed's SEEDED_AT)

/** Fresh deterministic deps per invocation: fixed clock, per-run counter id minter, offline env. */
function deps(): CliDeps {
  let n = 0;
  return { clock: () => NOW, newId: (p) => `${p}-${++n}`, env: {} };
}

/** Run a command with --json and return the exit code + parsed Envelope. */
async function runJson(argv: string[]): Promise<{ exitCode: number; env: Envelope }> {
  const res = await run([...argv, '--json'], deps());
  return { exitCode: res.exitCode, env: JSON.parse(res.stdout) as Envelope };
}

/**
 * A multi-command session sharing ONE wired core (so an in-memory report persists across `report` then
 * `verify`) — models a real interactive session; a multi-process CLI would use the Postgres store.
 */
function session(): (argv: string[]) => Promise<{ exitCode: number; env: Envelope }> {
  let n = 0;
  const port = buildInteraction({ clock: () => NOW, newId: (p) => `${p}-${++n}`, env: {} });
  return async (argv) => {
    const res = await run([...argv, '--json'], { clock: () => NOW, port });
    return { exitCode: res.exitCode, env: JSON.parse(res.stdout) as Envelope };
  };
}

function expectGrounded(env: Envelope): void {
  expect(env.provenance.length).toBeGreaterThan(0); // F1 — non-empty provenance on every data response
}

const REGIONS = [
  { region: 'us-ca', incidentId: 'us-ca-wildfire-demo' },
  { region: 'ro', incidentId: 'ro-flood-demo' },
] as const;

describe.each(REGIONS)('CLI golden path — offline, region $region', ({ region, incidentId }) => {
  it('monitor: status + incidents carry non-empty provenance (F1)', async () => {
    const status = await runJson(['status', '--region', region]);
    expect(status.exitCode).toBe(0);
    expectGrounded(status.env);

    const incidents = await runJson(['incidents', '--region', region]);
    expect(incidents.exitCode).toBe(0);
    expectGrounded(incidents.env);
  });

  it('assess: sitrep is cited (F2) and deterministic-only offline (F7)', async () => {
    const { exitCode, env } = await runJson(['sitrep', incidentId]);
    expect(exitCode).toBe(0);
    expectGrounded(env);
    expect(env.citations?.length ?? 0).toBeGreaterThan(0); // F2
    expect((env.data as { aiMode: string }).aiMode).toBe('deterministic-only'); // F7
  });

  it('report: a consented SOS is grounded and returns a report id', async () => {
    const { exitCode, env } = await runJson(['report', '--text', 'smoke rising', '--consent']);
    expect(exitCode).toBe(0);
    expectGrounded(env);
    expect((env.data as { id: string }).id).toBeTruthy();
  });

  it('report → verify: PUBLIC is UNAUTHORIZED (HITL gate), VERIFIER triages the real report', async () => {
    const run1 = session();
    const reported = await run1(['report', '--text', 'smoke rising', '--consent']);
    expect(reported.exitCode).toBe(0);
    const id = (reported.env.data as { id: string }).id;

    const denied = await run1(['verify', id, 'TRIAGED']); // default role PUBLIC
    expect(denied.exitCode).toBe(1);
    expect(denied.env.errors?.[0]?.code).toBe('UNAUTHORIZED');

    const allowed = await run1(['verify', id, 'TRIAGED', '--role', 'VERIFIER']);
    expect(allowed.exitCode).toBe(0);
    expect((allowed.env.data as { status: string }).status).toBe('TRIAGED');
    expectGrounded(allowed.env);
  });

  it('verify of an unknown report id → NOT_FOUND (never fabricates a report)', async () => {
    const { exitCode, env } = await runJson([
      'verify',
      'nope-999',
      'TRIAGED',
      '--role',
      'VERIFIER',
    ]);
    expect(exitCode).toBe(1);
    expect(env.errors?.[0]?.code).toBe('NOT_FOUND');
  });

  it('act(DRAFT): alert:draft returns capStatus DRAFT + approval note, never emits', async () => {
    const { exitCode, env } = await runJson([
      'alert:draft',
      incidentId,
      '--headline',
      'Evacuate zone A',
      '--role',
      'VERIFIER',
    ]);
    expect(exitCode).toBe(0);
    expectGrounded(env);
    expect((env.data as { alert: { capStatus: string } }).alert.capStatus).toBe('DRAFT');
    expect(String(env.meta?.['note'])).toMatch(/approval/i);
  });
});

describe('CLI security — no emit surface (T-454, Art. XIII)', () => {
  it('alert:draft requires VERIFIER — PUBLIC and RESPONDER are UNAUTHORIZED', async () => {
    for (const role of [[], ['--role', 'RESPONDER']]) {
      const { exitCode, env } = await runJson([
        'alert:draft',
        'us-ca-wildfire-demo',
        '--headline',
        'x',
        ...role,
      ]);
      expect(exitCode).toBe(1);
      expect(env.errors?.[0]?.code).toBe('UNAUTHORIZED');
    }
  });

  it('there is no alert:send/emit command — it is a PARSE_ERROR, not an action', async () => {
    for (const verb of ['alert:send', 'alert:emit']) {
      const { exitCode, env } = await runJson([verb, 'us-ca-wildfire-demo']);
      expect(exitCode).toBe(1);
      expect(env.errors?.[0]?.code).toBe('PARSE_ERROR');
    }
  });
});

describe('CLI rendering', () => {
  it('human view always shows provenance + freshness; sitrep shows citations', async () => {
    const res = await run(['sitrep', 'us-ca-wildfire-demo'], deps());
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('provenance:');
    expect(res.stdout).toContain('freshness:');
    expect(res.stdout).toContain('citations:');
  });

  it('a parse error renders as ERROR and exits 1', async () => {
    const res = await run(['frobnicate'], deps());
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toContain('ERROR [PARSE_ERROR]');
  });
});
