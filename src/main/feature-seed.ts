// BEACON — feature-adapter composition + offline seed (E-main; ADR-016/ADR-006/ADR-010, Art. XVI). The ONE
// place that assembles the logistics / routing / interop / eventbus feature adapters the HTTP feature-router
// dispatches to, from a tiny air-gapped dataset (CA + RO), with MOCK-mode provenance (never presented as
// live). Real deployments swap the seed / adapters via config; the wiring stays identical.
import { makeResource } from '@/domain/resource.js';
import { positionsOf } from '@/application/shared/region-clip.js';
import { makeShelter } from '@/domain/shelter.js';
import { makeThresholdRule, uniqueRules } from '@/domain/threshold-rule.js';
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import type { FloodCategory } from '@/domain/gauge.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  IncidentId,
  OrgId,
  ResourceId,
  ShelterId,
  AlertId,
  ThresholdRuleId,
  SourceId,
  RegionId,
} from '@/domain/value-objects/ids.js';
import type {
  Geometry,
  PointGeometry,
  PolygonGeometry,
  Position,
} from '@/domain/value-objects/geo.js';
import type { SpatialPort } from '@/ports/infra.js';
import type { RoutingPort } from '@/ports/logistics.js';
import type { LogisticsSeed } from '@/adapters/logistics/memory-logistics.js';
import { makeLogisticsAdapter } from '@/adapters/logistics/memory-logistics.js';
import type { LogisticsAdapter } from '@/adapters/logistics/memory-logistics.js';
import { makePgLogisticsStore } from '@/adapters/logistics/pg-logistics.js';
import { makePgEvacRouteStore } from '@/adapters/persistence/evac-route-store.js';
import {
  DEFAULT_CAPACITY_MATCH_DIRECTION,
  type CapacityMatchDirection,
} from '@/adapters/logistics/shelter-ranking.js';
import { makeDb } from '@/adapters/persistence/client.js';
import { makeRoutingAdapter } from '@/adapters/routing/memory-routing.js';
import { makeOrsRoutingAdapter } from '@/adapters/routing/ors-routing.js';
import { makeSpatialPort } from '@/adapters/spatial/index.js';
import { makeHttpClient, type HttpClient } from '@/adapters/ai/http-client.js';
import { makeAlertSink } from '@/adapters/alerting/alert-sink.js';
import { makeCapTextProvider } from '@/adapters/alerting/cap-text.js';
import { toCapProfileId } from '@/adapters/interop/cap-profile.js';
import type { CapOptions } from '@/adapters/interop/cap-mapper.js';
import { loadRegionRegistry } from '@/adapters/persistence/region-registry.js';
import type { Alert } from '@/domain/alert.js';
import {
  makeTelegramMessaging,
  telegramConfigFromEnv,
  type FetchLike,
} from '@/adapters/channels/messaging/messaging-port.js';
import { makeNotifier } from '@/adapters/channels/messaging/notification.js';
import {
  makeInMemorySubscriberRegistry,
  parseChatIds,
} from '@/adapters/channels/messaging/subscriber-registry.js';
import { createInMemoryEventBus } from '@/adapters/eventbus/in-memory-eventbus.js';
import {
  makeInMemoryAlertStore,
  makeInMemoryEdxlRmStore,
  type InteropDeps,
} from '@/adapters/channels/http/routes/interop.js';
import { makeMemoryMapReadModel, type MapSeed } from '@/adapters/memory/memory-map.js';
import {
  deriveDraftAlertProposals,
  type ThresholdAlertSpec,
} from '@/application/derivation/derive-alerts.js';
import type { DraftAlertProposal } from '@/application/threshold-evaluation/threshold-evaluation.js';
import { forecastReadingFromGauge } from '@/application/threshold-evaluation/threshold-evaluation.js';
import {
  toForecastEvidence,
  type ForecastEvidence,
} from '@/application/anticipatory/forecast-evidence.js';
import type { HttpFeatureDeps } from '@/adapters/channels/http/http-types.js';
import { DEFAULT_MAP_SEED } from './map-seed.js';
import { RO_EXCEEDANCE_PROBABILITY } from './scenario-inputs.js';

