// BEACON — Resilient HTTP client (E4·T-140/T-148; adapter-contract §3.1). Native fetch + per-call
// timeout, mapping HTTP status → typed AdapterError. The circuit breaker + retry/backoff wrap this in
// the redundancy engine; this layer just does ONE request and never leaks a raw Response upward.
import type { AdapterError } from './errors.js';
import { makeAdapterError } from './errors.js';

export interface HttpOptions {
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 8000;

/** GET a text/CSV body. Throws a typed AdapterError on non-2xx or network/timeout failure. */
export async function httpGetText(url: string, opts?: HttpOptions): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // `redirect: 'manual'` (SECURITY, SSRF hardening): a compromised/MITM'd upstream must not be able to
  // 3xx-redirect us to an internal address (169.254.169.254 / localhost). A 3xx surfaces as a non-2xx
  // response → statusError → typed UPSTREAM_UNAVAILABLE (the redundancy ladder then degrades), never a follow.
  const init: RequestInit = { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) };
  if (opts?.headers !== undefined) init.headers = opts.headers as Record<string, string>;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw makeAdapterError('UPSTREAM_UNAVAILABLE', `network/timeout: ${msg(e)}`, {
      retryable: true,
      cause: e,
    });
  }
  if (!res.ok) throw statusError(res.status, url);
  return res.text();
}

/** Map an HTTP status to the adapter-contract §1 error kinds. */
export function statusError(status: number, url: string): AdapterError {
  if (status === 429) {
    return makeAdapterError('RATE_LIMITED', `429 rate-limited: ${url}`, { retryable: true });
  }
  if (status === 401 || status === 403) {
    return makeAdapterError('AUTH', `${status} auth failure: ${url}`, { retryable: false });
  }
  return makeAdapterError('UPSTREAM_UNAVAILABLE', `HTTP ${status}: ${url}`, {
    retryable: status >= 500,
  });
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
