// BEACON — governance parameters: TYPES + fail-fast parser (MW-D/D4; ADR-034 §5/§6, ADR-012).
//
// The values live in `config/governance.json` and are validated by `schemas/governance.schema.json` — this
// module holds NO governance literal. Same split as `likelihood-config.ts`: a hand-written parser (this
// module is imported by PURE use-cases, so it may not read the filesystem; the config is a static import)
// plus a test that enforces the JSON-Schema against the shipped file. The parser additionally enforces the
// properties a JSON-Schema cannot express — here, the SOP-chain invariants in
// `assertValidSopChain` (both roles approver-capable, fallback distinct from primary, positive window).
import type { SopChainConfig } from '@/domain/governance.js';
import { APPROVER_ROLES, assertValidSopChain, isApproverRole } from '@/domain/governance.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { APP_USER_ROLES } from '@/domain/app-user.js';
import type { DrillMode } from '@/domain/drill.js';
import { DRILL_MODES } from '@/domain/drill.js';
import governanceJson from '../../../config/governance.json';

/** Art. XIV retention parameters the sweep executor enforces (finding F-25). */
export interface RetentionConfig {
  readonly publicReportRetentionDays: number;
  readonly sweepGraceMinutes: number;
}

export interface GovernanceConfig {
  readonly version: number;
  readonly authority: string;
  readonly approval: SopChainConfig;
  readonly retention: RetentionConfig;
  readonly drillMode: DrillMode;
}

/** Config-validation failure. Fail fast and loudly: a wrong approval role silently changes who may act. */
function requireConfig(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid config/governance.json: ${message}`);
}

// Permissive views of the raw file — mirrors the RawRegion / RawConfig approach used elsewhere.
interface RawBlock {
  readonly [key: string]: unknown;
}
interface RawGovernance {
  readonly version?: unknown;
  readonly authority?: unknown;
  readonly approval?: RawBlock;
  readonly retention?: RawBlock;
  readonly drill?: RawBlock;
}

function text(v: unknown, what: string): string {
  requireConfig(typeof v === 'string' && v.trim().length > 0, `${what} must be a non-empty string`);
  return v as string;
}

function wholeNumber(v: unknown, what: string, min: number): number {
  requireConfig(
    typeof v === 'number' && Number.isInteger(v) && v >= min,
    `${what} must be an integer >= ${min}, got ${String(v)}`,
  );
  return v as number;
}

function positiveNumber(v: unknown, what: string): number {
  requireConfig(
    typeof v === 'number' && Number.isFinite(v) && v > 0,
    `${what} must be a positive finite number, got ${String(v)}`,
  );
  return v as number;
}

function approverRole(v: unknown, what: string): AppUserRole {
  requireConfig(
    typeof v === 'string' && (APP_USER_ROLES as readonly string[]).includes(v),
    `${what} must be one of ${APP_USER_ROLES.join('|')}, got ${String(v)}`,
  );
  const role = v as AppUserRole;
  requireConfig(
    isApproverRole(role),
    `${what} must carry approval authority (${APPROVER_ROLES.join('|')}), got ${role} (Art. XIII)`,
  );
  return role;
}

function parseApproval(raw: RawBlock | undefined): SopChainConfig {
  requireConfig(typeof raw === 'object' && raw !== null, 'approval must be an object');
  const block = raw as RawBlock;
  text(block.basis, 'approval.basis');
  const config: SopChainConfig = {
    authorizerRole: approverRole(
      block.authorizerRole,
      'approval.authorizerRole',
    ) as SopChainConfig['authorizerRole'],
    fallbackRole: approverRole(
      block.fallbackRole,
      'approval.fallbackRole',
    ) as SopChainConfig['fallbackRole'],
    fallbackAfterMinutes: positiveNumber(
      block.fallbackAfterMinutes,
      'approval.fallbackAfterMinutes',
    ),
  };
  // The invariants no JSON-Schema can state (cross-field), enforced by the DOMAIN so an EAP-supplied
  // override (lane D2) is held to exactly the same bar as the shipped file.
  assertValidSopChain(config, 'approval');
  return config;
}

function parseRetention(raw: RawBlock | undefined): RetentionConfig {
  requireConfig(typeof raw === 'object' && raw !== null, 'retention must be an object');
  const block = raw as RawBlock;
  text(block.basis, 'retention.basis');
  return {
    publicReportRetentionDays: wholeNumber(
      block.publicReportRetentionDays,
      'retention.publicReportRetentionDays',
      1,
    ),
    sweepGraceMinutes: wholeNumber(block.sweepGraceMinutes, 'retention.sweepGraceMinutes', 0),
  };
}

function parseDrillMode(raw: RawBlock | undefined): DrillMode {
  requireConfig(typeof raw === 'object' && raw !== null, 'drill must be an object');
  const block = raw as RawBlock;
  text(block.basis, 'drill.basis');
  requireConfig(
    typeof block.mode === 'string' && (DRILL_MODES as readonly string[]).includes(block.mode),
    `drill.mode must be one of ${DRILL_MODES.join('|')}, got ${String(block.mode)}`,
  );
  return block.mode as DrillMode;
}

/**
 * Parse + validate the governance parameters. Throws on any violation — a half-valid governance file is
 * worse than none, because every decision it governs still looks authoritative.
 */
export function parseGovernanceConfig(raw: unknown): GovernanceConfig {
  requireConfig(typeof raw === 'object' && raw !== null, 'the file must contain a JSON object');
  const cfg = raw as RawGovernance;
  requireConfig(cfg.version === 1, `version must be 1, got ${String(cfg.version)}`);
  return {
    version: 1,
    authority: text(cfg.authority, 'authority'),
    approval: parseApproval(cfg.approval),
    retention: parseRetention(cfg.retention),
    drillMode: parseDrillMode(cfg.drill),
  };
}

/**
 * The SHIPPED governance parameters, parsed at import time (fail-fast: a bad config breaks the build's
 * first test, not an approval decision under load). Injectable everywhere — every entry point takes a
 * `GovernanceConfig`/`SopChainConfig` and only DEFAULTS to this one.
 */
export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = parseGovernanceConfig(governanceJson);
