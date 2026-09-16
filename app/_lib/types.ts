// BEACON — Frontend shared types (E8·T-351…T-354). The minimal FE view of the E7 envelope contract
// (re-exported from the port so the UI never redefines the wire shape) plus the store/layer vocabulary
// and the SSE region-delta notification. Data shapes mirror the backend where practical and stay lean —
// panels read `Envelope<T>.data`; provenance/freshness/citations ride on the envelope itself.
import type { AppUserRole } from '@/domain/app-user.js';
import type { Resource } from '@/domain/resource.js';
import type { ResourceTaskStatus } from '@/domain/resource-task.js';
import type { Position, Geometry } from '@/domain/value-objects/geo.js';
import type {
  ResourcesGetData,
  ResourceTaskData,
} from '@/adapters/channels/http/routes/feature-router.js';
// The forecast evidence shape is the SERVER's own declaration (WP A8/F-301) — re-exported, never a second
// copy, so a field added or renamed there is a client compile error rather than a silently blank block.
import type { ForecastEvidence } from '@/application/anticipatory/forecast-evidence.js';

export type { ForecastEvidence };

// The canonical envelope + its parts are OWNED by the port (SPEC §2.1). Re-export the TYPES so every
// FE module imports one shape ('@/ports/interaction.js') — never a divergent local copy.
export type { Envelope, SourceRef, CitationView, EnvelopeError } from '@/ports/interaction.js';

// ── UI vocabulary ────────────────────────────────────────────────────────────

/** The closed set of toggleable map layers (bound 1:1 to deck.gl layers, T-359/T-360). */
export const LAYER_IDS = [
  'fire',
  'flood',
  'storm',
  'floodzone',
  'infra',
  'outage',
  'cell',
  'weather',
  'cameras',
  'exposure',
  'reports',
  'prediction',
  'route',
  'shelters',
] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export type Theme = 'dark' | 'light';

/** The acting principal's RBAC role — drives precise-PII gating in the UI (mirrors the domain role). */
export type ActorRole = AppUserRole;

/** The closed set of RBAC roles (re-exported from the domain) — drives the demo role switcher in the toolbar. */
export { APP_USER_ROLES } from '@/domain/app-user.js';

// ── SSE region delta (SPEC §2.5) ───────────────────────────────────────────────

/**
 * A trigger-only change notification pushed over the region-keyed SSE channel. NO numbers travel here
 * (Art. XII) — the client REFETCHES the named entity via REST to obtain grounded, provenanced data.
 *
 * F-408 — DERIVED from `StreamDelta`, the server type that actually serialises these frames. This was the
 * SIXTH hand-duplicated wire type in this file, found while wiring the SSE client (F-320). It happened to
 * AGREE with the server, which is precisely why it was worth converting rather than leaving alone: the three
 * duplicates that disagreed (F-360/361/362) typechecked just as cleanly, so correctness of a copy is a
 * property of today, not of the contract. A rename on either side now breaks the build instead of silently
 * dropping every delta and leaving a COP that looks live while it is frozen.
 */
export type { StreamDelta as RegionDelta } from '@/adapters/channels/http/routes/stream.js';

// ── Minimal data shapes read from `Envelope<T>.data` ───────────────────────────

/** Effective mode + freshness of one configured source (monitor view). */
export interface SourceStatus {
  readonly sourceId: string;
  readonly mode: 'LIVE' | 'CACHED' | 'MOCK';
  readonly freshness?: string;
}

/** GET /status — per-region source health snapshot. */
export interface StatusData {
  readonly regionId: string;
  readonly sources: readonly SourceStatus[];
}

/** One active incident summary — mirrors the backend IncidentView projection (SPEC §2.2). */
export interface IncidentSummary {
  readonly id: string;
  readonly type: string; // 'WILDFIRE' | 'FLOOD' | … (open string at the wire — never re-derived client-side)
  readonly status: string;
  readonly headline?: string;
}
/** GET /regions/:id/incidents — the region's active incidents (envelope `data` is an OBJECT, not an array). */
export interface IncidentsData {
  readonly regionId: string;
  readonly incidents: readonly IncidentSummary[];
}

/** One narrated SitRep field — matches the domain SitRepField (its grounding rides envelope.citations[], F2). */
export interface SitRepField {
  readonly field: string;
  readonly claim?: string;
}