// The 2 demo incidents (mirror src/main/seed.ts DEFAULT_SEED). Treated as VERIFIED for the offline demo so
// resource-tasking is legal (Art. XIII/ST1); real deployments derive this from the report/incident lifecycle.
const CA_INCIDENT = asId<IncidentId>('us-ca-wildfire-demo');
const RO_INCIDENT = asId<IncidentId>('ro-flood-demo');
const CA_ORG = asId<OrgId>('cal-fire');
const RO_ORG = asId<OrgId>('isu-ro');

const point = (coordinates: PointGeometry['coordinates']): PointGeometry => ({
  type: 'Point',
  coordinates,
});

/** A small square hazard footprint (~0.05° box) around an incident centroid — a labelled first-order buffer. */
function hazardBox(center: readonly [number, number]): PolygonGeometry {
  const [x, y] = center;
  const d = 0.05;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x - d, y - d],
        [x + d, y - d],
        [x + d, y + d],
        [x - d, y + d],
        [x - d, y - d],
      ],
    ],
  };
}

/**
 * Everything the feature seed carries as RAW INPUTS: logistics store contents, a per-incident hazard map,
 * the per-incident projected hazard-arrival input (for the computed evac suggested_start, FR-7), and the
 * threshold RULES + current readings from which the DRAFT alerts are COMPUTED (FR-11) — never hand-seeded.
 */
export interface FeatureSeed {
  readonly logistics: LogisticsSeed;
  /** incidentId → hazard footprint the router avoids (keyed by the raw id string). */
  readonly hazards: ReadonlyMap<string, Geometry>;
  /** incidentId → projected hazard-arrival instant (ISO-8601) feeding the evac suggested_start (FR-7). */
  readonly hazardArrival: ReadonlyMap<string, string>;
  /** Threshold RULES + current readings → the DRAFT alerts are COMPUTED at build (FR-11, Art. XIII). */
  readonly thresholds: readonly ThresholdAlertSpec[];
  /**
   * FORECAST threshold rules, as a function of the evaluation instant (C2.4, ADR-033 §6; finding F-81).
   *
   * Why a function and not another array: a forecast reading is only meaningful RELATIVE to the instant it
   * is read at. `forecast-trigger.json` refuses a reading whose source issue instant is older than one
   * source update cycle (24 h) — so a seed carrying a FIXED vintage would fire on the day it was written and
   * then silently stop firing forever, taking the anticipatory surface off camera with no test failing. The
   * evaluator's own clock is passed in instead, so the seeded run is always "issued N hours ago" and the
   * behaviour is identical under an injected fixed clock (deterministic tests) and under the wall clock (the
   * live demo). Same Art. XIII terms as every other rule: a fire yields a DRAFT alert and nothing else.
   */
  readonly forecastThresholds?: (now: number) => readonly ThresholdAlertSpec[];
  /**
   * incidentId → the config region id (config/regions.json) the incident sits in, and therefore the
   * LANGUAGES its alerts must be emitted in (ADR-036 §5, finding F-53). Explicit rather than inferred from
   * the incident id string: guessing "us-ca-wildfire-demo" ⇒ region "us-ca" would silently mis-assign
   * languages the moment an id is renamed, and the languages of a public warning are not a thing to guess.
   * An unmapped incident emits ENGLISH ONLY (never another region's language).
   */
  readonly incidentRegions?: ReadonlyMap<string, string>;
  /**
   * The rules GET /threshold-rules lists, when they are not simply the rules of `thresholds`. The live
   * picture (ADR-044) lists every configured rule of the region, whether or not a live reading existed
   * for it this cycle.
   */
  readonly ruleCatalogue?: readonly ThresholdRule[];
  /** incidentId → the human `<areaDesc>` for CAP. Geometry cannot supply the words CAP requires. */
  readonly incidentAreaDesc?: ReadonlyMap<string, string>;
}

