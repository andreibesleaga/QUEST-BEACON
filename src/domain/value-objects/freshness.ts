// BEACON — Freshness value object (E1·T-042). A validated fetch timestamp; provenance anchor.
import { InvariantViolation } from '../errors.js';

export interface Freshness {
  readonly fetchedAt: string; // ISO-8601 UTC
}

/** Construct a Freshness; rejects NaN / future timestamps (clock-skew guard). */
export function makeFreshness(fetchedAt: string, now: number = Date.parse(new Date().toISOString())): Freshness {
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) throw new InvariantViolation(`Freshness.fetchedAt is not a valid date: ${fetchedAt}`);
  if (t > now + 60_000) throw new InvariantViolation(`Freshness.fetchedAt is in the future: ${fetchedAt}`);
  return { fetchedAt };
}