/** A deterministically-ranked priority (rank/label/detail from the engine, never the LLM — Art. XII/§5.2). */
export interface RankedPriority {
  readonly rank: number;
  readonly label: string;
  readonly detail?: string;
}

/**
 * One row of the ranked Outlook (ADR-033 §5; mirrors the domain `RankedOutlookItem`). `rank` and the order
 * are the ENGINE's — the client renders them, never re-sorts them (Art. XII). `kind`/`likelihoodClass` stay
 * OPEN strings at the wire for the same reason `IncidentSummary.type` does: the client must not own a copy
 * of a closed server vocabulary. `method` + `uncertainty` are required because a prediction may never be
 * displayed without the labelling that makes it honest.
 */
export interface RankedOutlookItem {
  readonly rank: number;
  readonly predictionId: string;
  readonly kind: string;
  readonly method: string;
  readonly uncertainty: number;
  readonly likelihoodClass?: string;
  readonly etaHours?: number;
  readonly hazardArrival?: string; // ISO-8601, computed server-side from the SitRep's own instant
}

/** GET /incidents/:id/sitrep — the domain SitRep (`data`); citations ride the envelope top-level (F2). */
export interface SitRepData {
  readonly id?: string;
  readonly incidentId?: string;
  readonly generatedAt?: string;
  readonly summary?: string; // LLM narration — hidden in the deterministic-only rung (numbers/citations retained)
  readonly fields: readonly SitRepField[];
  readonly priorities: readonly RankedPriority[]; // retained in every rung, incl. deterministic-only (SPEC §2.4)
  /**
   * Engine-ranked predictions (ADR-033 §5), retained in every rung exactly like `priorities`. OPTIONAL on
   * the client only: the server always emits it (`makeSitRep` defaults it to `[]`), but a v1 server that
   * predates the field must not make the panel throw — the same backward-compatible tolerance the Phase-D
   * map layers carry. Absent is read as "no Outlook", never as an error.
   */
  readonly outlook?: readonly RankedOutlookItem[];
  readonly trend?: string;
  readonly aiMode: string; // echoes the ladder rung used (SPEC §2.2)
}

/** GET /sources — one entry of the SOURCE_RECORD provenance catalogue. */
export interface SourceCatalogEntry {
  readonly sourceId: string;
  readonly adapter?: string;
  /** SERVED provenance (ADR-041 §3): `DB` is an operator-maintained row, not an adapter ladder rung. */
  readonly mode: 'LIVE' | 'CACHED' | 'MOCK' | 'DB';
  readonly freshness?: string;
}
export type SourcesData = readonly SourceCatalogEntry[];

/** GET /me — authenticated principal (drives RBAC in the UI). */
export interface MeData {
  readonly role: ActorRole;
  readonly org?: string;
  readonly userId?: string;
  /**
   * V2·A7 (ADR-040) — an operator-only link the SERVER decided this session may see (the Directus admin
   * console). Present ONLY for an authenticated EM on a deployment that configured `DB_ADMIN_URL`; absent
   * for every other role and every anonymous caller, because the gate is in the response rather than in the
   * render. Optional here for exactly that reason: "the field did not arrive" is the normal case, and it is
   * the ONLY signal the UI is allowed to act on — there is deliberately no client-side role check to bypass.
   */
  readonly dbAdminUrl?: string;
}

// F-200 (found while fixing F-192, and the FIFTH instance of the same systemic root cause): this pair was a
// hand-written mirror of GET /resources and BOTH halves were wrong. The envelope `data` is not a bare array
// — `handleResourcesGet` returns `success(200, { resources: scoped })` — so `query.data.data.map(...)` in
// the logistics board threw a TypeError and took the whole panel down the moment the list was non-empty;
// and the org field is called `orgId` on the wire (the server serialises the domain `Resource` verbatim),
// so `resource.org` was permanently undefined. Both halves are now DERIVED:
//   • the container key comes from `keyof ResourcesGetData` (the server's own payload type), so unwrapping
//     or renaming it is a compile error in the board rather than a runtime crash in a browser;
//   • every row key is read off the domain `Resource`, so a domain rename breaks compilation here too.
/** The plain-JSON (unbranded) wire form of a domain field — branding is a server-side ACL concern that does
 *  not survive `JSON.stringify`, but naming the domain field still ties the two together. */