const CA_CENTER: readonly [number, number] = [-121.6, 39.7]; // Butte County, CA (wildfire demo)
const RO_CENTER: readonly [number, number] = [28.0, 45.45]; // Galați County, RO (flood demo)

/**
 * The threshold RULES + their current readings for the offline demo. The CA rule (a lifeline node has
 * entered the fire's hazard buffer) FIRES on the seeded reading ⇒ the derivation computes the DRAFT alert
 * `ca-alert-draft-1` (Fire/SEVERE) the HITL approve gate loads — a below-threshold reading would compute none.
 */
const DEFAULT_THRESHOLDS: readonly ThresholdAlertSpec[] = [
  {
    rule: makeThresholdRule({
      id: asId<ThresholdRuleId>('ca-hazard-buffer-rule'),
      target: 'HAZARD_BUFFER',
      operator: 'enters',
      value: '1000m',
    }),
    reading: { hazardWithinBuffer: true }, // current input: a lifeline node sits within the fire hazard buffer
    incidentId: CA_INCIDENT,
    alertId: asId<AlertId>('ca-alert-draft-1'),
    category: 'Fire',
    severity: 'SEVERE',
    sourceId: asId<SourceId>('firms'),
  },
];

// ── The ANTICIPATORY (forecast-crossing) rule — finding F-81 ──────────────────────────────────────────
// F-81: `FORECAST_GAUGE_CATEGORY` was fully implemented and fully unit-tested, but no seed ever built one,
// so nothing in the RUNNING app ever exercised it — a feature with no on-camera moment. This is the seeded
// rule that makes it reachable: the RO flood incident's GloFAS reporting point forecasts a MODERATE crossing
// ahead of the observed MINOR stage, and the DRAFT alert `ro-alert-forecast-draft-1` exists ONLY because
// that forecast crossing cleared every gate in config/forecast-trigger.json.
//
// Art. XIII, unchanged and unrelaxed: the fire produces a DRAFT (`buildDraftAlert` hardcodes the literal, and
// `DraftAlert` is not assignable to `EmittableAlert`), and promotion to an ACTUAL public CAP still requires an
// authenticated VERIFIER/EM. No report — verified or otherwise — is anywhere in this path: the signal is a
// gauge forecast from a named source, so this cannot become the route by which an UNVERIFIED report emits.
//
// The reading is a RAW INPUT like every other seeded reading (MOCK-labelled offline provenance, `glofas`
// cited): the exceedance probability is the SAME source-published figure the RO scenario already carries
// (`RO_EXCEEDANCE_PROBABILITY`, imported rather than re-typed), classified by the shared C1 classifier via
// `forecastReadingFromGauge` — this module classifies nothing itself.
const RO_FORECAST_CATEGORY: FloodCategory = 'MODERATE'; // forecast category (observed stage is MINOR)
const RO_FORECAST_LEAD_TIME_HOURS = 18; // inside forecast-trigger.json's 0–168 h window
const RO_FORECAST_ISSUE_LAG_HOURS = 6; // "issued 6 h ago" — inside the 24 h vintage window
const MS_PER_HOUR = 3_600_000;

