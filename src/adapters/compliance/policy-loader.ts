// BEACON — fail-fast policy-as-code loader (E6·T-241; ADR-017/F10/CM-C33).
// Loads config/policies.yml, validates it against schemas/policies.schema.json (Ajv draft 2020-12 +
// ajv-formats `regex`), and pre-compiles every PII / blocked-command regex (regex-compile boot check,
// D-29). ANY schema violation or un-compilable pattern aborts boot with a readable error — the gateway
// must never run against an invalid policy (U5/F10). Returns a typed, compiled Policy.
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import { compilePolicyRegex, isValidPolicyRegex } from './regex-util.js';
import type { CompiledPattern, CompiledPolicy, NamedPattern, Policy } from './types.js';

const DEFAULT_POLICIES_PATH = './config/policies.yml';
const DEFAULT_SCHEMA_PATH = './schemas/policies.schema.json';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** Compile a validated policy's named patterns to RegExp, failing fast on any un-compilable regex. */
function compilePatterns(patterns: readonly NamedPattern[], kind: string): readonly CompiledPattern[] {
  return patterns.map((p) => {
    try {
      return { name: p.name, re: compilePolicyRegex(p.regex) };
    } catch (cause) {
      throw new Error(`Invalid ${kind} regex '${p.name}' in policies.yml: ${(cause as Error).message}`);
    }
  });
}

/**
 * Load + validate + compile the policy bundle. Throws (fail-fast) on read/parse/schema/regex failure —
 * mirrors loadConfig()'s boot posture (src/config/index.ts).
 */
export function loadPolicy(
  policiesPath: string = DEFAULT_POLICIES_PATH,
  schemaPath: string = DEFAULT_SCHEMA_PATH,
): CompiledPolicy {
  const raw = parseYaml(readFileSync(policiesPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  // The `regex` format understands the policy dialect (PCRE inline flags) — see regex-util.ts.
  ajv.addFormat('regex', { type: 'string', validate: isValidPolicyRegex });
  const validate = ajv.compile(readJson(schemaPath) as object);
  if (!validate(raw)) {
    const issues = (validate.errors ?? [])
      .map((e) => `  - ${e.instancePath || '(root)'}: ${e.message ?? 'invalid'}`)
      .join('\n');
    throw new Error(`Invalid BEACON policies.yml (fail-fast at boot):\n${issues}`);
  }
  const policy = raw as Policy;
  return {
    policy,
    piiPatterns: compilePatterns(policy.pii.patterns, 'pii'),
    blockedPatterns: compilePatterns(policy.content_safety.blocked_command_patterns, 'blocked-command'),
  };
}
