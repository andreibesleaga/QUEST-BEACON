// BEACON — HTTP route → canonical Command mapping (E7·T-334/T-336/T-337/T-338; SPEC §2.2, ADR-023).
// Base path /api/v1. Each REST route maps onto ONE existing Command verb (status | incidents | sitrep |
// sources | report | verify | alert:draft) — the router owns RBAC + business logic, this layer only
// parses/validates the transport shape. No new verbs are invented (see README for deferred routes).
import type { Position } from '@/domain/value-objects/geo.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  RegionId,
  IncidentId,
  PublicReportId,
  AppUserId,
} from '@/domain/value-objects/ids.js';
import type { Command, VisionAssistRequest } from '@/ports/interaction.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { APP_USER_ROLES } from '@/domain/app-user.js';
import type { HttpRequest } from './http-types.js';

/** The resolved intent of a request: a core command, a system probe, or a transport-level error. */
export type RouteResult =
  | { readonly kind: 'command'; readonly command: Command }
  | { readonly kind: 'health' }
  | { readonly kind: 'me' }
  | { readonly kind: 'sustainability' }
  | { readonly kind: 'dev-login'; readonly role: AppUserRole; readonly userId: string }
  | { readonly kind: 'login'; readonly userId: string; readonly password: string }
  | { readonly kind: 'error'; readonly status: number; readonly code: string; readonly message: string };

const SUSTAINABILITY_PATH = '/.well-known/sustainability';
const DECISIONS = ['TRIAGED', 'VERIFIED', 'REJECTED'] as const;
const VISION_TASKS = ['burn-area', 'flood-extent', 'damage-severity', 'scene'] as const;

// ── Live Views v1.2 — citizen live-view link (ADR-029; FEATURE_CITIZEN_STREAM; Part-B red lines) ──
// STRICT host allow-list — the ONLY hosts a citizen live-view link may target in v1.2. This is a deliberate
// tightening of the plan's "generic-https-with-disclaimer" option: that broader path is DEFERRED to a later
// version behind its own review, because a small, well-known set of consumer live-stream hosts is far easier
// to reason about for SSRF, abuse, and phishing on a first ship. Adding a host is a one-line, reviewed change.
const LIVE_VIEW_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'twitch.tv',
  'www.twitch.tv',
  'facebook.com',
  'www.facebook.com',
]);
// YouTube full-domain links must point at a live/watch surface (not an arbitrary channel/account path).
const YT_STREAM_PATH = /^\/(watch|live)(\/|$)/;
const LIVE_VIEW_MAX_LEN = 2048;

function badRequest(message: string): RouteResult {
  // Public API code (SPEC §196) — malformed/invalid request payload.
  return { kind: 'error', status: 400, code: 'VALIDATION_ERROR', message };
}
function consentRequired(): RouteResult {
  // SPEC §2.3/§196 — consent absent on POST /reports (EV4) is a distinct 422 CONSENT_REQUIRED.
  return { kind: 'error', status: 422, code: 'CONSENT_REQUIRED', message: 'consent must be true (EV4)' };
}
function notFound(): RouteResult {
  return { kind: 'error', status: 404, code: 'NOT_FOUND', message: 'no such route' };
}

/** Normalize to a leading-slash, no-trailing-slash path; then split into non-empty segments. */
function segmentsAfterApi(path: string): readonly string[] {
  const clean = path.replace(/\/+$/, '');
  const stripped = clean.startsWith('/api/v1') ? clean.slice('/api/v1'.length) : clean;
  return stripped.split('/').filter((s) => s.length > 0);
}

