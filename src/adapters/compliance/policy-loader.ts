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
function compilePatterns(
  patterns: readonly NamedPattern[],
  kind: string,
): readonly CompiledPattern[] {
  return patterns.map((p) => {
    try {
      return { name: p.name, re: compilePolicyRegex(p.regex) };
    } catch (cause) {
      throw new Error(
        `Invalid ${kind} regex '${p.name}' in policies.yml: ${(cause as Error).message}`,
      );
    }
  });
}

/**
 * Apply the four documented budget environment variables over the policy file.
 *
 * WHY THIS EXISTS. `BUDGET_PER_INCIDENT_USD`, `BUDGET_PER_REGION_USD`,
 * `BUDGET_ESCALATION_THRESHOLD_USD` and `REQUIRE_HUMAN_ABOVE_THRESHOLD` were documented in both
 * `.env.example` and `CONFIGURATION.md` and read by NO code (documentation audit, 2026-09-11).
 * Enforcement ran solely off `config/policies.yml`, so an operator who capped regional spend at ten
 * dollars in the Railway variable store — the only surface a hosted deployment gives them — was still
 * governed by the fifty baked into the image, and nothing said so. A spending limit that silently does
 * nothing is a defect with consequences outside this competition.
 *
 * The env var WINS, per the project's own config law ("config for everything; nothing hardcoded"): the
 * YAML is the shipped default, the environment is the operator's override.
 *
 * A malformed value FAILS THE BOOT rather than falling back to the file. Falling back would recreate the
 * original defect in its most dangerous form — the operator asked for a limit, got a different one, and
 * was not told. Fail-fast matches `loadConfig`'s posture and every other validated value in this system.
 */
function applyBudgetEnv(policy: Policy, env: Readonly<Record<string, string | undefined>>): Policy {
  const num = (key: string, current: number): number => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === '') return current;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(
        `Invalid ${key}='${raw}' — expected a non-negative number (fail-fast at boot)`,
      );
    }
    return n;
  };
  // on/off IS THE PROJECT'S VOCABULARY — `.env.example` documents this variable as `on`, CONFIGURATION.md
  // lists it as `on | off`, sixteen other flags use the same pair, and the live variable store held `on`.
  // The first version of this parser accepted only true/false and threw on everything else. It merged on
  // 2026-09-11 and took the live deployment down within the hour: every API request loads the policy, the
  // loader threw on the documented value, and login, sources, health and the SitRep all returned 500.
  // Fail-fast was the right posture; rejecting the documented spelling was not. true/false stay accepted.
  const bool = (key: string, current: boolean): boolean => {
    const raw = env[key]?.trim().toLowerCase();
    if (raw === undefined || raw === '') return current;
    if (raw === 'on' || raw === 'true') return true;
    if (raw === 'off' || raw === 'false') return false;
    throw new Error(`Invalid ${key}='${env[key]}' — expected 'on' or 'off' (fail-fast at boot)`);
  };
  const b = policy.budget;
  return {
    ...policy,
    budget: {
      per_incident_usd: num('BUDGET_PER_INCIDENT_USD', b.per_incident_usd),
      per_region_usd: num('BUDGET_PER_REGION_USD', b.per_region_usd),
      escalation_threshold_usd: num('BUDGET_ESCALATION_THRESHOLD_USD', b.escalation_threshold_usd),
      require_human_above_threshold: bool(
        'REQUIRE_HUMAN_ABOVE_THRESHOLD',
        b.require_human_above_threshold,
      ),
    },
  };
}

/**
 * Load + validate + compile the policy bundle. Throws (fail-fast) on read/parse/schema/regex failure —
 * mirrors loadConfig()'s boot posture (src/config/index.ts).
 */
export function loadPolicy(
  policiesPath: string = DEFAULT_POLICIES_PATH,
  schemaPath: string = DEFAULT_SCHEMA_PATH,
  env: Readonly<Record<string, string | undefined>> = process.env,
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
  // Validate the FILE first, then let the operator's environment override the budget block. Order
  // matters: the schema is what guarantees the shape these overrides are merged into.
  const policy = applyBudgetEnv(raw as Policy, env);
  return {
    policy,
    piiPatterns: compilePatterns(policy.pii.patterns, 'pii'),
    blockedPatterns: compilePatterns(
      policy.content_safety.blocked_command_patterns,
      'blocked-command',
    ),
  };
}
