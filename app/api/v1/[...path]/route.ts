// BEACON — Next.js App-Router delegator for /api/v1/* (E7·T-334; ADR-023 §API is one driving adapter).
// TRIVIAL by design: translate Next Request → framework-agnostic HttpRequest → handleHttp → Response. All
// routing, RBAC, rate-limiting, validation, and envelope logic live in the tested dispatcher (zero logic here).
import { getHttpDepsAsync, handleHttp } from '@/adapters/channels/http/http-dispatcher.js';
import type { HttpRequest } from '@/adapters/channels/http/http-types.js';

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

async function delegate(req: Request): Promise<Response> {
  const res = await handleHttp(await toHttpRequest(req), await getHttpDepsAsync());
  return new Response(JSON.stringify(res.body), { status: res.status, headers: res.headers });
}

export const GET = delegate;
export const POST = delegate;
export const PATCH = delegate;