function defaultForecastThresholds(now: number): readonly ThresholdAlertSpec[] {
  return [
    {
      rule: makeThresholdRule({
        id: asId<ThresholdRuleId>('ro-forecast-crossing-rule'),
        scope: asId<RegionId>('ro'),
        target: 'FORECAST_GAUGE_CATEGORY',
        operator: 'gte',
        value: 'MODERATE',
      }),
      reading: forecastReadingFromGauge(
        { floodCategory: RO_FORECAST_CATEGORY, exceedanceProbability: RO_EXCEEDANCE_PROBABILITY },
        {
          etaHours: RO_FORECAST_LEAD_TIME_HOURS,
          issuedAt: new Date(now - RO_FORECAST_ISSUE_LAG_HOURS * MS_PER_HOUR).toISOString(),
        },
      ),
      incidentId: RO_INCIDENT,
      alertId: asId<AlertId>('ro-alert-forecast-draft-1'),
      // CAP v1.2 has no "Flood" category; a river-flood warning is `Met` (the same mapping the RO scenario
      // uses elsewhere). SEVERE matches the forecast MODERATE-crossing of a populated reach.
      category: 'Met',
      severity: 'SEVERE',
      sourceId: asId<SourceId>('glofas'),
    },
  ];
}

/** The built-in offline feature dataset (CA + RO). MOCK-mode; honest labelling (Art. XVI). */
export const DEFAULT_FEATURE_SEED: FeatureSeed = {
  logistics: {
    resources: [
      makeResource({
        id: asId<ResourceId>('ca-engine-1'),
        kind: 'ENGINE',
        status: 'AVAILABLE',
        orgId: CA_ORG,
        geom: point([-121.55, 39.72]),
      }),
      makeResource({
        id: asId<ResourceId>('ca-crew-1'),
        kind: 'CREW',
        status: 'AVAILABLE',
        orgId: CA_ORG,
      }),
      makeResource({
        id: asId<ResourceId>('ro-medical-1'),
        kind: 'MEDICAL',
        status: 'AVAILABLE',
        orgId: RO_ORG,
        geom: point([28.05, 45.43]),
      }),
    ],
    shelters: [
      makeShelter({
        id: asId<ShelterId>('ca-shelter-1'),
        geom: point([-121.4, 39.75]),
        capacity: 200,
        occupancy: 20,
        orgId: CA_ORG,
      }),
      makeShelter({
        id: asId<ShelterId>('ro-shelter-1'),
        geom: point([28.2, 45.5]),
        capacity: 120,
        occupancy: 0,
        orgId: RO_ORG,
      }),
    ],
    verifiedIncidents: [CA_INCIDENT, RO_INCIDENT],
  },
  hazards: new Map<string, Geometry>([
    [String(CA_INCIDENT), hazardBox(CA_CENTER)],
    [String(RO_INCIDENT), hazardBox(RO_CENTER)],
  ]),
  hazardArrival: new Map<string, string>([
    [String(CA_INCIDENT), '2026-07-06T02:00:00Z'], // projected fire arrival at the evac origin (raw input)
    [String(RO_INCIDENT), '2026-07-06T06:00:00Z'], // projected flood-crest arrival (raw input)
  ]),
  thresholds: DEFAULT_THRESHOLDS,
  forecastThresholds: defaultForecastThresholds,
  // The CA incident's region speaks English only ⇒ one <info> block; the RO incident's region is configured
  // `languages: ['ro']` ⇒ its alerts emit a Romanian AND an English <info> block (FR-I18N-6).
  incidentRegions: new Map<string, string>([
    [String(CA_INCIDENT), 'us-ca'],
    [String(RO_INCIDENT), 'ro'],
  ]),
  incidentAreaDesc: new Map<string, string>([
    [String(CA_INCIDENT), 'Butte County, California'],
    [String(RO_INCIDENT), 'Galați County, Romania'],
  ]),
};

/** Local deterministic-ish id minter (prefix + boot epoch + counter) — matches build-core's default. */
function defaultIdMinter(clock: () => string): (prefix: string) => string {
  const boot = Date.parse(clock());
  let n = 0;
  return (prefix) => `${prefix}-${boot}-${++n}`;
}

