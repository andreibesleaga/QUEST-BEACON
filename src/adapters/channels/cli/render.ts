// BEACON — CLI renderers (E10·T-453). Turn the universal Envelope into either raw JSON (--json) or a
// compact human view. The human view ALWAYS surfaces provenance (source + mode + freshness) and, for a
// SitRep, the citations[] (field → sourceId) — the F1/F2 transparency guarantees are visible on every
// channel, not just the web COP (ADR-023 §guarantees). Pure string formatting: no IO here.
import type { Envelope, SourceRef, CitationView } from '@/ports/interaction.js';

/** Raw Envelope as pretty JSON — the machine-readable view (`--json`). */
export function renderJson(env: Envelope): string {
  return JSON.stringify(env, null, 2);
}

/** Compact human view. On an error envelope, prints the typed code + message and nothing else. */
export function renderHuman(env: Envelope): string {
  if (env.errors && env.errors.length > 0) {
    return env.errors.map((e) => `ERROR [${e.code}] ${e.message}`).join('\n');
  }
  const lines: string[] = [`data: ${JSON.stringify(env.data)}`];
  lines.push(...renderProvenance(env.provenance, env.freshness));
  if (env.citations && env.citations.length > 0) lines.push(...renderCitations(env.citations));
  const note = env.meta?.['note'];
  if (typeof note === 'string') lines.push(`note: ${note}`);
  return lines.join('\n');
}

function renderProvenance(provenance: readonly SourceRef[], freshness: string | undefined): string[] {
  const lines = ['provenance:'];
  if (provenance.length === 0) lines.push('  (none)');
  for (const p of provenance) lines.push(`  • ${p.sourceId} [${p.mode}] fetched ${p.fetchedAt}`);
  lines.push(`freshness: ${freshness ?? 'n/a'}`);
  return lines;
}

function renderCitations(citations: readonly CitationView[]): string[] {
  const lines = ['citations:'];
  for (const c of citations) lines.push(`  • ${c.field} → ${c.sourceId}`);
  return lines;
}
