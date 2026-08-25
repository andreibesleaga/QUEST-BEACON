// BEACON — parseArgs unit tests (E10·T-453/T-454). Pure, deterministic (no clock, no IO): every command,
// role resolution, the consent-required rule, and unknown/malformed rejection. Asserts the CLI maps ONLY
// onto the canonical Command set and never invents an `alert:send`.
import { describe, it, expect } from 'vitest';
import { parseArgs } from './parse-args.js';
import type { Command } from '@/ports/interaction.js';

/** Assert parse succeeded and hand back the command for further assertions. */
function cmd(argv: string[]): Command {
  const r = parseArgs(argv);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('expected ok');
  return r.value.command;
}

describe('parseArgs — read commands', () => {
  it('status defaults role PUBLIC and omits region', () => {
    const r = parseArgs(['status']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.command).toEqual({ verb: 'status' });
    expect(r.value.actorRole).toBe('PUBLIC');
  });

  it('status --region attaches the region id', () => {
    expect(cmd(['status', '--region', 'ro'])).toEqual({ verb: 'status', regionId: 'ro' });
  });

  it('incidents --region', () => {
    expect(cmd(['incidents', '--region', 'us-ca'])).toEqual({ verb: 'incidents', regionId: 'us-ca' });
  });

  it('sources --region', () => {
    expect(cmd(['sources', '--region', 'ro'])).toEqual({ verb: 'sources', regionId: 'ro' });
  });

  it('sitrep <incidentId>', () => {
    expect(cmd(['sitrep', 'us-ca-wildfire-demo'])).toEqual({
      verb: 'sitrep',
      incidentId: 'us-ca-wildfire-demo',
    });
  });

  it('sitrep without an incident id is a PARSE_ERROR', () => {
    const r = parseArgs(['sitrep']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PARSE_ERROR');
  });
});

describe('parseArgs — roles', () => {
  it('--role sets the RBAC rank the router enforces', () => {
    const r = parseArgs(['status', '--role', 'VERIFIER']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.actorRole).toBe('VERIFIER');
  });

  it('an unknown role is rejected', () => {
    const r = parseArgs(['status', '--role', 'ADMIN']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PARSE_ERROR');
  });
});

describe('parseArgs — report (consent-required, EV4)', () => {
  it('report --text --consent produces a consented ReportCommand', () => {
    expect(cmd(['report', '--text', 'smoke on ridge', '--consent'])).toEqual({
      verb: 'report',
      consent: true,
      text: 'smoke on ridge',
    });
  });

  it('report with --lat/--lng stores location as [lon, lat]', () => {
    expect(cmd(['report', '--text', 'flooded road', '--consent', '--lat', '39.5', '--lng', '-121.6'])).toEqual({
      verb: 'report',
      consent: true,
      text: 'flooded road',
      location: [-121.6, 39.5],
    });
  });

  it('report WITHOUT --consent is rejected (consent is mandatory)', () => {
    const r = parseArgs(['report', '--text', 'no consent']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PARSE_ERROR');
    expect(r.error.message).toMatch(/consent/);
  });

  it('report without --text is rejected', () => {
    const r = parseArgs(['report', '--consent']);
    expect(r.ok).toBe(false);
  });

  it('a lone --lat without --lng is rejected', () => {
    const r = parseArgs(['report', '--text', 't', '--consent', '--lat', '39.5']);
    expect(r.ok).toBe(false);
  });

  it('non-numeric coordinates are rejected', () => {
    const r = parseArgs(['report', '--text', 't', '--consent', '--lat', 'x', '--lng', 'y']);
    expect(r.ok).toBe(false);
  });
});

describe('parseArgs — verify (decide)', () => {
  it('verify <reportId> <decision> carries a CLI actor id', () => {
    expect(cmd(['verify', 'rep-1', 'TRIAGED'])).toEqual({
      verb: 'verify',
      reportId: 'rep-1',
      decision: 'TRIAGED',
      actorId: 'cli-local-operator',
    });
  });

  it('an invalid decision is rejected', () => {
    const r = parseArgs(['verify', 'rep-1', 'MAYBE']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PARSE_ERROR');
  });

  it('verify missing its decision is rejected', () => {
    expect(parseArgs(['verify', 'rep-1']).ok).toBe(false);
  });
});

describe('parseArgs — alert:draft (act) and the emit boundary', () => {
  it('alert:draft <incidentId> --headline', () => {
    expect(cmd(['alert:draft', 'us-ca-wildfire-demo', '--headline', 'Evacuate zone A'])).toEqual({
      verb: 'alert:draft',
      incidentId: 'us-ca-wildfire-demo',
      headline: 'Evacuate zone A',
    });
  });

  it('alert:draft without --headline is rejected', () => {
    expect(parseArgs(['alert:draft', 'us-ca-wildfire-demo']).ok).toBe(false);
  });

  it('there is NO alert:send / alert:emit verb — it is an unknown command (T-454)', () => {
    for (const verb of ['alert:send', 'alert:emit', 'send']) {
      const r = parseArgs([verb, 'us-ca-wildfire-demo']);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe('PARSE_ERROR');
    }
  });
});

describe('parseArgs — malformed input', () => {
  it('an unknown verb is a typed PARSE_ERROR', () => {
    const r = parseArgs(['frobnicate']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PARSE_ERROR');
  });

  it('empty argv is rejected', () => {
    expect(parseArgs([]).ok).toBe(false);
  });
});