/** Parse a raw JSON body into a plain object, or null on malformed / non-object input. */
function parseBody(body: string | undefined): Record<string, unknown> | null {
  if (body === undefined || body.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function regionIdOpt(query: HttpRequest['query']): { regionId?: RegionId } {
  const raw = query?.regionId;
  return raw ? { regionId: asId<RegionId>(raw) } : {};
}

/** Single-segment GET routes: /health, /me, /status, /sources, /regions. */
function matchGetSingle(seg: string, query: HttpRequest['query']): RouteResult | null {
  switch (seg) {
    case 'health':
      return { kind: 'health' };
    case 'me':
      return { kind: 'me' };
    case 'status':
      return { kind: 'command', command: { verb: 'status', ...regionIdOpt(query) } };
    case 'sources':
      return { kind: 'command', command: { verb: 'sources', ...regionIdOpt(query) } };
    // GET /regions — the shipped-zone registry (ADR-031 §Decision-4; closes F-01). Deployment-wide, so it
    // takes NO regionId: a filter on the registry that lists the regions would be circular. The nested
    // /regions/:id/incidents (below) and /regions/:id/map (feature router) are unaffected — 3 segments.
    case 'regions':
      return { kind: 'command', command: { verb: 'regions' } };
    default:
      return null;
  }
}

/** Nested GET routes: /regions/:id/incidents and /incidents/:id/sitrep. */
function matchGetNested(segs: readonly string[]): RouteResult | null {
  if (segs[0] === 'regions' && segs[2] === 'incidents') {
    return { kind: 'command', command: { verb: 'incidents', regionId: asId<RegionId>(segs[1]!) } };
  }
  if (segs[0] === 'incidents' && segs[2] === 'sitrep') {
    return { kind: 'command', command: { verb: 'sitrep', incidentId: asId<IncidentId>(segs[1]!) } };
  }
  return null;
}

function matchGet(segs: readonly string[], query: HttpRequest['query']): RouteResult {
  if (segs.length === 1) return matchGetSingle(segs[0]!, query) ?? notFound();
  if (segs.length === 3) return matchGetNested(segs) ?? notFound();
  return notFound();
}

/**
 * The EXACT JSON body POST /reports accepts — the ONE declaration of that wire shape (F-360/F-364).
 *
 * `app/_lib/types.ts` re-exports this AS `SubmitReportBody` instead of hand-declaring a mirror, exactly as
 * it already does for `ResourceTaskWireBody`/`TaskResourceBody` (F-140). The mirror it replaces was wrong in
 * TWO ways at once — it nested the coordinate as `location: {lat, lon}` while this parser reads TOP-LEVEL
 * `lat`/`lng` — and because the coordinate is OPTIONAL, the server saw a location-less report and answered
 * **201 Created**. Every SOS coordinate a citizen typed was silently discarded on the one path where the
 * coordinate is the entire message. `tsc` was at 0 errors throughout, because each side typechecked
 * perfectly against its own private idea of the wire.
 *
 * F-364 is the reason this type exists rather than a corrected copy: of the five FE wire types, the two
 * DERIVED ones were correct and all three hand-duplicated ones were broken. 3-for-3. A correct copy would
 * merely have been correct today; a derived type makes the next divergence a COMPILE error.
 *
 * `lat`/`lng` (not `lon`) is the published contract here and is kept deliberately — the client moved to the
 * server's spelling rather than the reverse, so no server-side parser, test, or stored row had to change to
 * fix a client-side defect.
 */
export type SubmitReportWireBody = {
  readonly consent: true; // literal precondition (EV4) — an unconsented report cannot even be typed
  readonly text: string;
  readonly lat?: number;
  readonly lng?: number;
  /** Optional incident this SOS belongs to (schema.sql: nullable FK; openapi PublicReportCreate.incidentId).
   *  When present, a later VERIFIED + `emitCap` transition can scope its DRAFT alert to THIS incident. */
  readonly incidentId?: string;
  /** Live Views v1.2 (ADR-029, FEATURE_CITIZEN_STREAM) — rejected with a 400 when the feature is off. */
  readonly liveViewUrl?: string;
};

/**
 * Read the OPTIONAL incident link. Absent is legal (a citizen may report before any incident exists);
 * present-but-empty is REJECTED rather than coerced to absent, because `""` reaching the store would create
 * a report that looks linked and is not — and it is that link that later decides whether a VERIFIED report
 * may draft a public CAP alert (F-362). Extracted to keep `reportCommand` inside the Gate-6 budget.
 */
function parseOptionalIncidentId(
  raw: unknown,
): { readonly ok: true; readonly value?: IncidentId } | { readonly ok: false; readonly error: RouteResult } {
  if (raw === undefined) return { ok: true };
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: badRequest('incidentId must be a non-empty string when present') };
  }
  return { ok: true, value: asId<IncidentId>(raw) };
}

/**
 * Read the optional precise coordinate as a `[lon, lat]` Position. BOTH halves must be numbers — half a
 * coordinate is not a location, and defaulting the missing half would place the reporter somewhere they
 * never claimed to be. Extracted to keep `reportCommand` inside the Gate-6 complexity budget.
 */
function reportLocation(lat: unknown, lng: unknown): Position | undefined {
  return typeof lat === 'number' && typeof lng === 'number' ? [lng, lat] : undefined;
}