type WireString<T> = T extends string ? string : never;

/** GET /resources — one taskable resource (org-scoped for RESPONDER). Keys derived from domain `Resource`. */
export type ResourceSummary = {
  readonly [K in 'id' | 'kind' | 'status']: WireString<Resource[K]>;
} & {
  readonly [K in 'orgId']?: WireString<NonNullable<Resource[K]>>;
};

/** GET /resources — the envelope `data` (an OBJECT keyed by the SERVER's own `resources` key, not an array). */
export type ResourcesData = Readonly<Record<keyof ResourcesGetData, readonly ResourceSummary[]>>;

/**
 * The query string GET /resources requires — re-exported (never re-declared) from the server's derived
 * contract, so `api.getResources` cannot be called without the `incidentId` the route hard-requires. F-192:
 * the client fetched a bare `/resources` with no query at all and the board 400'd on every real page load.
 */
export type { ResourcesWireQuery as ResourcesQuery } from '@/adapters/channels/http/routes/feature-router.js';

// ── The five dock-panel reads (S3·U1/U2) — DERIVED from the server's own payload declarations ─────────
// (panels.ts, re-exported through feature-router.ts exactly like ResourcesGetData — the F-200/F-364 lesson:
// a hand-written mirror can be wrong in a way `tsc` cannot see, so the client never re-declares these).
// Every field the panels render — the shelter board's rows/totals/provenanceClaim, the damage assessment's
// per-triage-state buckets + unverifiedLabel, the EMS overlay's productionLabel/attribution/rejected — is
// the application module's OWN output, typed once, server-side.
export type {
  SuppliesGetData as SuppliesData,
  SupplyLotView,
  VolunteerTeamsGetData as VolunteerTeamsData,
  VolunteerTeamView,
  ShelterStatusGetData as ShelterStatusData,
  DamageReportsGetData as DamageReportsData,
  EmsOverlayGetData as EmsOverlayData,
} from '@/adapters/channels/http/routes/feature-router.js';

/**
 * Deterministic confidence-blend components (Art. XII — NEVER LLM-produced). Mirrors the domain
 * ConfidenceComponents; each is a [0,1] sub-score the verifier UI renders as a labelled bar so a human
 * sees WHY a report scored as it did (geocode quality, source authority, classifier, corroboration).
 */
export interface ReportConfidenceComponents {
  readonly geocode?: number;
  readonly authority?: number;
  readonly classifier?: number;
  readonly corroboration?: number;
}

/** A crowdsourced report as listed in the verifier queue (GET /reports, T-378). */
export interface ReportSummary {
  readonly id: string;
  readonly status: string; // UNVERIFIED | TRIAGED | VERIFIED | REJECTED
  readonly confidence?: number; // deterministic blend (Art. XII), 0..1
  readonly confidenceComponents?: ReportConfidenceComponents; // the blend's deterministic sub-scores
  readonly geomPrecise?: unknown; // precise SOS geometry — present ONLY for RESPONDER+ (Art. XIV, server-gated)
  readonly text?: string;
  // Live Views v1.2 (ADR-029, FEATURE_CITIZEN_STREAM). A consent-gated citizen live-view link — rendered as a
  // distinct "Live Feed — Unofficial" chip, NEVER merged with agency cameras. Link-only, never fetched.
  readonly liveViewUrl?: string;
  // Optional receipt timestamp (ISO) for the live-view TTL auto-fade (~2h). Not yet populated by the read-model
  // (the report entity carries no receipt time) — the chip treats an absent timestamp as fresh. See CW5 note.
  readonly submittedAt?: string;
}
/** GET /reports — the verifier queue (envelope `data` is an OBJECT with the `reports` array). */
export interface ReportsData {
  readonly reports: readonly ReportSummary[];
}

