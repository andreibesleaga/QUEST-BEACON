// BEACON — HTTP channel types (E7·T-334; ADR-023 channel-agnostic core). The framework-agnostic request/
// response contract the dispatcher speaks. Next.js (or any transport) adapts its native shapes into these,
// so the dispatcher + all its tests run WITHOUT spinning up a server (deterministic, offline).
import type { InteractionPort } from '@/ports/interaction.js';
import type { EventBusPort, SpatialPort } from '@/ports/infra.js';
import type { RoutingPort } from '@/ports/logistics.js';
import type { PanelDataPort } from '@/ports/panels.js';
import type { AlertId, IncidentId } from '@/domain/value-objects/ids.js';
import type { Geometry, Position } from '@/domain/value-objects/geo.js';
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { MapReadModel } from '@/application/map-projection/map-projection.js';
import type { ForecastEvidence } from '@/application/anticipatory/forecast-evidence.js';
import type { LogisticsAdapter } from '@/adapters/logistics/memory-logistics.js';
import type { InteropDeps } from './routes/interop.js';
import type { PrePositioningTuning } from './routes/logistics.js';
import type { CredentialRecord } from './credentials.js';
import type { ReportQueueReadModel } from './routes/queue.js';

/** A transport-neutral inbound HTTP request. `body` is the RAW text (the dispatcher parses/validates it). */
export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: string; // raw body text — parsed by the dispatcher so malformed JSON → 400
  readonly headers: Readonly<Record<string, string | undefined>>;
}

/** A transport-neutral response. `body` is usually an Envelope; system probes (/health,/me) are plain JSON. */
export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

/** A naive per-actor token-bucket limiter (injectable clock → deterministic). */
export interface RateLimiter {
  /** Consume one token for `key`; false when the bucket is empty (→ 429). */
  take(key: string): boolean;
}

/**
 * The self-contained feature adapters the HTTP feature-router dispatches to (logistics/routing/interop/
 * eventbus). Built ONCE at composition (buildFeatureDeps) so the in-memory stores survive across requests.
 * The `eventBus` backs the SSE `/stream` delta channel (consumed by the Next stream delegator, not the JSON
 * dispatcher). `newId` mints resource/task ids for server-generated identities.
 */
export interface HttpFeatureDeps {
  readonly routing: RoutingPort;
  readonly logistics: LogisticsAdapter;
  readonly interop: InteropDeps;
  /** The region-keyed map-geometry read-model backing GET /regions/:id/map (offline: memory-seeded). */
  readonly map: MapReadModel;
  readonly eventBus: EventBusPort;
  readonly clock: () => string;
  readonly newId: (prefix: string) => string;
  /** Per-incident projected hazard-arrival lookup (ISO-8601) — feeds the computed evac suggested_start (FR-7). */
  readonly hazardArrivalFor?: (incidentId: IncidentId) => string | undefined;
  /** The incident's own place (its footprint centre) — the origin of a route requested without one. */
  readonly originFor?: (incidentId: IncidentId) => Position | undefined;
  /**
   * alertId → the LABELLED forecast evidence behind an anticipatory DRAFT (WP A8 / finding F-301), backing
   * the additive `forecast` field on `GET /alerts` rows. Absent function / unlisted alert ⇒ the row carries
   * no evidence at all, which is the honest answer for an observed-rule DRAFT (Art. XVI) — never a
   * fabricated lead time. The composition root supplies it in `buildFeatureDeps` (src/main/feature-seed.ts).
   */
  readonly forecastEvidenceFor?: (alertId: AlertId) => ForecastEvidence | undefined;
  /**
   * ADR-039 — durable evac-route store, composed only under `FEATURE_STORE=postgres`. A computed route is a
   * DECISION about where people are sent; recording it is what makes the logistics trail auditable.
   */
  readonly routeStore?: {
    accept(route: EvacRoute): Promise<Result<EvacRoute | null, DomainError>>;
  };
  /** SSE heartbeat interval (ms); 0/omitted ⇒ disabled (deterministic tests). */
  readonly heartbeatMs?: number;
  /** The spatial engine, when the composition root wires a shared instance (defaults to the config-selected
   * SpatialPort otherwise). Backs GET /pre-positioning's inside/near-extent test (Art. XII). */
  readonly spatial?: SpatialPort;
  /** Per-incident projected hazard EXTENT (prediction-projection OUTPUT, e.g. `Prediction.geom`) — feeds
   * GET /pre-positioning (W2d). Absent/unset incident ⇒ the endpoint returns a labeled `extentAvailable:false`
   * rather than a dead-end (Art. XVI). Wiring the real per-incident value is a composition-root concern
   * (`src/main/feature-seed.ts` `buildFeatureDeps` — not edited here; see RESUME notes for the exact addition). */
  readonly projectedExtentFor?: (incidentId: IncidentId) => Geometry | undefined;
  /**
   * The threshold RULES this composition evaluates (FR-11), backing `GET /threshold-rules`. These are the
   * SAME rule objects `deriveDraftAlerts` fires on — the endpoint lists what actually runs, never a second
   * description of it. Absent ⇒ this deployment configures no rules and the endpoint says so (`count: 0`);
   * the composition root supplies them in `buildFeatureDeps` (src/main/feature-seed.ts).
   */
  readonly thresholdRules?: readonly ThresholdRule[];
}