function reportCommand(body: Record<string, unknown>, citizenStreamEnabled: boolean): RouteResult {
  // Every raw-JSON read is keyed by `keyof SubmitReportWireBody` (never a bare string literal), so renaming
  // a wire field becomes a compile error in this parser instead of a field that silently reads `undefined`.
  const wireField = <K extends keyof SubmitReportWireBody>(key: K): unknown => body[key];
  const text = wireField('text');
  if (typeof text !== 'string' || text.trim() === '') return badRequest('text is required');
  if (wireField('consent') !== true) return consentRequired();
  const incident = parseOptionalIncidentId(wireField('incidentId'));
  if (!incident.ok) return incident.error;
  const incidentId = incident.value;
  const liveView = parseLiveViewUrl(body, citizenStreamEnabled);
  if (!liveView.ok) return liveView.error;
  const location = reportLocation(wireField('lat'), wireField('lng'));
  return {
    kind: 'command',
    command: {
      verb: 'report',
      consent: true,
      text,
      ...(location ? { location } : {}),
      ...(incidentId !== undefined ? { incidentId } : {}),
      ...(liveView.value !== undefined ? { liveViewUrl: liveView.value } : {}),
    },
  };
}

function alertCommand(body: Record<string, unknown>): RouteResult {
  const { incidentId, headline } = body;
  if (typeof incidentId !== 'string' || incidentId.trim() === '') return badRequest('incidentId required');
  if (typeof headline !== 'string' || headline.trim() === '') return badRequest('headline required');
  return {
    kind: 'command',
    command: { verb: 'alert:draft', incidentId: asId<IncidentId>(incidentId), headline },
  };
}

/**
 * POST /auth/dev-login {role, userId} — the demo IdP surface (parse/validate only; the dispatcher mints
 * the token, and ONLY when AUTH_SECRET is set). NOT production issuance. Fail-closed validation here.
 */
function devLoginCommand(body: string | undefined): RouteResult {
  const parsed = parseBody(body);
  if (parsed === null) return badRequest('malformed or empty JSON body');
  const upper = typeof parsed.role === 'string' ? parsed.role.toUpperCase() : '';
  if (!(APP_USER_ROLES as readonly string[]).includes(upper)) {
    return badRequest('role must be a known AppUserRole');
  }
  const { userId } = parsed;
  if (typeof userId !== 'string' || userId.trim() === '') return badRequest('userId is required');
  return { kind: 'dev-login', role: upper as AppUserRole, userId };
}

/**
 * POST /auth/login {userId, password} — the REAL named-account login (parse/validate only; the dispatcher
 * verifies the credential and mints the token). Unlike dev-login this carries NO role: the role comes from
 * the configured account, so a caller can never ask for one. Available in every posture, including cloud.
 */
function loginCommand(body: string | undefined): RouteResult {
  const parsed = parseBody(body);
  if (parsed === null) return badRequest('malformed or empty JSON body');
  const { userId, password } = parsed;
  if (typeof userId !== 'string' || userId.trim() === '') return badRequest('userId is required');
  if (typeof password !== 'string' || password === '') return badRequest('password is required');
  return { kind: 'login', userId: userId.trim(), password };
}

/** The two POST /auth/* surfaces, split out so matchPost stays under the complexity ceiling. */
function matchAuthPost(segs: readonly string[], body: string | undefined): RouteResult | undefined {
  if (segs.length !== 2 || segs[0] !== 'auth') return undefined;
  if (segs[1] === 'dev-login') return devLoginCommand(body);
  if (segs[1] === 'login') return loginCommand(body);
  return undefined;
}

function matchPost(segs: readonly string[], body: string | undefined, citizenStreamEnabled: boolean): RouteResult {
  const auth = matchAuthPost(segs, body);
  if (auth !== undefined) return auth;
  if (segs.length !== 1 || (segs[0] !== 'reports' && segs[0] !== 'alerts')) return notFound();
  const parsed = parseBody(body);
  if (parsed === null) return badRequest('malformed or empty JSON body');
  return segs[0] === 'reports' ? reportCommand(parsed, citizenStreamEnabled) : alertCommand(parsed);
}

/**
 * Parse the optional advisory `visionAssist` body field on PATCH /reports/:id (E6·T-290/T-291, Art.
 * XIV). Malformed input is a 400, never a silent drop — matches the strict-body posture of the rest of
 * this route. Consent/PII-screen are re-verified in-path by the compliance gateway regardless of what a
 * client claims here; this is transport-shape validation only.
 */