export interface BuildFeatureDepsOptions {
  /** Injected clock (shared with the core). */
  readonly clock: () => string;
  /** Injected id minter (tests inject a counter). Defaults to a boot-epoch minter. */
  readonly newId?: (prefix: string) => string;
  /** Offline dataset (defaults to the built-in CA + RO feature seed). */
  readonly seed?: FeatureSeed;
  /** Offline map-geometry dataset backing GET /regions/:id/map (defaults to the built-in CA + RO map seed). */
  readonly mapSeed?: MapSeed;
  /** Spatial engine (defaults to the config-selected SpatialPort — Turf.js offline). */
  readonly spatial?: SpatialPort;
  /** SSE heartbeat interval in ms (0/omitted ⇒ disabled — deterministic tests). */
  readonly heartbeatMs?: number;
  /**
   * RAW environment record (mirrors build-core.ts's resolveAi idiom — read at the call site, not the
   * parsed EnvSchema). `FEATURE_ROUTING=ors` + a non-empty `ORS_API_KEY` selects the ORS routing ladder
   * (ORS → heuristic fallback below); anything else keeps today's byte-identical heuristic-only default.
   * Defaults to `process.env` — EnvSchema's `FEATURE_ROUTING=ors ⇒ ORS_API_KEY` refine is the fail-fast
   * gate at boot (config/index.ts); this ladder degrades honestly (never throws) even if reached unvalidated.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Injected HTTP client for the ORS rung (tests supply a fake; defaults to makeHttpClient() / real fetch). */
  readonly orsHttp?: HttpClient;
  /** Injected fetch for the LIVE Telegram broadcast transport (tests supply a fake; defaults to real fetch). */
  readonly telegramFetch?: FetchLike;
}

/** The optional HITL-broadcast interop deps (notifier + subscriber registry), or {} when Telegram is not live. */
type BroadcastDeps = Pick<InteropDeps, 'notifier' | 'subscribers'>;

/**
 * Compose the approved-alert broadcast deps from the raw env (Art. XIII/XIV, ADR-023): CHANNEL_TELEGRAM_MODE=
 * live + TELEGRAM_BOT_TOKEN + a non-empty TELEGRAM_ALERT_CHAT_IDS ⇒ a NotificationPort (the EXISTING
 * makeNotifier: PII-redact + firewall + hash-chained audit; type-prevents a raw transport reaching the
 * handler) over the REAL Telegram transport, plus the chat-id registry. Anything unset ⇒ {} (no broadcast —
 * byte-identical to the mock default). Extracted to keep buildFeatureDeps under the complexity gate.
 */
function makeBroadcastDeps(
  rawEnv: Readonly<Record<string, string | undefined>>,
  clock: () => string,
  telegramFetch?: FetchLike,
): BroadcastDeps {
  const telegramConfig = telegramConfigFromEnv(rawEnv);
  const chatIds = parseChatIds(rawEnv.TELEGRAM_ALERT_CHAT_IDS);
  if (telegramConfig.mode !== 'live' || telegramConfig.token === undefined || chatIds.length === 0)
    return {};
  const transport = makeTelegramMessaging(telegramConfig, telegramFetch ?? fetch);
  return {
    notifier: makeNotifier({ transport, clock, audit: [] }),
    subscribers: makeInMemorySubscriberRegistry(chatIds),
  };
}

/**
 * The per-alert, REGION-AWARE CAP options every emission is built with (ADR-036 §5; finding F-53).
 *
 * This is the production caller `capTranslationsFor()` never had. The region registry is loaded from
 * config/regions.json — adding a language to a region is a config edit, and the next emitted CAP for that
 * region carries an extra `<info>` block with no code change (ADR-012).
 *
 * DEGRADE, NEVER DEAD-END (Art. XVI): if the registry cannot be read, alerts still emit — in English only,
 * which is the same document the system produced before this wiring existed. A config problem must not stop
 * a warning.
 */