/** A computed DRAFT alert as listed for review (GET /alerts, T-387). DRAFT-only — never emitted (Art. XIII). */
export interface AlertSummary {
  readonly id: string;
  readonly state: string; // always 'DRAFT' here
  readonly category?: string;
  readonly severity?: string;
  readonly incidentId?: string;
  /**
   * WP A8 / F-301 — the forecast evidence behind an ANTICIPATORY DRAFT. OPTIONAL on the client for two
   * reasons that both matter: an observed-rule DRAFT genuinely has none, and a server predating the field
   * must not make the panel throw (the same backward-compatible tolerance `SitRepData.outlook` carries).
   */
  readonly forecast?: ForecastEvidence;
}
/** GET /alerts — the DRAFT alert queue (envelope `data` is an OBJECT with the `alerts` array). */
export interface AlertsData {
  readonly alerts: readonly AlertSummary[];
}

/** POST /reports — creation result (always UNVERIFIED + confidence components, EV4). */
export interface ReportResult {
  readonly id: string;
  readonly status: string;
  readonly confidence?: Readonly<Record<string, number>>;
}

/** A shelter matched to a route request (capacity vs demand — non-color-encoded downstream). */
// F-406 — the POST /routes RESPONSE was the third hand-mirror on this one endpoint (the request body was
// F-361). It declared `geometry?: unknown` where the server sends `route: EvacRoute`, so the panel's route
// was permanently undefined; and it invented `ShelterMatch.name`/`.demand`, fields the `Shelter` entity has
// never had, so every row rendered an id in place of a name and a literal "—" for demand. All three
// mismatches typechecked. DERIVED from the server's own `RoutesData` (logistics.ts) — see the F-364 note above.
export type { RoutesData as RouteData } from '@/adapters/channels/http/routes/logistics.js';
/** The shelter rows the routing panel ranks — the DOMAIN entity the server actually sends, not a mirror. */
export type { Shelter as ShelterMatch } from '@/domain/shelter.js';

/** POST /alerts — DRAFT alert (never auto-promoted to ACTUAL, Art. XIII). F-407: DERIVED, was `{id, state}`
 *  — neither key exists on the response, so every field of `draftAlert()`'s result read `undefined`. */
export type { AlertDraftData as AlertResult } from '@/application/interaction/command-router.js';

// F-190 (found while building the F-140 end-to-end guard test): this type previously declared a FLAT
// `{id, status}` shape, but the server's actual success body (`success(201, { task: res.value }, …)` in
// src/adapters/channels/http/routes/logistics.ts) nests the created task under a `task` key — so
// `Envelope<ResourceTaskResult>.data.id`/`.status` were never populated by any real response. Unused
// elsewhere in the FE today (only threaded as a type, never destructured — confirmed by repo-wide grep), so
// nothing else needed to change, but corrected here rather than left to bite the next caller.
// F-191 follow-through: the nesting key AND the lifecycle vocabulary are now derived too. `status` is the
// DOMAIN's `ResourceTaskStatus` rather than an open `string`, because the board feeds it straight back into
// the domain state machine to compute the next legal step — an open string there would let an unknown token
// silently produce "no next step" instead of a compile error.
/** One resource task as the client tracks it (the created/advanced task the server confirmed). */
export interface ResourceTaskView {
  readonly id: string;
  readonly status: ResourceTaskStatus;
}

/** POST /resource-tasks — the created OR advanced task (server nests it under its own `task` key). */
export type ResourceTaskResult = Readonly<Record<keyof ResourceTaskData, ResourceTaskView>>;

/** GET /pre-positioning — one advisory suggestion (engine ranks, human decides — Art. XII/XIII). */
export interface PrePositioningSuggestionSummary {
  readonly kind: 'RESOURCE' | 'SHELTER';
  readonly refId: string;
  readonly distanceMeters: number;
  readonly resourceKind?: string;
  readonly capacity?: number;
  readonly occupancy?: number;
}
/** GET /pre-positioning — pre-positioning-from-predictions suggestions (envelope `data` is an OBJECT). */
export interface PrePositioningData {
  readonly method: string;
  /** False when no projected hazard extent is known yet for the incident (labeled "not yet", not a bug). */
  readonly extentAvailable: boolean;
  readonly suggestions: readonly PrePositioningSuggestionSummary[];
}

// ── Request bodies (only present fields are sent — exactOptionalPropertyTypes-safe) ──

export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