function parseVisionAssist(body: Record<string, unknown>): { readonly ok: true; readonly value?: VisionAssistRequest } | { readonly ok: false; readonly error: RouteResult } {
  const raw = body.visionAssist;
  if (raw === undefined) return { ok: true };
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: badRequest('visionAssist must be an object') };
  const { imageRef, task, imageConsented, piiScreened } = raw as Record<string, unknown>;
  // imageRef scheme allow-list (latent-SSRF guard): only a demo `fixture:<id>` handle or an `https://` URL —
  // never a bare path, `file:`, `http:`, or a cloud-metadata address (169.254.169.254). Any provider that
  // later FETCHES imageRef MUST still enforce its own host allow-list; this only bounds the transport shape.
  if (typeof imageRef !== 'string' || !/^(fixture:[A-Za-z0-9._-]+|https:\/\/\S+)$/.test(imageRef)) {
    return { ok: false, error: badRequest('visionAssist.imageRef must be a fixture:<id> handle or an https:// URL') };
  }
  if (typeof task !== 'string' || !(VISION_TASKS as readonly string[]).includes(task)) {
    return { ok: false, error: badRequest('visionAssist.task must be burn-area|flood-extent|damage-severity|scene') };
  }
  if (typeof imageConsented !== 'boolean' || typeof piiScreened !== 'boolean') {
    return { ok: false, error: badRequest('visionAssist.imageConsented and visionAssist.piiScreened must be booleans') };
  }
  return { ok: true, value: { imageRef, task: task as VisionAssistRequest['task'], imageConsented, piiScreened } };
}

/** True only when `host` is a full-YouTube domain (which needs a live/watch path); other hosts use a channel path. */
function liveViewPathAllowed(host: string, path: string): boolean {
  if (host === 'youtube.com' || host === 'www.youtube.com') return YT_STREAM_PATH.test(path);
  // youtu.be short link, twitch channel, facebook page/live/watch — any non-root path (never the bare host).
  return path.length > 1;
}

/**
 * Structural SSRF/allow-list gate for a citizen live-view URL. Accepts ONLY: `https://`, no userinfo
 * (`user:pass@` credential-smuggling / host-confusion), an allow-listed host (which by construction excludes
 * every IP literal + private/link-local host — none are on the list), a live/watch/channel path, and ≤2048
 * chars. The URL is PARSED for validation only — it is NEVER fetched (no HEAD, no thumbnail) here or anywhere
 * downstream (link-only doctrine, ADR-029). Returns a plain boolean so the caller stays under the complexity ceiling.
 */
function isAllowedLiveViewUrl(raw: string): boolean {
  if (raw.length > LIVE_VIEW_MAX_LEN) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  if (!LIVE_VIEW_HOSTS.has(host)) return false;
  return liveViewPathAllowed(host, url.pathname);
}

/**
 * Parse the optional `liveViewUrl` on POST /reports (Live Views v1.2). Mirrors parseVisionAssist's strict-body
 * posture: a malformed/disallowed value is a 400, never a silent drop. When FEATURE_CITIZEN_STREAM is OFF the
 * field is REJECTED with a 400 (the honest posture — a client that sent it learns the feature is off, rather
 * than having a link it believes is live silently dropped). Absent field ⇒ pass-through (byte-identical to the
 * pre-feature route). NEVER fetched server-side.
 */
function parseLiveViewUrl(
  body: Record<string, unknown>,
  citizenStreamEnabled: boolean,
): { readonly ok: true; readonly value?: string } | { readonly ok: false; readonly error: RouteResult } {
  const raw = body.liveViewUrl;
  if (raw === undefined) return { ok: true };
  if (!citizenStreamEnabled) {
    return { ok: false, error: badRequest('liveViewUrl rejected: the citizen live-view feature is disabled') };
  }
  if (typeof raw !== 'string') return { ok: false, error: badRequest('liveViewUrl must be a string') };
  if (!isAllowedLiveViewUrl(raw)) {
    return {
      ok: false,
      error: badRequest(
        'liveViewUrl must be an https link on the allow-list (youtube/youtu.be live|watch, twitch, facebook) — no http/IP/userinfo/private host',
      ),
    };
  }
  return { ok: true, value: raw };
}

/**
 * The EXACT JSON body PATCH /reports/:id accepts — the ONE declaration of that wire shape (F-362/F-364).
 *
 * `app/_lib/types.ts` re-exports this AS `VerifyReportBody`. The hand-written mirror it replaces carried an
 * `emitCap?: boolean` that NO server code read — `emitCap` appeared nowhere under `src/` at all — so the
 * verifier queue's "Approve + CAP" control was client-only fiction on the **Art. XIII CAP-emission path**,
 * the single most consequential surface in the product. The component test that "proved" it worked mocked
 * the mutation hook and supplied the server's response to itself.
 *
 * `actorId` is deliberately ABSENT and stays absent: the acting identity is server-derived from the
 * authenticated principal, and sending one is REJECTED below (Art. XIII accountability).
 */
