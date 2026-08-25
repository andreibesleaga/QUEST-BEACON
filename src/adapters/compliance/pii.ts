// BEACON — PII detect + redact stage (E6·T-272/T-274/T-278a; ADR-017/CM-C8/LLM02/EU-AI-Act-Art.10).
// FAIL-CLOSED: no raw PII ever egresses to a cloud LLM (Art. IV). Actions per policies.yml:
//   redact = swap for a class-only placeholder token; block = short-circuit 403; hash = one-way marker.
// Only the PII CLASS name is ever surfaced/logged — never the matched value (Art. IV, no PII in logs).
// The SAME detector screens the model RESPONSE (output firewall, T-278a) — one PII implementation.
//
// SECURITY (Art. IV): the redaction token carries NO value-derived suffix. An earlier design appended
// an UNKEYED 32-bit FNV hash of the matched value (`[REDACTED:<class>:<fnv32>]`). For low-entropy PII
// (phone / SSN / short name) that 8-hex suffix is trivially brute-forceable OFFLINE — the very upstream
// LLM we redact from could invert the token and recover the original value, defeating the guarantee.
// The model needs no consistent per-value token to narrate safely, so the suffix is dropped entirely:
// the token is `[REDACTED:<class>]` (nothing left to reverse). Detect/redact classes + fail-closed intact.
import type { CompiledPattern, PiiAction } from './types.js';

export interface PiiOutcome {
  readonly text: string; // redacted/hashed text (unchanged on block or no-match)
  readonly matches: readonly string[]; // PII class names only (never values)
  readonly blocked: boolean; // true when action=block and PII was present
}

// Class-only placeholder — deliberately value-INDEPENDENT so nothing about the matched value survives
// (no offline-reversible suffix). `hash` marks a one-way scrub; both erase the value equally.
function tokenFor(action: 'redact' | 'hash', name: string): string {
  return action === 'hash' ? `[PII:${name}]` : `[REDACTED:${name}]`;
}

// Force a global copy of a compiled pattern so replace/scan spans every occurrence (stateless per call).
function globalize(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
}

/** Detect PII classes present in text (class names only). */
export function detectPii(text: string, patterns: readonly CompiledPattern[]): readonly string[] {
  return patterns.filter((p) => globalize(p.re).test(text)).map((p) => p.name);
}

/** Apply the policy PII action to text before egress. block => blocked:true (caller short-circuits 403). */
export function applyPii(text: string, patterns: readonly CompiledPattern[], action: PiiAction): PiiOutcome {
  const matches = detectPii(text, patterns);
  if (matches.length === 0) return { text, matches, blocked: false };
  if (action === 'block') return { text, matches, blocked: true };
  const swap = action === 'hash' ? 'hash' : 'redact';
  let out = text;
  for (const p of patterns) out = out.replace(globalize(p.re), () => tokenFor(swap, p.name));
  return { text: out, matches, blocked: false };
}

export interface DeepPiiOutcome {
  readonly value: unknown; // structurally-identical value with every string field redacted/hashed
  readonly matches: readonly string[];
  readonly blocked: boolean;
}

/** Deep-walk a payload (NarrativeRequest, VisionRequest, model response) redacting every string field. */
export function redactDeep(value: unknown, patterns: readonly CompiledPattern[], action: PiiAction): DeepPiiOutcome {
  const found = new Set<string>();
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const r = applyPii(node, patterns, action);
      for (const m of r.matches) found.add(m);
      return r.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  const redacted = walk(value);
  const matches = [...found];
  return { value: redacted, matches, blocked: action === 'block' && matches.length > 0 };
}
