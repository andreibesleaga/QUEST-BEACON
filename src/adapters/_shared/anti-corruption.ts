// BEACON — Anti-corruption mapping runner (E4·T-131; adapter-contract §4, ADR-001). Runs a pure mapper
// over raw upstream rows, pairing each canonical entity with its shared provenance. A row the mapper
// cannot map surfaces a typed PARSE — NEVER silently dropped (Art. XI/XII grounding guarantee).
import type { AntiCorruptionMapper, CanonicalRecord, MapContext, SourceRecord } from './contract.js';
import { isAdapterError, makeAdapterError, errorMessage } from './errors.js';

/**
 * Map every raw row to a CanonicalRecord. Re-raises an AdapterError as-is; wraps any other throw
 * (e.g. a domain InvariantViolation from a factory) as PARSE so the failure is typed, not raw.
 */
export function mapRows<Raw, T>(
  rows: readonly Raw[],
  mapper: AntiCorruptionMapper<Raw, T>,
  ctx: MapContext,
  provenance: SourceRecord,
): CanonicalRecord<T>[] {
  return rows.map((raw) => ({ entity: mapOne(raw, mapper, ctx), provenance }));
}

function mapOne<Raw, T>(raw: Raw, mapper: AntiCorruptionMapper<Raw, T>, ctx: MapContext): T {
  try {
    return mapper.toCanonical(raw, ctx);
  } catch (e) {
    if (isAdapterError(e)) throw e;
    throw makeAdapterError('PARSE', `ACL mapping failed: ${errorMessage(e)}`, { cause: e });
  }
}