export type VerifyReportWireBody = {
  readonly decision: (typeof DECISIONS)[number];
  /** VERIFIED + `emitCap` ⇒ a **DRAFT** CAP alert in `meta.emittedAlert`. Never an ACTUAL emission:
   *  promotion to ACTUAL remains a separate authenticated human approval (Art. XIII). */
  readonly emitCap?: boolean;
  readonly visionAssist?: VisionAssistRequest;
};

function verifyCommand(id: string, body: Record<string, unknown>, resolvedActorId: string): RouteResult {
  const wireField = <K extends keyof VerifyReportWireBody>(key: K): unknown => body[key];
  const decision = wireField('decision');
  const emitCapRaw = wireField('emitCap');
  if (typeof decision !== 'string' || !(DECISIONS as readonly string[]).includes(decision)) {
    return badRequest('decision must be TRIAGED|VERIFIED|REJECTED');
  }
  // Reject a non-boolean rather than coercing: a truthy string ("false", "0") deciding whether a public
  // alert is drafted is exactly the kind of silent coercion Art. XIII exists to prevent.
  if (emitCapRaw !== undefined && typeof emitCapRaw !== 'boolean') {
    return badRequest('emitCap must be a boolean when present');
  }
  // SECURITY (Art. XIII / AGENTS §6 — accountability): the acting identity is NEVER trusted from the
  // client body — that would let a caller forge the hash-chained TriageAuditRecord (attribute a decision
  // to someone else). We REJECT (not silently drop) any client-supplied `actorId` with the public
  // VALIDATION_ERROR vocabulary (SPEC §196): failing loud surfaces a stale/malicious client instead of
  // hiding the misuse, and makes the contract explicit — actorId is server-derived, not a request input.
  if ('actorId' in body) {
    return badRequest('actorId is derived server-side from the authenticated principal; do not send it');
  }
  const visionAssist = parseVisionAssist(body);
  if (!visionAssist.ok) return visionAssist.error;
  return {
    kind: 'command',
    command: {
      verb: 'verify',
      reportId: asId<PublicReportId>(id),
      decision: decision as (typeof DECISIONS)[number],
      ...(emitCapRaw === true ? { emitCap: true as const } : {}),
      // Server-derived actor: the true per-user identity resolved by the dispatcher (a verified JWT `sub`,
      // else the role key `role:<ROLE>` — see rbac.actorId). NEVER the request body.
      actorId: asId<AppUserId>(resolvedActorId),
      ...(visionAssist.value ? { visionAssist: visionAssist.value } : {}),
    },
  };
}

function matchPatch(segs: readonly string[], body: string | undefined, resolvedActorId: string): RouteResult {
  if (segs.length !== 2 || segs[0] !== 'reports') return notFound();
  const parsed = parseBody(body);
  if (parsed === null) return badRequest('malformed or empty JSON body');
  return verifyCommand(segs[1]!, parsed, resolvedActorId);
}

/**
 * Resolve a request to a RouteResult. The origin-root sustainability probe is matched before /api/v1.
 * `resolvedActorId` is the already-resolved, server-derived TRUE actor (a verified JWT `sub`, else the
 * role key) — it is the ONLY source of the verify actor (PATCH /reports/:id); the request body can never
 * influence the recorded actor (Art. XIII). `citizenStreamEnabled` reflects FEATURE_CITIZEN_STREAM (default
 * false) and gates the optional POST /reports `liveViewUrl` field (Live Views v1.2, ADR-029): off ⇒ the
 * field is REJECTED with a 400 rather than silently dropped.
 */
export function resolveRoute(
  req: HttpRequest,
  resolvedActorId: string,
  citizenStreamEnabled = false,
): RouteResult {
  const method = req.method.toUpperCase();
  const path = req.path.replace(/\/+$/, '') || '/';
  if (method === 'GET' && path === SUSTAINABILITY_PATH) return { kind: 'sustainability' };

  const segs = segmentsAfterApi(req.path);
  if (method === 'GET') return matchGet(segs, req.query);
  if (method === 'POST') return matchPost(segs, req.body, citizenStreamEnabled);
  if (method === 'PATCH') return matchPatch(segs, req.body, resolvedActorId);
  return notFound();
}
