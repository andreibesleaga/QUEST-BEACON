// BEACON — GET /.well-known/sustainability (E7·T-342; FR-14, ADR-020). A STANDALONE, non-blocking, heavily
// cacheable plugin endpoint: it does NOT touch the core, the envelope, or the compliance proxy. BEACON
// publishes ESTIMATED / MODELED figures only (measurement-method=third-party-modeled), validated against
// schemas/sustainability-v05.schema.json before it is returned (schema-valid-by-construction).
import { validatorForFile } from '@/adapters/interop/schema-validator.js';
import type { HttpResponse } from './http-types.js';
import { channelErrorEnvelope } from './error-mapping.js';

const SCHEMA_PATH = 'schemas/sustainability-v05.schema.json';
const METHODOLOGY_URI = 'docs/SUSTAINABILITY.md';

/** A deterministic modeled sustainability report (no per-request compute; heavily cached). */
function buildReport(updated: string): Record<string, unknown> {
  return {
    version: '1.0',
    updated,
    capabilities: 'basic',
    provider: 'BEACON (sustain@beacon.local)',
    'measurement-method': 'third-party-modeled',
    'methodology-uri': METHODOLOGY_URI,
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
export function handleSustainability(clock: () => string): HttpResponse {
  const report = buildReport(clock());
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
