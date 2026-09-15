// BEACON — Next.js App-Router delegator for /api/v1/* (E7·T-334; ADR-023 §API is one driving adapter).
// TRIVIAL by design: translate Next Request → framework-agnostic HttpRequest → handleHttp → Response. All
// routing, RBAC, rate-limiting, validation, and envelope logic live in the tested dispatcher (zero logic here).
import {
  getHttpDepsAsync,
  getHttpDepsForRead,
  handleHttp,
} from '@/adapters/channels/http/http-dispatcher.js';
import type { HttpDeps, HttpRequest } from '@/adapters/channels/http/http-types.js';

async function toHttpRequest(req: Request): Promise<HttpRequest> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.text();
  return {
    method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(req.headers),
    ...(body !== undefined ? { body } : {}),
  };
}

const JSON_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'application/json' };

/**
 * The LAST error boundary. Everything inside `handleHttp` already converts any throw into a typed
 * `{code, message}` envelope — but three things here sit OUTSIDE it and were unguarded
 * (production-readiness audit, 2026-09-11): reading the body, resolving the composition root, and
 * serialising the response.
 *
 * That gap mattered because the composition root is where the loudest messages live: `loadConfig` throws
 * one naming every failed field, and the database client throws one naming `DATABASE_URL`. Unguarded,
 * those reach the caller as an unshaped framework 500 — a stack trace and an environment variable name
 * handed to whoever asked. The dispatcher's careful "never leak internal detail" contract began one stack
 * frame too late to matter.
 *
 * The response body is the SAME opaque shape the dispatcher emits for an internal fault, so a caller
 * cannot tell from the outside whether the failure happened before or after the boundary — which is the
 * point. The detail goes to stderr, where an operator can reach it and a caller cannot.
 */
/**
 * A READ may be answered from the offline seed while the live composition is still building; a WRITE may
 * not. The asymmetry is the whole point: a report filed during warm-up would land in the memory store and
 * be discarded when the live composition took over, so a mutation waits for the real store however long
 * that takes. A read gets a labelled, honest picture in milliseconds instead of a 60-second edge timeout.
 */
function depsFor(method: string): Promise<HttpDeps> {
  const verb = method.toUpperCase();
  return verb === 'GET' || verb === 'HEAD' ? getHttpDepsForRead() : getHttpDepsAsync();
}

async function delegate(req: Request): Promise<Response> {
  try {
    const res = await handleHttp(await toHttpRequest(req), await depsFor(req.method));
    return new Response(JSON.stringify(res.body), { status: res.status, headers: res.headers });
  } catch (thrown) {
    // Logged, not swallowed. A boundary that discards the cause turns a diagnosable outage into a
    // mystery, and this is the one place in the request path that sees a composition-root failure.
    console.error('[beacon] unhandled request failure', {
      path: new URL(req.url).pathname,
      method: req.method,
      error: thrown instanceof Error ? thrown.message : String(thrown),
      stack: thrown instanceof Error ? thrown.stack : undefined,
    });
    return new Response(
      JSON.stringify({ errors: [{ code: 'INTERNAL_ERROR', message: 'internal error' }] }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
}

export const GET = delegate;
export const POST = delegate;
export const PATCH = delegate;
