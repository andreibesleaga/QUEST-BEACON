// BEACON — HTTP channel barrel (E7; ADR-023). A DRIVING adapter over the SAME core as every channel —
// framework-agnostic dispatcher, envelope serializer, security middleware, error mapping. The Next.js
// route handlers (app/api/**) are thin delegators to handleHttp().
export {
  handleHttp,
  createHttpDeps,
  getHttpDeps,
  createHttpDepsLive,
  getHttpDepsAsync,
  type CreateHttpDepsOptions,
} from './http-dispatcher.js';
export {
  statusForError,
  apiCodeForError,
  apiErrorEnvelope,
  channelErrorEnvelope,
} from './error-mapping.js';
export { handleSustainability } from './sustainability.js';
export type { HttpRequest, HttpResponse, HttpDeps, RateLimiter } from './http-types.js';
