// BEACON — messaging NL-lite parser tests (E10·T-455/T-459). Deterministic; pure over input text.
import { describe, it, expect } from 'vitest';
import { parseMessageToCommand } from './parse.js';

describe('parseMessageToCommand — canonical command mapping', () => {
  it('maps "status" and "sources" to their verbs', () => {
    const s = parseMessageToCommand('status');
    const src = parseMessageToCommand('  Sources  ');
    expect(s.ok && s.value.verb).toBe('status');
    expect(src.ok && src.value.verb).toBe('sources');
  });

  it('maps "sitrep <incidentId>" to a sitrep command carrying the id verbatim', () => {
    const r = parseMessageToCommand('sitrep ro-flood-demo');
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.verb !== 'sitrep') return;
    expect(r.value.incidentId).toBe('ro-flood-demo');
  });

  it('rejects "sitrep" with no incidentId as a typed PARSE_ERROR', () => {
    const r = parseMessageToCommand('sitrep');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PARSE_ERROR');
  });

  it('maps "report <text> consent" to a CONSENTED report (explicit affirmation)', () => {
    const r = parseMessageToCommand('report water rising near the river consent');
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.verb !== 'report') return;
    expect(r.value.consent).toBe(true);
    expect(r.value.text).toContain('water rising');
  });

  it('rejects a report WITHOUT an explicit consent affirmation (consent never implied)', () => {
    const r = parseMessageToCommand('report water rising near the river');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PARSE_ERROR');
    expect(r.error.message).toMatch(/consent/i);
  });

  it('rejects unknown input as a typed PARSE_ERROR (never guesses a number/ranking)', () => {
    const r = parseMessageToCommand('rank the incidents by severity');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PARSE_ERROR');
  });
});
