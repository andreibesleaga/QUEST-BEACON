// BEACON — outbound digest catalog tests (ADR-030 §7, FR-I18N-2/6; A4.3b). `renderDigest`'s "chrome"
// (labels: "trend", "citations", "sources", "freshness", "(no claim)") now comes from the message
// catalogs (`messages/*.json`, namespace `channels.digest`) via `digestChromeFor` (digest-i18n.ts) instead
// of hardcoded English literals. This file pins two things:
//   1. English / absent / unshipped locale renders BYTE-IDENTICAL to the pre-i18n hardcoded strings.
//   2. A shipped, translated locale actually changes the chrome (proves the catalog is really consulted)
//      while leaving every deterministic fact (field claims, source ids, ISO timestamps, "BEACON",
//      command.verb) untouched (Art. XII — never route a figure through a translator).
import { describe, it, expect } from 'vitest';
import type { Envelope } from '@/ports/interaction.js';
import { renderDigest } from './handle-inbound.js';

const NOW = '2026-07-05T22:00:00Z';

function sitrepEnvelope(): Envelope {
  return {
    data: {
      trend: 'ESCALATING',
      fields: [
        {
          field: 'situationInformation.exposureSummary',
          claim: '3 shelters within the hazard buffer',
        },
        { field: 'summary.headline' }, // no claim — exercises the "(no claim)" chrome
      ],
    },
    provenance: [{ sourceId: 'nws-nwps', mode: 'LIVE', fetchedAt: NOW }],
    citations: [{ field: 'situationInformation.exposureSummary', sourceId: 'src-1' }],
    freshness: NOW,
  };
}

/** The pre-i18n hardcoded-English digest, reproduced verbatim as the byte-identity baseline. */
function preI18nDigest(envelope: Envelope, verb: string): string {
  const data = envelope.data as {
    trend?: string;
    fields?: readonly { field: string; claim?: string }[];
  };
  const lines = (data.fields ?? []).map((f) => `- ${f.field}: ${f.claim ?? '(no claim)'}`);
  const trend = data.trend !== undefined ? `trend: ${data.trend}` : '';
  const body = [trend, ...lines].filter((s) => s.length > 0).join('\n');
  const parts: string[] = [`BEACON ${verb}`];
  if (verb === 'sitrep') parts.push(body);
  if (envelope.citations !== undefined && envelope.citations.length > 0) {
    parts.push(
      'citations: ' + envelope.citations.map((c) => `${c.field}<-${c.sourceId}`).join('; '),
    );
  }
  if (envelope.provenance.length > 0) {
    parts.push('sources: ' + envelope.provenance.map((p) => `${p.sourceId}(${p.mode})`).join(', '));
  }
  if (envelope.freshness !== undefined) parts.push(`freshness: ${envelope.freshness}`);
  return parts.filter((s) => s.length > 0).join('\n');
}

describe('renderDigest — English/absent locale is byte-identical to the pre-i18n hardcoded literals', () => {
  it('matches verbatim with no locale argument', async () => {
    const env = sitrepEnvelope();
    const digest = await renderDigest(
      env,
      { verb: 'sitrep', incidentId: 'inc-1' as never },
      undefined,
    );
    expect(digest).toBe(preI18nDigest(env, 'sitrep'));
  });

  it('matches verbatim with an explicit "en" locale', async () => {
    const env = sitrepEnvelope();
    const digest = await renderDigest(env, { verb: 'sitrep', incidentId: 'inc-1' as never }, 'en');
    expect(digest).toBe(preI18nDigest(env, 'sitrep'));
  });

  it('matches verbatim for an unshipped/hostile locale value (coerced to English, NFR-F7)', async () => {
    const env = sitrepEnvelope();
    const digest = await renderDigest(
      env,
      { verb: 'sitrep', incidentId: 'inc-1' as never },
      '../../etc/passwd',
    );
    expect(digest).toBe(preI18nDigest(env, 'sitrep'));
  });

  it('matches verbatim for a non-sitrep command (status), including the literal "BEACON" glossary term', async () => {
    const env: Envelope = {
      data: {},
      provenance: [{ sourceId: 'firms', mode: 'CACHED', fetchedAt: NOW }],
    };
    const digest = await renderDigest(env, { verb: 'status' }, undefined);
    expect(digest).toBe(preI18nDigest(env, 'status'));
    expect(digest.startsWith('BEACON status')).toBe(true);
  });
});

describe('renderDigest — a shipped, translated locale changes the chrome only', () => {
  it('renders Romanian labels around the SAME deterministic facts', async () => {
    const env = sitrepEnvelope();
    const digest = await renderDigest(env, { verb: 'sitrep', incidentId: 'inc-1' as never }, 'ro');

    // Chrome is translated (ro catalog: tendință / citări / proveniență / prospețime / fără afirmație).
    expect(digest).toContain('tendință: ESCALATING');
    expect(digest).toContain('citări:');
    expect(digest).toContain('proveniență:');
    expect(digest).toContain('prospețime: ' + NOW);
    expect(digest).toContain('(fără afirmație)');
    // English chrome words are gone.
    expect(digest).not.toContain('trend:');
    expect(digest).not.toContain('citations:');
    expect(digest).not.toContain('sources:');
    expect(digest).not.toContain('freshness:');

    // The deterministic facts, ids, and glossary tokens are UNCHANGED (Art. XII — never a figure through
    // a translator; "BEACON" and the command verb are closed-vocabulary/glossary, never translated).
    expect(digest).toContain('BEACON sitrep');
    expect(digest).toContain('3 shelters within the hazard buffer');
    expect(digest).toContain('situationInformation.exposureSummary<-src-1');
    expect(digest).toContain('nws-nwps(LIVE)');
    expect(digest).toContain(NOW);
  });
});