// ── F-364: the THREE remaining hand-duplicated wire types, now DERIVED ────────────────────────────────
//
// The E3 re-audit proved the root cause instead of inferring it. Of the five request bodies this file
// declared, TWO were derived from the server (the F-140/F-192 fix) and THREE were hand-written mirrors —
// and those three were **exactly** the three broken contracts. 3-for-3:
//   • SubmitReportBody  → every SOS coordinate silently discarded, answered 201 Created  (F-360)
//   • RequestRouteBody  → POST /routes 400'd on every submit; the evac panel was dead     (F-361)
//   • VerifyReportBody  → `emitCap` read by nothing under src/; "Approve + CAP" was fiction (F-362)
//
// The lesson is structural, not clerical: a hand-written mirror can be wrong in a way `tsc` cannot see,
// because BOTH sides typecheck perfectly against their own private idea of the wire. Correctness of the
// copy was never the variable — derivation is. Each of these now makes the next divergence a COMPILE error.
export type { SubmitReportWireBody as SubmitReportBody } from '@/adapters/channels/http/routing.js';
export type { VerifyReportWireBody as VerifyReportBody } from '@/adapters/channels/http/routing.js';

export interface DraftAlertBody {
  readonly incidentId: string;
  readonly headline: string;
}

// F-140: TaskResourceBody is DERIVED from the server's own wire contract (ResourceTaskWireBody, defined
// next to parseResourceTask in feature-router.ts — which is itself derived from ResourceTaskRequest, the
// type handleResourceTask actually consumes) instead of being hand-duplicated here. The former hand-authored
// version declared `transition: string` (server reads `status`, and `string` let any token — even an invalid
// one — through with 0 tsc errors) and an OPTIONAL `incidentId` (the server hard-fails without one). Both
// were wrong at once, proving a correct-but-duplicated type would still have drifted; only a derived one
// makes the mismatch a compile error instead of a runtime 400 (see the comment on ResourceTaskWireBody for
// the full rationale).
export type { ResourceTaskWireBody as TaskResourceBody } from '@/adapters/channels/http/routes/feature-router.js';

// F-361 — see the F-364 note above. `RouteWireBody` lives next to `parseRoutes`, the parser that actually
// consumes it. The mirror this replaces sent `origin: {lat, lon}` (the parser reads a `[lon, lat]` Position),
// omitted the `destination` the handler required, and carried a `regionId` no route has ever read.
export type { RouteWireBody as RequestRouteBody } from '@/adapters/channels/http/routes/feature-router.js';

// ── GET /regions/:id/map — the DOMAIN-shaped map projection wire shape (mirrors the core MapProjection). ──
// The client RENDERS this (never scores it, Art. XII); precise report geometry is present ONLY when the
// authenticated actor is RESPONDER+ (server-gated in projectMap, Art. XIV).

/** A geolocated projected feature; `precisePosition` present only for RESPONDER+ responses (Art. XIV). */
export interface ProjectedFeatureData {
  readonly id: string;
  readonly position: Position;
  readonly precisePosition?: Position;
}

export interface ProjectedHazardData {
  readonly id: string;
  readonly kind: string; // HOTSPOT | PERIMETER | FLOOD_REACH | SPREAD_CONE | TRACK | CONE | STORM_SURGE
  readonly geometry: Geometry;
  readonly observedAt: string;
  readonly intensity?: number;
}
export interface ProjectedGaugeData extends ProjectedFeatureData {
  readonly floodCategory: string;
  readonly stage?: number;
}
export interface ProjectedInfraData extends ProjectedFeatureData {
  readonly kind: string;
  readonly status: string;
}
export interface ProjectedExposureData extends ProjectedFeatureData {
  readonly reason: string;
  readonly insideHazard: boolean;
}
export interface ProjectedShelterData extends ProjectedFeatureData {
  readonly capacity: number;
  readonly demand: number;
  readonly status: string;
}
export interface ProjectedReportData extends ProjectedFeatureData {
  readonly status: string;
  readonly confidence?: number;
}
export interface ProjectedPredictionData {
  readonly id: string;
  readonly geometry: Geometry;
  readonly method: string;
  readonly inputs: string;
  readonly uncertainty: string;
}
export interface ProjectedRouteData {
  readonly id: string;
  readonly path: readonly Position[];
  readonly avoidsHazard: boolean;
}

