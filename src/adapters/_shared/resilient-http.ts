// BEACON — Resilient HTTP client (E4·T-140/T-148; adapter-contract §3.1). Native fetch + per-call
// timeout, mapping HTTP status → typed AdapterError. The circuit breaker + retry/backoff wrap this in
// the redundancy engine; this layer just does ONE request and never leaks a raw Response upward.
import { isLinkOnlyUrl } from '@/domain/shared/link-policy.js';
import type { AdapterError } from './errors.js';
import { makeAdapterError } from './errors.js';

export interface HttpOptions {
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Hosts this ONE call is permitted to be redirected to, at most ONCE. Omitted (the default, and the
   * right answer for almost every adapter) means a 3xx is a failure, exactly as before.
   *
   * An entry is either an exact host (`data.humdata.org`) or a leading-dot suffix (`.amazonaws.com`).
   * See `redirectTarget` for what is refused regardless of what is listed here.
   */
  readonly followRedirectTo?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 8000;

/** GET a text/CSV body. Throws a typed AdapterError on non-2xx or network/timeout failure. */
export async function httpGetText(url: string, opts?: HttpOptions): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // `redirect: 'manual'` (SECURITY, SSRF hardening): a compromised/MITM'd upstream must not be able to
  // 3xx-redirect us to an internal address (169.254.169.254 / localhost). A 3xx surfaces as a non-2xx
  // response → statusError → typed UPSTREAM_UNAVAILABLE (the redundancy ladder then degrades), never a follow.
  //
  // `followRedirectTo` is the ONE narrow exception, added 2026-09-12 and opt-in per call. It exists
  // because some publishers hand out their files through a signed, expiring URL on another host — HDX
  // answers every download with a 302 to a presigned S3 link, so there is no static URL to configure and
  // the source is simply unreachable without following. The control is not weakened: the destination
  // must be https, must be a NAMED host on the caller's own allowlist, must not be an IP literal, and
  // gets exactly one hop. `redirect: 'manual'` stays on for the second request too, so a redirect chain
  // ends there.
  const init = requestInit(timeoutMs, opts);
  const first = await send(url, init);
  if (isRedirect(first.status)) {
    const next = redirectTarget(first, url, opts?.followRedirectTo);
    if (next === null) throw statusError(first.status, url);
    const second = await send(next, init);
    if (!second.ok) throw statusError(second.status, next);
    return second.text();
  }
  if (!first.ok) throw statusError(first.status, url);
  return first.text();
}

function requestInit(timeoutMs: number, opts?: HttpOptions): RequestInit {
  const init: RequestInit = {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (opts?.headers !== undefined) init.headers = opts.headers as Record<string, string>;
  return init;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw makeAdapterError('UPSTREAM_UNAVAILABLE', `network/timeout: ${msg(e)}`, {
      retryable: true,
      cause: e,
    });
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Where this redirect may be followed to — or `null`, which means "treat the 3xx as the failure it was".
 *
 * Every rule here is the SSRF control, not politeness:
 *   * an empty/absent allowlist refuses everything, so the default behaviour is unchanged;
 *   * the shared link policy (`isLinkOnlyUrl`) — absolute https, a NAMED host, bounded length — which is
 *     how `169.254.169.254`, `127.0.0.1` and `[::1]` are refused without keeping a list of private ranges
 *     current, and how a downgrade to plaintext is refused;
 *   * and the host must be one the CALLER named, either exactly or as a `.suffix` — the adapter that
 *     knows its publisher uses S3 says so; nothing else inherits that permission.
 */
export function redirectTarget(
  res: Response,
  requestUrl: string,
  allow: readonly string[] | undefined,
): string | null {
  if (allow === undefined || allow.length === 0) return null;
  const location = res.headers.get('location');
  if (location === null || location === '') return null;
  let target: URL;
  try {
    target = new URL(location, requestUrl);
  } catch {
    return null;
  }
  // The syntactic half of the rule is NOT re-declared here (F-153): `isLinkOnlyUrl` is the one home of
  // "absolute https, a NAMED host, bounded length", and its rule 2 exists for this exact attack — the
  // cloud-metadata pivot. Reusing it is necessary but explicitly NOT sufficient: that predicate governs
  // links BEACON displays and never fetches (ADR-028), and this URL is one we are about to request. The
  // allowlist below is what makes it safe to fetch, and no caller gets here without one.
  const href = target.toString();
  if (!isLinkOnlyUrl(href)) return null;
  const host = target.hostname.toLowerCase();
  const permitted = allow.some((entry) => {
    const e = entry.toLowerCase();
    return e.startsWith('.') ? host.endsWith(e) : host === e;
  });
  return permitted ? href : null;
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
