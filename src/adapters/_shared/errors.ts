// BEACON — Adapter-layer error taxonomy (E4·T-130). The typed failures an adapter returns across the
// anti-corruption boundary; adapters NEVER throw raw upstream errors into the domain (AGENTS.md §4,
// adapter-contract §1). Distinct from domain errors: these describe *source integration* failure modes.

export const ADAPTER_ERROR_KINDS = [
  'UPSTREAM_UNAVAILABLE', // network / 5xx / timeout
  'RATE_LIMITED', // 429 / quota
  'AUTH', // missing/invalid key
  'PARSE', // ACL mapping / schema failure (never silently dropped)
  'NOT_COVERED', // region outside adapter coverage (OP4)
  'CIRCUIT_OPEN', // breaker is open; a fallback rung was served
  'CONFIG', // invalid/missing required config (fail-fast)
] as const;

export type AdapterErrorKind = (typeof ADAPTER_ERROR_KINDS)[number];

export interface AdapterError {
  readonly kind: AdapterErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}

// Retryable-by-default policy per kind (adapter-contract §3.1 — bounded retry on retryable failures).
const DEFAULT_RETRYABLE: Record<AdapterErrorKind, boolean> = {
  UPSTREAM_UNAVAILABLE: true,
  RATE_LIMITED: true,
  AUTH: false,
  PARSE: false,
  NOT_COVERED: false,
  CIRCUIT_OPEN: false,
  CONFIG: false,
};

export interface AdapterErrorOptions {
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

/** Construct a typed AdapterError; `retryable` defaults per kind, `cause` omitted when absent. */
export function makeAdapterError(
  kind: AdapterErrorKind,
  message: string,
  opts?: AdapterErrorOptions,
): AdapterError {
  const retryable = opts?.retryable ?? DEFAULT_RETRYABLE[kind];
  return opts?.cause === undefined
    ? { kind, message, retryable }
    : { kind, message, retryable, cause: opts.cause };
}

/** Structural type guard so cockatiel-rethrown values can be classified without instanceof. */
export function isAdapterError(v: unknown): v is AdapterError {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.message === 'string' &&
    typeof o.retryable === 'boolean' &&
    ADAPTER_ERROR_KINDS.includes(o.kind as AdapterErrorKind)
  );
}

/** Best-effort message extraction from an unknown thrown value. */
export function errorMessage(e: unknown): string {
  if (isAdapterError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
