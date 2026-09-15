// BEACON — minimal HTTP client for AI provider adapters (E6 support; ADR-007).
// Deliberately tiny (lean stack, no axios): a thin JSON POST over the platform `fetch`, injectable for
// tests. Real LiteLLM/OpenAI-compatible providers use it; the deterministic mock never touches network.
export interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly json: unknown;
}

export interface HttpClient {
  postJson(
    url: string,
    body: unknown,
    headers?: Readonly<Record<string, string>>,
  ): Promise<HttpResponse>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function makeHttpClient(fetchImpl: FetchLike = fetch, timeoutMs = 15_000): HttpClient {
  return {
    async postJson(url, body, headers = {}): Promise<HttpResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
          // `redirect: 'manual'` (SECURITY, SSRF hardening — mirrors resilient-http.ts): a compromised/MITM'd
          // provider must not 3xx-redirect us to an internal address; a 3xx surfaces as a non-2xx (res.ok false)
          // ⇒ the caller treats it as a failure, never a follow.
          redirect: 'manual',
          signal: controller.signal,
        });
        const json: unknown = await res.json().catch(() => null);
        return { status: res.status, ok: res.ok, json };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
