// BEACON — GET /.well-known/sustainability (E7·T-342; FR-14, ADR-020). A STANDALONE, non-blocking, heavily
// cacheable plugin endpoint: it does NOT touch the core, the envelope, or the compliance proxy. BEACON
// publishes ESTIMATED / MODELED figures only (measurement-method=third-party-modeled), validated against
// schemas/sustainability-v05.schema.json before it is returned (schema-valid-by-construction).
import { validatorForFile } from '@/adapters/interop/schema-validator.js';
import type { HttpResponse } from './http-types.js';
import { channelErrorEnvelope } from './error-mapping.js';

const SCHEMA_PATH = 'schemas/sustainability-v05.schema.json';

/**
 * The four `SUSTAINABILITY_*` settings (docs/architecture/CONFIGURATION.md). They were documented, and set
 * on the live deployment, from the day the endpoint shipped — and read by nothing: every value below was
 * a constant, so the deployment published `sustain@beacon.local` and a relative methodology link that
 * resolves to a 404 on its own origin (found 2026-11-21). An unset or blank variable keeps the value the
 * endpoint has always served, so a deployment that sets none of them is byte-identical to before.
 */
export type SustainabilityEnv = Readonly<Record<string, string | undefined>>;

const DEFAULTS = {
  provider: 'BEACON (sustain@beacon.local)',
  method: 'third-party-modeled',
  methodologyUri: 'docs/SUSTAINABILITY.md',
} as const;

const setting = (env: SustainabilityEnv, name: string, fallback: string): string => {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? fallback : value;
};

/** A deterministic modeled sustainability report (no per-request compute; heavily cached). */
function buildReport(updated: string, env: SustainabilityEnv): Record<string, unknown> {
  return {
    version: '1.0',
    updated,
    capabilities: 'basic',
    provider: setting(env, 'SUSTAINABILITY_PROVIDER', DEFAULTS.provider),
    'measurement-method': setting(env, 'SUSTAINABILITY_MEASUREMENT_METHOD', DEFAULTS.method),
    'methodology-uri': setting(env, 'SUSTAINABILITY_METHODOLOGY_URI', DEFAULTS.methodologyUri),
    'reporting-period': updated.slice(0, 7), // YYYY-MM — most recently modeled month
    'energy-consumption': 12.5,
    'energy-unit': 'kWh',
    'carbon-footprint': 3.4,
    'carbon-unit': 'kgCO2e',
    'carbon-accounting': 'location-based',
    'carbon-intensity-gCO2-per-kWh': 272,
    'renewable-energy': 41,
  };
}

/** A weak ETag over the report's stable content (freshness anchor = `updated`). */
function weakEtag(report: Record<string, unknown>): string {
  return `W/"sustain-${String(report.updated)}"`;
}

/**
 * Build the sustainability response. Validates the modeled report against the v05 schema (Ajv 2020, reused
 * from the interop validator). Always non-blocking: on the (should-never-happen) validation miss it returns
 * a 500 error envelope rather than leaking an invalid document.
 */
export function handleSustainability(
  clock: () => string,
  env: SustainabilityEnv = {},
): HttpResponse {
  // `SUSTAINABILITY_ENABLED=off` switches the plugin off: the path then answers like any unknown path.
  if (env.SUSTAINABILITY_ENABLED?.trim().toLowerCase() === 'off') {
    return {
      status: 404,
      body: channelErrorEnvelope('NOT_FOUND', 'no such route'),
      headers: { 'content-type': 'application/json' },
    };
  }
  const report = buildReport(clock(), env);
  const validate = validatorForFile(SCHEMA_PATH);
  if (!validate(report)) {
    return {
      status: 500,
      body: channelErrorEnvelope('INTERNAL_ERROR', 'sustainability report failed self-validation'),
      headers: { 'content-type': 'application/json' },
    };
  }
  return {
    status: 200,
    body: report,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=86400',
      etag: weakEtag(report),
    },
  };
}