function makeCapOptionsFor(seed: FeatureSeed): ((alert: Alert) => CapOptions) | undefined {
  const loaded = loadRegionRegistry();
  if (!loaded.ok) return undefined;
  return makeCapTextProvider({
    regions: loaded.value,
    regionIdFor: (alert) => seed.incidentRegions?.get(String(alert.incidentId)),
    areaDescFor: (alert) => seed.incidentAreaDesc?.get(String(alert.incidentId)),
  });
}

/**
 * The fully-wired CAP emission sink (D3, ADR-036):
 *  • `capOptionsFor` — the region-aware MULTILINGUAL hop finding F-53 said was missing. Every emitted
 *    document now carries one `<info>` block per language of the alert's region, English always present.
 *  • `capProfile` — the BLOCKING profile gate (`CAP_PROFILE`; default `base` = CAP v1.2 and nothing more).
 *    Read off the RAW env at the composition site, the same idiom as every other per-adapter mode; the
 *    EnvSchema entry is what makes an unknown value a boot error rather than a silent downgrade.
 */
function makeCapSink(
  clock: () => string,
  seed: FeatureSeed,
  rawEnv: Readonly<Record<string, string | undefined>>,
): ReturnType<typeof makeAlertSink> {
  const capOptionsFor = makeCapOptionsFor(seed);
  return makeAlertSink({
    clock,
    ...(capOptionsFor !== undefined ? { capOptionsFor } : {}),
    capProfile: toCapProfileId(rawEnv.CAP_PROFILE),
  });
}

/**
 * The COMPUTED DRAFT alerts for this seed (FR-11, Art. XIII). Observed rules and FORECAST rules are
 * evaluated together against ONE instant — the injected clock — so a forecast rule's vintage and lead-time
 * gates (config/forecast-trigger.json) are judged against the same `now` the reading was built for (F-81).
 * Every output is cap_status=DRAFT by construction; promotion still requires a human (Art. XIII).
 *
 * The PROPOSAL is kept whole (WP A8 / finding F-301). Narrowing to bare `Alert`s here is precisely what
 * dropped the forecast evidence — the lead time, expected crossing instant, vintage and classified
 * likelihood a `FORECAST_GAUGE_CATEGORY` fire computes — before it could reach the wire.
 */
function computeDraftAlertProposals(
  seed: FeatureSeed,
  clock: () => string,
): readonly DraftAlertProposal[] {
  const now = Date.parse(clock());
  const forecast = seed.forecastThresholds === undefined ? [] : seed.forecastThresholds(now);
  return deriveDraftAlertProposals({ specs: [...seed.thresholds, ...forecast], now });
}

/**
 * alertId → the LABELLED forecast evidence that DRAFT rests on (WP A8 / F-301). Built from the very
 * proposals the alert store is seeded with, so the evidence and the alert can never describe different
 * evaluations. An observed-rule DRAFT has no entry: absence is the honest answer (Art. XVI).
 */
function forecastEvidenceIndex(
  proposals: readonly DraftAlertProposal[],
): ReadonlyMap<string, ForecastEvidence> {
  const index = new Map<string, ForecastEvidence>();
  for (const proposal of proposals) {
    const evidence = toForecastEvidence(proposal.forecast);
    if (evidence !== undefined) index.set(String(proposal.alert.id), evidence);
  }
  return index;
}

/** Routing ladder: try `primary` first; ANY failure (typed err, never a throw) descends to `fallback` —
 * used to wrap the ORS rung over the hazard-avoiding heuristic so ORS-down never dead-ends (Art. XVI). */
function withRoutingFallback(primary: RoutingPort, fallback: RoutingPort): RoutingPort {
  return {
    async route(request) {
      const primaryResult = await primary.route(request);
      if (primaryResult.ok) return primaryResult;
      // The reason the road engine stepped aside belongs in the deploy log (an expired ORS key, a daily
      // quota, a refused avoid-polygon), or the operator only ever sees "engine: heuristic" (2026-09-14).
      process.stderr.write(
        `[beacon] routing degraded: ors -> heuristic — ${primaryResult.error.code}: ${primaryResult.error.message}\n`,
      );
      return fallback.route(request);
    },
  };
}

