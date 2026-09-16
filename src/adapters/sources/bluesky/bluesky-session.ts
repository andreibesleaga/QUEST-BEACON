// BEACON — Bluesky authenticated session client (S2·Lane-A1; ADR-009/Art. XVI, adapter-contract §3.1).
// The BYO-ACCOUNT rung for the bluesky adapter (LIVE_DEMO_DELIVERY_PLAN §0 decision 10).
//
// WHY THIS EXISTS: the keyless public AppView (`public.api.bsky.app`) began returning 403 for
// `app.bsky.feed.searchPosts` from datacenter IPs (recorded in DATA_SOURCE_VERIFICATION / the bluesky
// fixture note), so the only honest live rung left is an authenticated one. Auth is AT Protocol standard:
// `com.atproto.server.createSession` with an APP PASSWORD (never the account password) returns an
// accessJwt + refreshJwt; the accessJwt is short-lived, so an expiring session is REFRESHED
// (`com.atproto.server.refreshSession`) and, if the refresh token is dead too, re-created — once, then the
// failure is honest and the redundancy ladder degrades. MOCK stays the adapter's default: this rung only
// engages when an operator brings their own account.
//
// `fetchImpl` is injected (defaulting to the platform `fetch`) so the whole session lifecycle — create,
// 401, refresh, retry, refresh-dead → re-create — is exercised deterministically with NO live network in
// any test (the same seam `adapters/ai/http-client.ts` uses).
import type { AdapterError } from '@/adapters/_shared/index.js';
import { makeAdapterError, statusError } from '@/adapters/_shared/index.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BlueskyCredentials {
  readonly identifier: string; // handle or DID, e.g. beacon-demo.bsky.social
  readonly appPassword: string; // APP PASSWORD from bsky.app settings — never the account password
}

export interface BlueskySessionDeps {
  readonly credentials: BlueskyCredentials;
  readonly serviceUrl?: string; // the PDS that issues the session; defaults to https://bsky.social
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

interface Session {
  readonly accessJwt: string;
  readonly refreshJwt: string;
}

export const DEFAULT_BLUESKY_SERVICE_URL = 'https://bsky.social';
const DEFAULT_TIMEOUT_MS = 8000;

export class BlueskySessionClient {
  private readonly credentials: BlueskyCredentials;
  private readonly serviceUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private session: Session | undefined;

  constructor(deps: BlueskySessionDeps) {
    this.credentials = deps.credentials;
    this.serviceUrl = (deps.serviceUrl ?? DEFAULT_BLUESKY_SERVICE_URL).replace(/\/+$/, '');
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Authenticated GET returning the raw body. One 401 is absorbed by renewing the session and retrying
   * exactly once — a second failure is thrown as a typed AdapterError so the ladder degrades honestly
   * (never an unbounded refresh loop).
   */
  async getText(url: string): Promise<string> {
    const res = await this.authedGet(url, (await this.ensureSession()).accessJwt);
    if (res.status !== 401) return this.readOk(res, url);
    const renewed = await this.renew();
    const retry = await this.authedGet(url, renewed.accessJwt);
    return this.readOk(retry, url);
  }

  private async readOk(res: Response, url: string): Promise<string> {
    if (!res.ok) throw statusError(res.status, url);
    return res.text();
  }

  private async ensureSession(): Promise<Session> {
    if (this.session !== undefined) return this.session;
    this.session = await this.createSession();
    return this.session;
  }

  /** Refresh first (cheap, no credentials on the wire); a dead refresh token falls back to a fresh login. */
  private async renew(): Promise<Session> {
    const refreshJwt = this.session?.refreshJwt;
    this.session = undefined;
    if (refreshJwt !== undefined) {
      const refreshed = await this.tryRefresh(refreshJwt);
      if (refreshed !== undefined) {
        this.session = refreshed;
        return refreshed;
      }
    }
    this.session = await this.createSession();
    return this.session;
  }

  private async tryRefresh(refreshJwt: string): Promise<Session | undefined> {
    try {
      const res = await this.post('com.atproto.server.refreshSession', undefined, refreshJwt);
      if (!res.ok) return undefined;
      return readSession(await readJson(res));
    } catch {
      return undefined; // a dead/unreachable refresh is not fatal — createSession is the next rung
    }
  }

  private async createSession(): Promise<Session> {
    const body = {
      identifier: this.credentials.identifier,
      password: this.credentials.appPassword,
    };
    const res = await this.post('com.atproto.server.createSession', body);
    if (!res.ok) {
      throw makeAdapterError('AUTH', `Bluesky createSession failed (HTTP ${res.status})`, {
        retryable: false,
      });
    }
    const session = readSession(await readJson(res));
    if (session === undefined) {
      throw makeAdapterError('AUTH', 'Bluesky createSession returned no accessJwt/refreshJwt', {
        retryable: false,
      });
    }
    return session;
  }

  private post(method: string, body?: unknown, bearer?: string): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
    return this.send(`${this.serviceUrl}/xrpc/${method}`, {
      method: 'POST',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  private authedGet(url: string, accessJwt: string): Promise<Response> {
    return this.send(url, { method: 'GET', headers: { authorization: `Bearer ${accessJwt}` } });
  }

  /**
   * `redirect: 'manual'` (SECURITY, SSRF hardening — mirrors resilient-http.ts): a compromised/MITM'd
   * upstream must not be able to 3xx-redirect a BEARER-TOKEN-carrying request to an internal address.
   */
  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw networkError(url, e);
    }
  }
}

function networkError(url: string, cause: unknown): AdapterError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return makeAdapterError('UPSTREAM_UNAVAILABLE', `network/timeout: ${url} (${message})`, {
    retryable: true,
    cause,
  });
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function readSession(json: unknown): Session | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const o = json as Record<string, unknown>;
  if (typeof o.accessJwt !== 'string' || typeof o.refreshJwt !== 'string') return undefined;
  return { accessJwt: o.accessJwt, refreshJwt: o.refreshJwt };
}
