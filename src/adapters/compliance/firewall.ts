// BEACON — semantic firewall (E6·T-264/T-266/T-278a; ADR-017/CM-C3-C4/LLM01/LLM05/AML.T0051).
// Heuristic, layered, FAIL-CLOSED. Runs over BOTH directions: ingested NL (input) and the model
// response (output). All ingested text is untrusted DATA, never instructions (THREAT §10.2). Layers:
//   (1) deterministic instruction-override / jailbreak regexes,
//   (2) unicode/bidi/zero-width evasion detection,
//   (3) policy-as-code blocked-command / SSRF / secret-file patterns (config/policies.yml).
// A hit short-circuits the pipeline (403) + audits with content redacted.
import type { CompiledPattern } from './types.js';

// Layer 1 — instruction-override / jailbreak heuristics (prompt-injection-defense.skill taxonomy).
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(the\s+)?(above|prior|previous|system)/i,
  /you\s+are\s+now\b/i,
  /system\s*prompt\b/i,
  /\bjailbreak\b/i,
  /\bDAN\b/,
  /reveal\s+(your\s+)?(system\s+)?(prompt|instructions?)/i,
  /(act|behave)\s+as\s+(an?\s+)?(unfiltered|unrestricted|developer|admin)/i,
  /new\s+instructions?\s*:/i,
  /override\s+(your\s+)?(safety|guardrails?|policy)/i,
];

// Layer 2 — bidi/zero-width/BOM characters used to smuggle hidden instructions: zero-width space..ZWNBSP
// (U+200B-U+200F), LTR/RTL embeds & overrides (U+202A-U+202E), directional isolates (U+2066-U+2069),
// and the BOM (U+FEFF). Built from escapes so no invisible bytes live in source.
const EVASION = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]');

export type FirewallKind = 'injection' | 'evasion' | 'blocked-command';
export interface FirewallHit {
  readonly kind: FirewallKind;
  readonly name: string;
}

/** Layer 1+2: injection / evasion scan (used on input AND output). Returns the first hit or null. */
export function scanInjection(text: string): FirewallHit | null {
  if (EVASION.test(text)) return { kind: 'evasion', name: 'unicode-bidi-zerowidth' };
  for (const re of INJECTION_PATTERNS) {
    if (re.test(text)) return { kind: 'injection', name: re.source.slice(0, 32) };
  }
  return null;
}

/** Layer 3: policy blocked-command / SSRF / secret-file patterns. Returns the first hit or null. */
export function scanBlockedCommands(text: string, patterns: readonly CompiledPattern[]): FirewallHit | null {
  for (const p of patterns) {
    if (p.re.test(text)) return { kind: 'blocked-command', name: p.name };
  }
  return null;
}

/** Full input firewall: injection/evasion first, then policy blocked-command patterns. */
export function scanInput(text: string, blocked: readonly CompiledPattern[]): FirewallHit | null {
  return scanInjection(text) ?? scanBlockedCommands(text, blocked);
}