/**
 * Compose the feature adapters (routing + logistics + interop stores/sink + eventbus) the HTTP feature-router
 * dispatches to. Built ONCE at composition so the in-memory stores survive across requests.
 */
/**
 * The logistics store ladder (FR-LD-1/FR-LD-3), read off the RAW env at the composition site — the same
 * idiom as the ORS routing ladder below and `resolveStore` in build-core.ts.
 *
 * `FEATURE_STORE=postgres` selects the durable twin so a tasked resource survives a restart, which is what
 * the live demo runs on; anything else keeps the in-memory default that the offline/air-gapped profile
 * depends on (Art. XVI). Both stores are held to ONE behaviour by logistics-contract.test-suite.ts, so the
 * choice here changes durability and nothing else.
 *
 * `CAPACITY_MATCH_DIRECTION` is threaded into BOTH: it was a documented knob that no code read until this
 * increment, and passing it to only one store would reintroduce the divergence the shared suite exists to
 * prevent. An unrecognised value falls back to the documented default rather than throwing — EnvSchema is
 * the fail-fast gate at boot, and this composition must degrade honestly even if reached unvalidated.
 */
/**
 * The threshold rules `GET /threshold-rules` lists (FR-11 transparency) — the rules `computeDraftAlerts`
 * ACTUALLY evaluates, at the SAME instant, so a forecast rule's vintage and lead-time gates are judged here
 * exactly as they are judged there. The endpoint therefore reports what runs rather than a second
 * description of it, which is the only version of this endpoint that cannot drift from reality.
 */
function evaluatedThresholdRules(seed: FeatureSeed, clock: () => string): readonly ThresholdRule[] {
  const forecast = (seed.forecastThresholds?.(Date.parse(clock())) ?? []).map((spec) => spec.rule);
  // A catalogue names the configured rules; the forecast triggers still evaluated beside it (the hybrid
  // picture keeps them) are listed too, each rule once — the endpoint reports what actually runs.
  if (seed.ruleCatalogue !== undefined) return uniqueRules([...seed.ruleCatalogue, ...forecast]);
  return [...seed.thresholds.map((spec) => spec.rule), ...forecast];
}

function makeLogisticsStore(
  rawEnv: Readonly<Record<string, string | undefined>>,
  seed: FeatureSeed,
): LogisticsAdapter {
  const raw = rawEnv.CAPACITY_MATCH_DIRECTION;
  const capacityMatchDirection: CapacityMatchDirection =
    raw === 'minimize_distance' || raw === 'maximize_availability_per_distance'
      ? raw
      : DEFAULT_CAPACITY_MATCH_DIRECTION;
  if (rawEnv.FEATURE_STORE === 'postgres') {
    return makePgLogisticsStore({
      db: makeDb(rawEnv.DATABASE_URL ?? ''),
      capacityMatchDirection,
      verifiedIncidents: seed.logistics.verifiedIncidents ?? [],
    });
  }
  return makeLogisticsAdapter(seed.logistics, { capacityMatchDirection });
}

/**
 * ADR-039 — the durable evac-route trail, composed only under postgres. `makePgEvacRouteStore` had been
 * exported and composed by NOTHING since E3, which is why `evac_route` was an empty table.
 *
 * Extracted rather than inlined so `buildFeatureDeps` keeps its complexity budget: the composition root is
 * exactly the place where "one more conditional" accumulates until nobody can read it.
 */
function evacRouteTrail(rawEnv: Record<string, string | undefined>): {
  routeStore?: ReturnType<typeof makePgEvacRouteStore>;
} {
  return rawEnv.FEATURE_STORE === 'postgres' && rawEnv.DATABASE_URL !== undefined
    ? { routeStore: makePgEvacRouteStore(makeDb(rawEnv.DATABASE_URL)) }
    : {};
}

