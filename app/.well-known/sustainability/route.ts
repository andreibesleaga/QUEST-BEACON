// BEACON — Next.js App-Router delegator for the origin-root sustainability plugin (E7·T-342; FR-14/ADR-020).
// TRIVIAL: forward to the tested dispatcher, which serves the schema-valid, heavily-cached modeled report.
import { getHttpDepsAsync, handleHttp } from '@/adapters/channels/http/http-dispatcher.js';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const res = await handleHttp(
    { method: 'GET', path: url.pathname, headers: Object.fromEntries(req.headers) },
    await getHttpDepsAsync(),
  );
  return new Response(JSON.stringify(res.body), { status: res.status, headers: res.headers });
}
