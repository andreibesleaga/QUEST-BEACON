// BEACON — bilingual alert-broadcast headline tests (channels.alert catalog; Art. XII/XVI).
// Deterministic: catalog ICU rendering only, no LLM, no network, no clock.
import { describe, it, expect } from 'vitest';
import { alertHeadlineFor } from './digest-i18n.js';

const PARAMS = {
  severity: 'SEVERE',
  category: 'Fire',
  incidentId: 'us-ca-wildfire-demo',
  alertId: 'ca-alert-draft-1',
} as const;

describe('alertHeadlineFor — the broadcast headline, localized by catalog (never an LLM)', () => {
  it('renders the English template with every engine fact verbatim', async () => {
    const line = await alertHeadlineFor('en', PARAMS);
    expect(line).toBe('BEACON ALERT — SEVERE Fire for incident us-ca-wildfire-demo (alert ca-alert-draft-1)');
  });

  it('localizes the CHROME but keeps enum tokens/ids as engine facts (Art. XII)', async () => {
    const line = await alertHeadlineFor('ro', PARAMS);
    expect(line).toContain('ALERTĂ BEACON');
    // The facts must survive translation byte-for-byte — a translated severity is a changed meaning.
    expect(line).toContain('SEVERE');
    expect(line).toContain('Fire');
    expect(line).toContain('us-ca-wildfire-demo');
    expect(line).toContain('ca-alert-draft-1');
  });

  it('coerces an unknown/hostile locale to English (allowlist, NFR-F7) rather than failing', async () => {
    const line = await alertHeadlineFor('../../etc/passwd', PARAMS);
    expect(line).toContain('BEACON ALERT');
    expect(line).toContain('SEVERE');
  });

  it('absent locale means English — the pre-feature broadcast byte-identically', async () => {
    expect(await alertHeadlineFor(undefined, PARAMS)).toBe(await alertHeadlineFor('en', PARAMS));
  });
});