export function buildFeatureDeps(options: BuildFeatureDepsOptions): HttpFeatureDeps {
  const { clock } = options;
  const newId = options.newId ?? defaultIdMinter(clock);
  const seed = options.seed ?? DEFAULT_FEATURE_SEED;
  const spatial = options.spatial ?? makeSpatialPort();

  const map = makeMemoryMapReadModel(options.mapSeed ?? DEFAULT_MAP_SEED, spatial);
  const hazardFor = (incidentId: IncidentId): Geometry | undefined =>
    seed.hazards.get(String(incidentId));
  const heuristicRouting = makeRoutingAdapter({ spatial, hazardFor, newId });
  // Evac routing ladder (ADR-016): FEATURE_ROUTING=ors + ORS_API_KEY ⇒ ORS road routing with fallback to
  // the hazard-avoiding heuristic on ANY ORS failure; default/unset ⇒ heuristic-only (byte-identical today).
  const rawEnv = options.env ?? process.env;
  const logistics = makeLogisticsStore(rawEnv, seed);
  const orsApiKey = rawEnv.ORS_API_KEY;
  const routing =
    rawEnv.FEATURE_ROUTING === 'ors' && orsApiKey
      ? withRoutingFallback(
          makeOrsRoutingAdapter({
            http: options.orsHttp ?? makeHttpClient(),
            apiKey: orsApiKey,
            hazardFor,
            newId,
          }),
          heuristicRouting,
        )
      : heuristicRouting;
  // FR-11: the DRAFT alerts are COMPUTED from the seeded threshold rules + current readings (never hand-seeded).
  const proposals = computeDraftAlertProposals(seed, clock);
  const draftAlerts: readonly Alert[] = proposals.map((p) => p.alert);
  const forecastEvidence = forecastEvidenceIndex(proposals);
  const thresholdRules = evaluatedThresholdRules(seed, clock);
  // HITL alert broadcast (Art. XIII/XIV, ADR-023): Telegram-live composition adds notifier + subscribers; unset ⇒ {}.
  const interop: InteropDeps = {
    clock,
    alerts: makeInMemoryAlertStore(draftAlerts),
    edxlRm: makeInMemoryEdxlRmStore(),
    // The CAP emission path, fully wired (D3, ADR-036):
    //  • `capOptionsFor` is the region-aware multilingual hop that finding F-53 said was missing — every
    //    emitted document now carries one <info> block per language of the alert's region, English always.
    //  • `capProfile` is the BLOCKING profile gate (CAP_PROFILE; default `base` = CAP v1.2 and nothing more).
    sink: makeCapSink(clock, seed, rawEnv),
    ...makeBroadcastDeps(rawEnv, clock, options.telegramFetch),
  };
  const eventBus = createInMemoryEventBus();

  return {
    routing,
    logistics,
    map,
    interop,
    eventBus,
    clock,
    newId,
    // FR-7: the per-incident projected hazard-arrival input backing the computed evac suggested_start.
    hazardArrivalFor: (incidentId) => seed.hazardArrival.get(String(incidentId)),
    originFor: (incidentId) => footprintCentre(hazardFor(incidentId)),
    // WP A8/F-301: the forecast evidence behind each anticipatory DRAFT, keyed by the alert it belongs to.
    forecastEvidenceFor: (alertId) => forecastEvidence.get(String(alertId)),
    ...evacRouteTrail(rawEnv),
    // Pre-positioning (W2d): the projected extent per incident + the spatial engine the suggester ranks with.
    spatial,
    projectedExtentFor: hazardFor,
    thresholdRules,
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
  };
}

/** The centre of a footprint's bounding box — "the incident's own place" a route starts from by default. */
function footprintCentre(geometry: Geometry | undefined): Position | undefined {
  if (geometry === undefined) return undefined;
  const pts = positionsOf({ geometry });
  if (pts.length === 0) return undefined;
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}
