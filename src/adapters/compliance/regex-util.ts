// BEACON — policy-regex dialect compiler (E6·T-241 support; ADR-017).
// config/policies.yml authors detection patterns with PCRE-style leading inline flag groups (e.g.
// `(?i)` case-insensitive), which ECMAScript `RegExp` does not accept inline. This translates a policy
// pattern into a JS RegExp by lifting pure inline-flag groups into RegExp flags — so the authored
// intent (case-insensitive SSRF/secret matching) is preserved WITHOUT editing the authoritative policy.
// A genuinely malformed pattern still throws (fail-fast regex-compile boot check, D-29).

// A pure inline-flag group: `(?i)`, `(?im)`, `(?is)` … (letters only, no capture/colon).
const INLINE_FLAG_GROUP = /\(\?([a-z]+)\)/g;
const JS_SUPPORTED_FLAGS = new Set(['i', 'm', 's', 'u', 'y', 'd']);

/** Compile a policy pattern (PCRE-inline-flag dialect) to an ECMAScript RegExp. Throws on a bad pattern. */
export function compilePolicyRegex(pattern: string): RegExp {
  let flags = '';
  const body = pattern.replace(INLINE_FLAG_GROUP, (_match, letters: string) => {
    for (const c of letters) if (JS_SUPPORTED_FLAGS.has(c) && !flags.includes(c)) flags += c;
    return '';
  });
  return new RegExp(body, flags);
}

/** True when a pattern compiles under the policy dialect (used as Ajv's `regex` format validator). */
export function isValidPolicyRegex(pattern: string): boolean {
  try {
    compilePolicyRegex(pattern);
    return true;
  } catch {
    return false;
  }
}
