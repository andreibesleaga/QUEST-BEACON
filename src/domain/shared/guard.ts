// BEACON — domain guard helpers (E1 clean-code kernel). Keep entity factories linear & under the
// complexity ceiling (Gate 6) without weakening any invariant. Pure TS — no framework imports (F9).
import { InvariantViolation } from '../errors.js';

/**
 * Assert a domain invariant. Throws {@link InvariantViolation} with `message` when `condition` is
 * falsy. The `asserts condition` signature also narrows the type for the compiler, so a factory reads
 * as a straight-line list of invariants instead of a branch tree.
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantViolation(message);
}

/**
 * Shallow copy of `obj` with every `undefined`-valued key removed. Lets a factory assemble an entity
 * in one object literal under `exactOptionalPropertyTypes` — optional fields carrying `undefined` are
 * dropped rather than set to `undefined` — replacing N per-field conditional spreads (each of which
 * costs a branch). The runtime prune makes the `as T` at the call site sound.
 */
export function definedOnly<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}