/** A power-outage area (EAGLE-I-derived or ASSUMED-offline from hazard∩infra — always labelled). */
export interface ProjectedOutageData {
  readonly id: string;
  readonly polygon: readonly (readonly Position[])[]; // GeoJSON-style polygon rings
  readonly assumedOffline?: boolean; // inference, not observation — surfaced as a caveat
  readonly customersOut?: number;
}

/** A cell-coverage site (CELL infrastructure / OpenCelliD / CAMARA-mock). */
export interface ProjectedCellData {
  readonly id: string;
  readonly position: Position;
  readonly online?: boolean;
  readonly technology?: string;
}

/** The deterministic wind observation as a map glyph (observation POINT — never synthesized grids). */
export interface ProjectedWeatherData {
  readonly position: Position;
  readonly speedKmh: number;
  readonly directionDeg: number; // wind FROM bearing, degrees
  readonly compass: string; // 8-point token (N, NE, …) — localized from the catalog at render time
  readonly observedAt: string; // ISO-8601, formatted client-side in the region's timezone
  readonly label: string; // pre-rendered ENGLISH label; the fallback when no translator is available
}

/** A FEMA-NFHL (or equivalent) flood-zone polygon (regulatory zone, not live extent — labelled). */
export interface ProjectedFloodZoneData {
  readonly id: string;
  readonly zone: string; // e.g. "AE"
  readonly polygon: readonly (readonly Position[])[];
}

/**
 * The STORM family as one wire slice (ADR-032; mirrors the core `ProjectedStorm`): cyclone centre `track`
 * (a line), agency forecast `cone` and `surge` impact extent (polygons), plus the issuing `agency` and
 * `advisoryAt` the cone's uncertainty label names. Ingested agency products rendered verbatim — BEACON runs
 * no cyclone/wind/surge model, so there is no BEACON-computed uncertainty number to carry (Art. XIV).
 */
export interface ProjectedStormData {
  readonly track?: readonly Position[];
  readonly cone?: readonly (readonly Position[])[];
  readonly surge?: readonly (readonly Position[])[];
  readonly agency?: string;
  readonly advisoryAt?: string;
}

/** A live camera pin (E11 "Live Views"). Link-only: `viewUrl` opens the source's own page in a new tab —
 *  the client never embeds/proxies video and never scores a pixel (Art. XII). https-guaranteed upstream. */
export interface ProjectedCameraData {
  readonly id: string;
  readonly position: Position;
  readonly kind: string; // FIRE_CAMERA | TRAFFIC_CCTV | WEBCAM | CITIZEN_STREAM
  readonly title: string;
  readonly provider: string;
  readonly viewUrl: string; // external live-view page (https)
  readonly isLive: boolean;
}

/** GET /regions/:id/map — full COP geometry for a region (each slice may be empty; route optional). */
export interface MapProjectionData {
  readonly regionId: string;
  readonly incidentType: string;
  readonly hazards: readonly ProjectedHazardData[];
  readonly gauges: readonly ProjectedGaugeData[];
  readonly infrastructure: readonly ProjectedInfraData[];
  readonly exposure: readonly ProjectedExposureData[];
  readonly shelters: readonly ProjectedShelterData[];
  readonly reports: readonly ProjectedReportData[];
  /** Every map-plottable prediction, in derivation order (ADR-033 §3.1); `[]` when the region has none. */
  readonly predictions: readonly ProjectedPredictionData[];
  /**
   * @deprecated Use {@link MapProjectionData.predictions}. Additive-compatibility mirror of `predictions[0]`
   * kept so a v1 client that ignores the plural field keeps working (SPEC-FINAL-VERSION-DELTA §1.1).
   */
  readonly prediction?: ProjectedPredictionData;
  readonly route?: ProjectedRouteData;
  // Phase-D layers (optional — absent until the server emits them; contract stays backward-compatible):
  readonly outage?: readonly ProjectedOutageData[];
  readonly cell?: readonly ProjectedCellData[];
  readonly weather?: ProjectedWeatherData;
  readonly floodZones?: readonly ProjectedFloodZoneData[];
  readonly cameras?: readonly ProjectedCameraData[];
  readonly storm?: ProjectedStormData;
  /** Per-layer source attribution (layerId → provenance sourceId) enabling per-layer freshness badges. */
  readonly layerSources?: Readonly<Partial<Record<LayerId, string>>>;
}