/**
 * Everything the dispatcher needs, built ONCE at composition (buildInteraction) and reused across requests
 * so the in-memory report store survives a report→verify round-trip. `clock` is the same injected clock the
 * core uses (deterministic tests); `rateLimiter` shares it. `features` holds the wired feature adapters.
 */
export interface HttpDeps {
  readonly interaction: InteractionPort;
  readonly clock: () => string;
  readonly rateLimiter: RateLimiter;
  /** Env for auth resolution (the `AUTH_DEV_TRUST_HEADER` demo flag + `AUTH_SECRET` JWT). Defaults to process.env. */
  readonly env: Record<string, string | undefined>;
  /** The wired feature adapters (routing/logistics/interop/eventbus) the feature-router dispatches to. */
  readonly features: HttpFeatureDeps;
  /** The verifier report queue read-model backing GET /reports — SHARED with the core report store (POST/PATCH /reports). */
  readonly reports: ReportQueueReadModel;
  /**
   * ADR-041 — the OPERATOR-MAINTAINED dock-panel store, composed ONLY under `FEATURE_STORE=postgres`
   * (`build-core.ts` `panelDataStore`, the `provenanceSink`/`incidentSink` pattern). Absent is the memory
   * posture: the five panels then serve their fixture rung exactly as they did before this seam existed,
   * so the offline, air-gapped and Playwright profiles acquire no database dependency (Art. XVI).
   *
   * It rides on `HttpDeps` rather than `HttpFeatureDeps` for the same reason `prePositioning` does: it is
   * resolved from the VALIDATED config by the live composition root, not assembled with the feature seed.
   */
  readonly panelData?: PanelDataPort;
  /**
   * Configured named accounts backing POST /auth/login (derived keys only — never plaintext). Absent or
   * empty ⇒ the login route is 404, which is the correct offline/e2e posture: those flows use the dev
   * header and must never receive a token.
   */
  readonly credentials?: readonly CredentialRecord[];
  /**
   * V2·A9 — the operator-configured pre-positioning bounds (`PREPOSITION_RADIUS_KM` → metres,
   * `PREPOSITION_TOP_N`), resolved from the VALIDATED config by the live composition root
   * (`createHttpDepsLive` → `prePositioningTuning`) and forwarded to GET /pre-positioning.
   *
   * It rides on `HttpDeps` rather than `HttpFeatureDeps` on purpose: this is a decision-engine tunable read
   * from config, not a wired adapter, and `buildFeatureDeps` (src/main) composes adapters. Optional because
   * the sync/offline `createHttpDeps` parses no config — absent ⇒ the use-case's own documented defaults,
   * which ARE these values, so both paths behave identically until an operator changes one.
   */
  readonly prePositioning?: PrePositioningTuning;
}
