// BEACON — 12-factor configuration (E0·T-012/T-013; ADR-012).
// Every model, provider, endpoint, key, flag, per-source mode, and region is env-driven.
// Validated fail-fast at boot: an invalid/missing required value aborts startup with a clear error.
import { z } from 'zod';
import { CAP_PROFILE_IDS, DEFAULT_CAP_PROFILE } from './cap-profiles.js';

const featureFlag = <const T extends readonly [string, ...string[]]>(vals: T, def: T[number]) =>
  z.enum(vals).default(def);

/** The safe local-first DATABASE_URL default (a placeholder). FEATURE_STORE=postgres requires a
 *  DIFFERENT (real) URL so enabling the durable store without configuring a DB fails fast (below). */
const DEFAULT_DATABASE_URL = 'postgres://beacon:beacon@localhost:5432/beacon';

/** The politeness floor for `LIVE_REINGEST_INTERVAL_SEC` (V2·A12). Named so the schema's bound and the
 *  operator-facing error message can never state two different numbers. See that entry for the reasoning. */
const MIN_LIVE_REINGEST_INTERVAL_SEC = 60;

/** The ten D4/D6 flags that get a NEXT_PUBLIC_ browser mirror (ADR-035 §4; F-173). Declared ONCE, here,
 *  and used ONLY to drive the parity refine below (near NEXT_PUBLIC_DRILL_MODE's) — each mirror's field
 *  name is computed from these same strings via template literal (`NEXT_PUBLIC_${flag}`), never re-typed
 *  independently, so a mirror's checked name and the flag it must agree with cannot drift apart (the
 *  F-24/F-140/F-141/F-190/F-192 root-cause class: a re-declared contract drifts, a derived one cannot —
 *  same reasoning `src/application/aggregate/d6-flags.ts` and `.../coordination/coordination-flags.ts`
 *  apply to their own flag lists). If an entry below is ever misspelled, or the schema property it names
 *  is renamed without updating this array, indexing `c[flag]` / `c[`NEXT_PUBLIC_${flag}`]` in the refine
 *  fails to compile (`tsc` names the missing property) — the same "typo is a boot/compile error" guarantee
 *  `D6FlagsAreEnvKeys` gives the D6 tier's own flag list, applied here without importing across the
 *  config→application boundary (this file must stay the foundation those two derive FROM, not the reverse).
 *  NOTE (F-152): nothing composes the D4/D6 modules yet, so these mirrors are, today, ahead of any browser
 *  consumer — the refine below is precisely what keeps that "ahead of its consumer" state from rotting into
 *  the F-32 defect class (a config value that exists and nothing reads, and nothing keeps honest either). */
const D4_D6_BROWSER_MIRRORED_FLAGS = [
  'FEATURE_D4_RUMOR_BOARD',
  'FEATURE_D4_MUTUAL_AID',
  'FEATURE_D4_SHELTER_STATUS',
  'FEATURE_D4_DAMAGE_REPORTS',
  'FEATURE_D4_EMS_OVERLAY',
  'FEATURE_D6_VOLUNTEER_TEAMS',
  'FEATURE_D6_SUPPLIES',
  'FEATURE_D6_REUNIFICATION_LINKS',
  'FEATURE_D6_INCIDENT_EXPORT',
  'FEATURE_D6_CASUALTY_TALLY',
] as const;

/** The D2 anticipatory-action flag that gets a browser mirror (ADR-034; lane D7). Declared as its own list
 *  rather than appended to the D4/D6 array above so each tier's list keeps naming exactly its own tier, and
 *  COMPOSED into `BROWSER_MIRRORED_FLAGS` below — the refine and the transform loop over the composed list,
 *  so a flag added to EITHER list is mirrored, checked and inherited without a second edit anywhere. */
const D2_BROWSER_MIRRORED_FLAGS = ['FEATURE_ANTICIPATORY_PANEL'] as const;

/** The Live-Views flag that gains a browser mirror in the live-demo increment (ADR-037 §1). Its own list
 *  for the same reason as the two above: each tier names exactly its own flags, and the composition below
 *  is what makes one edit here enough to get parity-checking + inheritance. */
const LIVE_VIEWS_BROWSER_MIRRORED_FLAGS = ['FEATURE_EXTERNAL_VIEWS'] as const;

/** Every server flag that has a `NEXT_PUBLIC_` browser mirror. The ONE list the parity refine and the
 *  inheritance transform below iterate — derived by composition from the per-tier lists, never re-typed
 *  (F-24/F-140/F-141/F-190/F-192: a re-declared contract drifts, a derived one cannot). */
const BROWSER_MIRRORED_FLAGS = [
  ...D4_D6_BROWSER_MIRRORED_FLAGS,
  ...D2_BROWSER_MIRRORED_FLAGS,
  ...LIVE_VIEWS_BROWSER_MIRRORED_FLAGS,
] as const;

/** The canonical environment schema. Extended as S05 tasks land; the shape is the source of truth. */
export const EnvSchema = z
  .object({
    // Runtime / deploy
    NODE_ENV: featureFlag(['development', 'production', 'test'], 'development'),
    DEPLOY_MODE: featureFlag(['local', 'cloud'], 'local'),
    APP_PORT: z.coerce.number().int().positive().default(3000),
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),
    LOG_LEVEL: featureFlag(['info', 'debug', 'warn', 'error'], 'info'),

    // Database
    DATABASE_URL: z.string().min(1).default(DEFAULT_DATABASE_URL),

    // Feature-flagged infra (Article XVI redundancy ladders)
    FEATURE_SPATIAL: featureFlag(['turf', 'postgis'], 'turf'),
    FEATURE_CACHE: featureFlag(['memory', 'redis'], 'memory'),
    FEATURE_QUEUE: featureFlag(['cron', 'bullmq'], 'cron'),
    FEATURE_EVENTBUS: featureFlag(['memory', 'redis'], 'memory'),
    FEATURE_REALTIME: featureFlag(['sse', 'polling'], 'sse'),
    FEATURE_VISION: featureFlag(['off', 'on'], 'off'),
    // Durable read/write stores (public reports + triage audit + regions + sources). `memory` keeps the
    // offline-first, air-gapped default (Art. XVI); `postgres` moves those stores onto the DB (incidents
    // COP stays in-memory either way). Requires a real DATABASE_URL when set to postgres (refine below).
    FEATURE_STORE: featureFlag(['memory', 'postgres'], 'memory'),
    REDIS_URL: z.string().optional(),

    // AI — default OFF so the validated default matches the offline-first wiring (resolveAi reads the raw
    // env: an unset AI_MODE yields deterministic-only). Set AI_MODE=cloud|local + LLM_TIER_* to enable.
    AI_MODE: featureFlag(['cloud', 'local', 'off'], 'off'),

    // Live-composition + auth flags (read off the RAW env at the call sites — build-core/live-composition/
    // http-dispatcher). Declared here so an invalid VALUE for a known key (e.g. AUTH_DEV_LOGIN=yes) fails
    // fast at boot. NOTE: loadConfig parses process.env with a NON-strict object, so a misspelled env NAME
    // is silently ignored (the default applies) — only bad values of known keys are boot errors.
    DATA_SOURCE_COMPOSITION: featureFlag(['seed', 'adapters'], 'seed'),
    // What the COP SHOWS under the live posture (2026-09-14, owner: "only current live reportings").
    // `auto` (default) resolves to `live-only` whenever DATA_SOURCE_COMPOSITION=adapters: incidents are
    // only those DISCOVERED from live hazards, layers only what a LIVE/CACHED source served (a MOCK answer
    // is cited, never drawn), shelters from the agency registry. `hybrid` is the pre-2026-09-14 picture
    // (the seeded demo enriched by live slices), kept for the offline-demo profile and for tests.
    LIVE_PICTURE: featureFlag(['auto', 'hybrid', 'live-only'], 'auto'),
    // How many regions the live composition assembles at once (2026-09-14). Each region has its own
    // adapter registry and redundancy engine, and last-known-good keys carry the region id, so regions do
    // not share state; the only cost of concurrency is the burst of requests at the upstreams. Measured:
    // five regions one after another took ~300 s.
    LIVE_REGION_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    AUTH_SECRET: z.string().optional(),
    AUTH_DEV_LOGIN: featureFlag(['on', 'off'], 'off'),

    // V2·A7 (ADR-040) — the EM-only DB-admin link. The Directus console's address, served on the
    // authenticated `GET /me` payload ONLY when the resolved principal is EM (http-dispatcher.ts), and read
    // there off the RAW env exactly like the two auth values above it.
    //
    // THREE PROPERTIES, EACH DELIBERATE:
    //  • OPTIONAL — a deployment with no admin console must not be made to invent one. Absence IS the off
    //    switch, so there is no second flag to forget (and none to disagree with this one).
    //  • URL-VALIDATED — a typo'd admin address is worth a boot error rather than a dead link handed to the
    //    one role trusted to act on it. The running app always boots through createHttpDepsLive →
    //    loadConfig, so this check is on the real path, not a decorative declaration.
    //  • NO `NEXT_PUBLIC_` MIRROR, and it is NOT in BROWSER_MIRRORED_FLAGS. Every mirror above exists to keep
    //    a browser flag HONEST about a server flag; here the right answer is no mirror at all. `next build`
    //    inlines a NEXT_PUBLIC_ value into the JavaScript every anonymous visitor downloads, so a mirrored
    //    admin URL would be public the moment it was configured — the role check would then be a rendering
    //    decision about a string everybody already holds, which is not a gate. That is the entire defect A7
    //    exists to avoid (plan §0·6; ADR-040 §1).
    DB_ADMIN_URL: z.string().url().optional(),

    // Evac routing ladder (ADR-016): heuristic = air-gapped default; ors = real road routing (keyed, refine below).
    FEATURE_ROUTING: featureFlag(['heuristic', 'ors'], 'heuristic'),
    ORS_API_KEY: z.string().optional(),

    // Telegram channel (ADR-023): mock = recorded transport (offline default); live needs the bot token (refine below).
    CHANNEL_TELEGRAM_MODE: featureFlag(['mock', 'live'], 'mock'),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    TELEGRAM_ALERT_CHAT_IDS: z.string().optional(), // comma-separated chat ids for the approved-alert broadcast

    // WhatsApp channel (ADR-023): the transport is a DELIBERATE STUB (T-457 not wired — messaging-port.ts's
    // LiveStubTransport always returns a typed err, never an HTTP call). The enum only accepts 'mock' so a
    // misconfigured 'live' fails fast at boot instead of quietly shipping a channel that can never send
    // (honest fail-fast over a silent no-op); relax to ['mock','live'] once T-457 wires a real transport.
    CHANNEL_WHATSAPP_MODE: featureFlag(['mock'], 'mock'),
    WHATSAPP_TOKEN: z.string().optional(),
    WHATSAPP_WEBHOOK_SECRET: z.string().optional(),

    // CLI channel (ADR-023): the `beacon` reference CLI — on by default, fully offline, needs no token.
    CHANNEL_CLI_ENABLED: featureFlag(['on', 'off'], 'on'),

    // Regions
    REGIONS_CONFIG: z.string().default('./config/regions.json'),
    DEFAULT_REGION_ID: z.string().default('us-ca'),

    // CAP profile validation (D3.1; ADR-036 §1, spec-delta §2). The rule set every emitted CAP document must
    // satisfy IN ADDITION to schemas/cap-v1.2.schema.json, applied before the sink records anything.
    //   `base`  — CAP v1.2 and nothing more. The default: a deployment with no downstream alerting authority
    //             makes no profile claim.
    //   `ipaws` — the rules transcribed VERBATIM from OASIS CAP v1.2 IPAWS Profile v1.0 CS01 §2 into
    //             schemas/cap-profiles/ipaws.schema.json. Passing it is a SELF-CHECK, not a certification and
    //             not authorisation: IPAWS_ENABLED=off and CAP_EMIT_MODE=draft are unchanged (ADR-010).
    // Declared here (rather than read raw) precisely so an unknown profile name is a BOOT error — a typo must
    // never silently downgrade a deployment to a weaker rule set than the operator asked for (V2).
    CAP_PROFILE: featureFlag(CAP_PROFILE_IDS, DEFAULT_CAP_PROFILE),

    // Compliance proxy (FR-15)
    COMPLIANCE_PROXY_ENABLED: featureFlag(['on', 'off'], 'on'),
    COMPLIANCE_POLICIES_PATH: z.string().default('./config/policies.yml'),

    // Live Views (E11; ADR-027/028/029). These gate COMPOSITION, not the UI toggle (the `cameras` map layer
    // defaults OFF in the store regardless). Per-source LIVE/CACHED/MOCK is a factory-resolved SOURCE_*_MODE
    // raw-env read (NOT in this schema — same pattern as the other adapters), wired in CW1.
    //   FEATURE_CAMERAS default 'on' — offline-safe: camera sources default MOCK/CACHED, so composing the
    //     camera source family never touches the network in the air-gapped floor (Art. XVI).
    //   FEATURE_EXTERNAL_VIEWS default 'on' — locked decision Q4: pure coordinate deep-links, no key, no cost,
    //     no network, so every incident/point gets the one-click 3D/satellite/street context.
    //   FEATURE_CITIZEN_STREAM default 'off' — locked decision Q2: consent-gated citizen live-view ships last
    //     (v1.2/CW4); default-off keeps the new PII/SSRF surface disabled until explicitly enabled.
    FEATURE_CAMERAS: featureFlag(['off', 'on'], 'on'),
    FEATURE_EXTERNAL_VIEWS: featureFlag(['off', 'on'], 'on'),
    FEATURE_CITIZEN_STREAM: featureFlag(['off', 'on'], 'off'),

    // Exercise (DRILL) mode — MW-D/D4, ADR-034 §7. `on` selects a SEPARATE composition
    // (src/main/build-drill.ts) that never constructs a live channel; it is NOT a branch inside the live
    // send path, so this flag is not what keeps an exercise artifact off a real channel (a disjoint
    // `capStatus` literal, a partitioned composition and a dependency-cruiser rule are). Default off.
    DRILL_MODE: featureFlag(['off', 'on'], 'off'),
    // The browser mirror for the persistent EXERCISE banner (F-32 — a browser-visible flag needs a
    // NEXT_PUBLIC_ mirror, server authoritative). Declared HERE, unlike the two older NEXT_PUBLIC_ vars
    // which live only in .env.example, precisely so the refine below can enforce that the two agree: a
    // server in drill mode whose browser bundle says otherwise would render no EXERCISE banner, and an
    // unlabelled exercise on screen is the failure FOP-4 exists to prevent. UX-only otherwise — the server
    // value is authoritative and is the one `resolveDrillMode` reads.
    NEXT_PUBLIC_DRILL_MODE: featureFlag(['off', 'on'], 'off'),

    // Deploy-posture badge (WP-A1, 2026-08-05). `live` swaps the toolbar's red DEV tag + demo role
    // switcher for a green LIVE chip (app/page.tsx). Build-time inlined by `next build`; validated here
    // so a typo ('lvie', 'prod') fails the boot instead of silently rendering the DEV tag on a judged
    // deploy — the F-382 silent-off failure mode the older unchecked NEXT_PUBLIC_ mirrors still have.
    NEXT_PUBLIC_DEPLOY_POSTURE: featureFlag(['dev', 'live'], 'dev'),

    // Installable / offline-capable COP (ADR-047). Build-time inlined; `on` registers public/sw.js and
    // links the manifest, anything else retires both on the next visit. Validated here for the same
    // reason as the posture flag: a typo must be a boot error, not a silently-off worker.
    NEXT_PUBLIC_PWA: featureFlag(['off', 'on'], 'off'),

    // ── LIVE-DEMO DELIVERY INCREMENT, session 1 (docs/LIVE_DEMO_DELIVERY_PLAN.md §2·S1; ADR-037) ──
    //
    // The browser mirror for FEATURE_EXTERNAL_VIEWS above. Until now that server flag was INERT: nothing
    // client-side read it, so `off` changed nothing on screen and the section rendered unconditionally
    // (the note in sitrep-panel.tsx said so out loud). Declared `.optional()` — NOT with a default —
    // because it joins LIVE_VIEWS_BROWSER_MIRRORED_FLAGS below, where the parity refine forbids an
    // explicit contradiction and the transform INHERITS the server flag when this is unset. A standalone
    // `.default('on')` here would defeat both (an unset mirror would silently win over a server `off`),
    // which is exactly the F-190/F-192 defect the composed-list mechanism exists to prevent.
    NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS: z.enum(['off', 'on']).optional(),

    // Retention purge (UNIMPLEMENTED_REGISTER row 20). The purge EXECUTOR
    // (src/application/governance/retention-sweep.ts) is real and tested, but nothing in the running app
    // ever invoked it — so the Art. XIV "no PII beyond the incident lifecycle" guarantee held only if a
    // human ran it by hand. These two drive the scheduler seam (src/main/scheduler.ts) that finally does.
    // Default ON: a privacy guarantee that must be switched on is not a guarantee. The interval is
    // generous (1 h) because the sweep is idempotent and cheap; tests inject their own timer and never
    // start this loop.
    RETENTION_SWEEP_ENABLED: featureFlag(['off', 'on'], 'on'),
    RETENTION_SWEEP_INTERVAL_SEC: z.coerce.number().int().positive().default(3600),

    // Shelter-ranking objective (UNIMPLEMENTED_REGISTER row 31). CONFIGURATION.md §12 has documented this
    // knob since S03 with the default below, but no code read it — the objective was hardcoded in
    // `rankShelters`. Declared here so the documented value is the value the engine actually uses.
    //   maximize_availability_per_distance — spare capacity weighted against travel distance (default)
    //   minimize_distance                  — nearest OPEN shelter with any spare capacity wins
    CAPACITY_MATCH_DIRECTION: featureFlag(
      ['maximize_availability_per_distance', 'minimize_distance'],
      'maximize_availability_per_distance',
    ),

    // V2·A9 — the two pre-positioning constants become configuration. `suggestPrePositioning`
    // (src/application/pre-positioning/pre-positioning.ts:38-39) has always ACCEPTED both as inputs; what
    // was hardcoded is that nothing ever passed them, so the documented "20 km / top-5" were code constants
    // an operator could not touch. The HTTP composition root now reads these and threads them through
    // (createHttpDepsLive), keeping the application layer pure and injected exactly as
    // src/application/shared/config.ts's DEFAULT_* constants already are.
    //
    // TODAY'S VALUES ARE THE DEFAULTS, so an unset environment behaves byte-identically to pre-V2.
    //
    // UNITS: the radius is declared in KILOMETRES because that is the unit the operator reasons and the
    // docs speak in; the use-case takes METRES. The conversion happens ONCE, at the composition boundary
    // (`prePositioningTuning`, http-dispatcher.ts), never in the engine — a unit converted in two places is
    // a unit that will eventually disagree with itself.
    //
    // Both are `.positive()` and the cap is additionally `.int()`: a zero/negative radius surfaces nothing
    // and a fractional row-cap is not a thing a board can honour, so either is a boot error rather than a
    // silent fallback to the default (the operator asked for something the engine cannot do — say so).
    PREPOSITION_RADIUS_KM: z.coerce.number().positive().default(20),
    PREPOSITION_TOP_N: z.coerce.number().int().positive().default(5),

    // Demo auto-report watcher (plan §0 decision 18; ADR-037 §5). A presentation aid: while a region is
    // being monitored live, the FIRST critical wildfire/flood signal sends ONE Telegram message so a real
    // notification lands mid-demo without waiting for an operator to approve an alert.
    //
    // ART. XIII IS NOT WEAKENED BY THIS, and the design is what guarantees it rather than a promise: the
    // watcher emits a MONITORING NOTIFICATION through the notifier (PII-redact + firewall + hash-chained
    // audit), never a CAP/EDXL alert, never touches the alert store, and its message is prefixed
    // "AUTOMATED MONITORING (not an approved public alert)". Public alerting still requires a human.
    // Default OFF everywhere including the gates — an accidentally-on watcher would message real humans
    // from a test run, which is the exact failure the Playwright env block was hardened against.
    DEMO_AUTO_REPORT: featureFlag(['off', 'on'], 'off'),
    DEMO_AUTO_REPORT_REGION: z.string().min(1).default('us-ca'),
    DEMO_AUTO_REPORT_INTERVAL_SEC: z.coerce.number().int().positive().default(120),
    // `on` latches after the first send (one notification per boot — a presentation wants one moment, not
    // a stream). `off` keeps notifying on each newly-detected critical signal.
    DEMO_AUTO_REPORT_ONCE: featureFlag(['off', 'on'], 'on'),

    // ── V2·A12 — PERIODIC LIVE RE-INGEST (the boot-time-snapshot defect) ──
    //
    // `createHttpDepsLive` is memoised behind ONE promise per server process (http-dispatcher.ts
    // `cachedAsync`), so `assembleLiveSeeds` ran at the first request and NEVER AGAIN. Every adapter reading
    // the COP served was a boot-time snapshot — `fetched_at` re-stamped per BOOT rather than per fetch — and
    // a wildfire that started after boot could not appear until somebody restarted the process. This
    // interval is what re-runs the composition and atomically swaps the served picture
    // (`src/main/live-refresh.ts`, driven from the existing `src/main/scheduler.ts` loop).
    //
    // DEFAULT 0 = OFF, and that is the point: off is EXACTLY today's behaviour, so the offline, air-gapped,
    // memory and Playwright profiles are byte-identical until an operator deliberately turns this on.
    //
    // THE 60 s FLOOR IS NOT A STYLE CHOICE. A re-ingest is a FULL fan-out — every enabled adapter for every
    // region — and the adapter cache cannot throttle it: the cache is LAST-KNOWN-GOOD only (the LIVE rung
    // calls upstream FIRST and reads cache only as the fallback rung, `src/adapters/_shared/redundancy.ts`),
    // and `assembleLiveSeeds` builds a fresh `makeCachePort` per run, so a `cache.ttlSec` suppresses nothing
    // between runs. What the manifests DO say is how often each source changes: `intervalSec` is 300 s at the
    // fastest and 900 s for most of the 45 adapters (config/adapters.json). Polling a free public service
    // faster than it publishes buys no freshness and spends somebody else's bandwidth. 900 is therefore the
    // RECOMMENDED value for a LIVE posture; the floor is 60 rather than 300 only because a MOCK/CACHED
    // posture (`SOURCE_*_MODE`) touches no upstream at all and may legitimately want a tight demo loop.
    LIVE_REINGEST_INTERVAL_SEC: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(0)
      .refine((sec) => sec === 0 || sec >= MIN_LIVE_REINGEST_INTERVAL_SEC, {
        message:
          `LIVE_REINGEST_INTERVAL_SEC must be 0 (off) or at least ${MIN_LIVE_REINGEST_INTERVAL_SEC} seconds — ` +
          'a re-ingest is a full upstream fan-out across every adapter and region, and the adapter cache is ' +
          'last-known-good only, so a tighter loop hammers free public services without gaining freshness ' +
          '(900 is the recommended LIVE value; see config/adapters.json `intervalSec`)',
      }),

    // ── LIVE-DEMO DELIVERY INCREMENT, session 2 — the vision ladder (ADR-037 §4) ──
    //
    // These seven have been DOCUMENTED since S03 (CONFIGURATION.md §5) and read by ZERO code
    // (UNIMPLEMENTED_REGISTER row 27): `build-vision.ts` hardcoded the recorded-fixture MockVision, so a
    // deployment could set every one of them and change nothing. Declaring them here is what makes the
    // documented ladder real, and puts a typo'd VALUE on the boot-error path instead of the silent-default
    // path — the same reason CAP_PROFILE and DRILL_MODE are declared rather than read raw.
    //
    // The ladder itself (Art. XVI): cloud → local → MockVision, where the mock is a LABELLED degraded rung
    // and never a silent substitute. Art. XII still binds the top of that ladder — a vision model may
    // classify and describe, never emit a figure; the deterministic geometry is untouched by it.
    VISION_MODE: featureFlag(['off', 'cloud', 'local'], 'off'),
    VISION_PROVIDER: z.string().optional(),
    VISION_MODEL: z.string().optional(),
    VISION_API_BASE: z.string().optional(),
    VISION_LOCAL_MODEL: z.string().optional(),
    // A hard ceiling on what may be shipped to a model, enforced before any upload: an oversized image is
    // refused honestly rather than silently truncated (a truncated image would yield a confident finding
    // about pixels that were never sent).
    VISION_MAX_IMAGE_MB: z.coerce.number().positive().default(8),
    // Art. XIV. Satellite imagery carries no PII, but the consented SOS-photo path does, and this screen is
    // what stands between it and an upstream provider. Default ON, and the SOS path keeps it mandatory
    // regardless of this flag — the flag can only ever tighten, never loosen, that path.
    VISION_PII_SCREEN: featureFlag(['off', 'on'], 'on'),

    // Copernicus Data Space (Sentinel-2 L2A) — the OPTIONAL imagery rung. Absent credentials degrade to the
    // keyless NASA GIBS default rather than failing: the demo must not depend on an account the operator
    // may not have created.
    COPERNICUS_CLIENT_ID: z.string().optional(),
    COPERNICUS_CLIENT_SECRET: z.string().optional(),

    // D6 basic-aggregate tier (ADR-035 §4; FR-D6-1…FR-D6-5). Five INDEPENDENT flags, not one — master
    // plan §5.4 requires per-surface flags, and ADR-035 §4 explicitly rejects a single `FEATURE_D6`
    // ("Alternatives considered", :392).
    //
    // DEFAULT `on` — ENTRANT'S DECISION, 2026-07-31, resolving F-170. Two documents disagreed:
    // `docs/SPEC-FINAL-VERSION-DELTA.md:131` said `on`, the D6 build brief said `off`, and the lane
    // shipped `off` as the safe reading. The entrant resolved it to `on`: these five are the demonstrable
    // coordination surfaces of a CONTEST ENTRY, and a capability nobody can see scores nothing.
    //
    // Why `on` is defensible rather than merely convenient — the privacy argument for `off` was that each
    // module is a new surface carrying a new privacy boundary (Art. XIV aggregate-only). That argument is
    // answered STRUCTURALLY here, not waived: no D6 entity can carry a person-identifying field at all,
    // enforced at four independent layers (A `AggregateOnly<T>` at tsc, B a recursive walk of
    // schemas/d6-*.schema.json, C a runtime key walk over maximal factory output, D `guardAggregateOnly`
    // fail-closed at the export boundary). Every layer has been proven by planting a violation and
    // watching it fail. A flag default cannot leak what the type system cannot express.
    //
    // V13 (ADR-035) is UNAFFECTED and still binding: it requires that with every FEATURE_D6_* explicitly
    // set OFF, all gates stay green and no surface renders. That is a property of the off state, not a
    // statement about the default, and its test must keep passing.
    //
    // Declared HERE (not read raw at a call site) so a typo'd VALUE is a boot error rather than a silent
    // downgrade — the same reason CAP_PROFILE is declared. `src/application/aggregate/d6-flags.ts`
    // DERIVES its flag list from this schema's `Env` type rather than re-declaring it (the F-24/F-140/
    // F-141 root-cause class: a re-declared contract drifts, a derived one cannot).
    FEATURE_D6_VOLUNTEER_TEAMS: featureFlag(['off', 'on'], 'on'),
    FEATURE_D6_SUPPLIES: featureFlag(['off', 'on'], 'on'),
    // NOTE (F-177, open): the reunification link-out ships two curated URLs whose liveness is UNCONFIRMED
    // — `familylinks.icrc.org` and the American Red Cross RFL page both answer automated requests with
    // HTTP 403 bot protection, so they are unverified rather than disproven, and the Red Cross entry has
    // no positive evidence at all. The module handles zero data and always emits the GLOBAL rung, so an
    // unreachable link degrades-and-labels rather than dead-ending. The entrant verifies these by hand
    // before submission; until then this default being `on` is a KNOWN, ACCEPTED and DOCUMENTED risk,
    // not an oversight. Do not mark those URLs verified on the strength of a 403.
    FEATURE_D6_REUNIFICATION_LINKS: featureFlag(['off', 'on'], 'on'),
    FEATURE_D6_INCIDENT_EXPORT: featureFlag(['off', 'on'], 'on'),
    FEATURE_D6_CASUALTY_TALLY: featureFlag(['off', 'on'], 'on'),

    // D5 response-coordination tier (ADR-036 §7; FR-D4-1…FR-D4-5). Five INDEPENDENT flags for the same
    // reason as the D6 block above — ADR-036 §"Alternatives considered" (:354) rejects a single
    // `FEATURE_D4` explicitly, because D4-3 (shelter status) is the module most likely to be dropped if the
    // timeline compresses and per-module flags are what make that possible.
    //
    // DEFAULT `on` — ENTRANT'S DECISION, 2026-07-31, resolving F-193/F-155 (the same
    // spec-says-`on`/implementation-ships-`off` drift that F-170 resolved for the D6 tier, one line above
    // it in the very same spec table). The lane shipped `off` per its brief and raised it rather than
    // choosing silently, which was correct.
    //
    // Checked on their OWN merits, NOT inherited from D6 by analogy — the two tiers guard different things:
    //   • FR-D4-4 damage reports ride the consent→triage→verify pipeline, so they are the genuine privacy
    //     risk here. `triageStatus` is `Pick`ed from the report (cannot drift) and `DamageAssessmentEntry`
    //     carries `AggregateOnly<T>`; planting `contactName` fails at `tsc`. ONE BUCKET PER TRIAGE STATE
    //     AND NO GRAND TOTAL — a VERIFIED/UNVERIFIED-mixing figure is not expressible.
    //   • FR-D4-3 shelter status is guarded at the CSV EXPORT boundary too (`guardAggregateOnly` in
    //     `csv.ts`), the one place aggregate data actually leaves the system.
    //   • FR-D4-5 EMS overlay is Copernicus damage products — `AggregateOnly<DamageOverlayProduct>`, and
    //     per the F-48 lesson it models NO geometry at all.
    //   • FR-D4-1 rumor board projects news facts and FR-D4-2 mutual aid projects `ResourceTask` rows;
    //     neither carries person data, so neither needs the guard to justify this default.
    // Each of those guards was proven by planting a violation and observing the failure, not by inspection.
    //
    // V17/NFR-F5 is UNAFFECTED and still binding: with every FEATURE_D4_* explicitly OFF, all gates stay
    // green and no surface renders. That is a property of the off state, not of the default.
    // NOTE (F-152): nothing composes these modules yet — no `src/main` wiring, no panel, no route — so this
    // default is currently INERT and becomes live only when those seams land. Re-read this block then.
    //
    // `src/application/coordination/coordination-flags.ts` DERIVES `CoordinationFlags` from this schema's
    // `Env` type (`Pick<Env, D5FeatureFlag>`) rather than re-declaring the names — same reasoning as D6.
    FEATURE_D4_RUMOR_BOARD: featureFlag(['off', 'on'], 'on'),
    FEATURE_D4_MUTUAL_AID: featureFlag(['off', 'on'], 'on'),
    FEATURE_D4_SHELTER_STATUS: featureFlag(['off', 'on'], 'on'),
    FEATURE_D4_DAMAGE_REPORTS: featureFlag(['off', 'on'], 'on'),
    FEATURE_D4_EMS_OVERLAY: featureFlag(['off', 'on'], 'on'),

    // D2 anticipatory action (ADR-034; FR-AA-1…FR-AA-4). Gates the COP's Anticipatory Action PANEL — the
    // first surface over the existing, already-tested trigger-evaluation engine (`src/application/
    // anticipatory/**`), which is otherwise unreachable from the running app (the F-81/F-152 "a feature with
    // no on-camera moment" class). It gates a DISPLAY only: the engine is pure, holds no port, emits nothing
    // and tasks nothing (`ANTICIPATORY_CANNOT_EMIT` is a tsc-checked assertion), so this flag can never be
    // the difference between acting and not acting — only between showing the evaluation and not showing it.
    //
    // DEFAULT `off`, deliberately and NOT for the usual "new surface, new risk" reason: the COP's Playwright
    // visual baselines are a spent budget (F-194 — zero regenerations remain), and a panel rendered by
    // default would move them. Off ⇒ the default COP render is byte-identical, VERIFIED by running
    // Playwright rather than argued (F-47/F-94, the same "ship inert, cost nothing" precedent as the storm
    // layer and the Outlook section). Turning it on is one env var plus one baseline regeneration.
    FEATURE_ANTICIPATORY_PANEL: featureFlag(['off', 'on'], 'off'),

    // Browser mirrors for the ten D4/D6 flags above (ADR-035 §4; F-173 — this was DELIBERATELY not built by
    // the D6 lane: it owned no browser surface, and an unread mirror would repeat the F-32 defect class, a
    // config value that exists and nothing reads). Unlike the two OLDER NEXT_PUBLIC_ vars
    // (NEXT_PUBLIC_AUTH_DEV_LOGIN / NEXT_PUBLIC_FEATURE_CITIZEN_STREAM, which live only in .env.example and
    // are trusted by convention, never checked), these ARE declared in EnvSchema — the same choice
    // NEXT_PUBLIC_DRILL_MODE already made, and for the same reason: it lets the refine below enforce
    // agreement, so a mirror can never silently disagree with the server flag it is supposed to mirror.
    // Default `on`, matching the ten server flags' own F-170/F-193 default (resolved 2026-07-31).
    // Honesty (F-152): no browser surface reads any of these ten yet — nothing composes the D4/D6 modules
    // — so today they exist ahead of their consumer. The refine is what keeps that state from rotting: an
    // operator (or a future panel wired with the wrong value) cannot boot with a mirror that lies.
    NEXT_PUBLIC_FEATURE_D4_RUMOR_BOARD: z.enum(['off', 'on']).optional(),
    NEXT_PUBLIC_FEATURE_D4_MUTUAL_AID: z.enum(['off', 'on']).optional(),
    NEXT_PUBLIC_FEATURE_D4_SHELTER_STATUS: z.enum(['off', 'on']).optional(),
    NEXT_PUBLIC_FEATURE_D4_DAMAGE_REPORTS: z.enum(['off', 'on']).optional(),
    NEXT_PUBLIC_FEATURE_D4_EMS_OVERLAY: z.enum(['off', 'on']).optional(),
    NEXT_PUBLIC_FEATURE_D6_VOLUNTEER_TEAMS: z.enum(['off', 'on']).optional(),
    NEXT_PUBLIC_FEATURE_D6_SUPPLIES: z.enum(['off', 'on']).optional(),
    NEXT_PUBLIC_FEATURE_D6_REUNIFICATION_LINKS: z.enum(['off', 'on']).optional(),
    NEXT_PUBLIC_FEATURE_D6_INCIDENT_EXPORT: z.enum(['off', 'on']).optional(),
    NEXT_PUBLIC_FEATURE_D6_CASUALTY_TALLY: z.enum(['off', 'on']).optional(),
    // Browser mirror for the D2 anticipatory panel — the flag the COP actually reads, since the panel is a
    // client component. `.optional()` with NO default of its own, exactly as F-240 fixed the ten above: an
    // unset mirror INHERITS `FEATURE_ANTICIPATORY_PANEL` through the transform, and the refine rejects only
    // an EXPLICIT contradiction. Giving this one an independent default would re-open the trap F-240 closed
    // (turning ONE feature off would need TWO env vars, and getting it wrong would refuse to boot).
    NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL: z.enum(['off', 'on']).optional(),
    // Demo-display outlook panel (plan §0 decision 2). DELIBERATELY mirror-only: there is no server
    // FEATURE_OUTLOOK_PANEL twin because no server behaviour changes — the panel renders data the SitRep
    // envelope already carries — so it is NOT in BROWSER_MIRRORED_FLAGS (nothing to inherit from or
    // contradict). Declared here (found 2026-08-08, S3 sweep) because it was read by sitrep-panel.tsx but
    // never in EnvSchema: a typo'd value was a SILENT off. Reader semantics stay opt-in (`=== 'on'`).
    NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL: z.enum(['off', 'on']).optional(),
  })
  // Mode-needs-its-key invariants (fail-fast; E0·T-013).
  .refine((c) => !(c.FEATURE_CACHE === 'redis' && !c.REDIS_URL), {
    message: 'FEATURE_CACHE=redis requires REDIS_URL',
    path: ['REDIS_URL'],
  })
  .refine((c) => !(c.FEATURE_QUEUE === 'bullmq' && !c.REDIS_URL), {
    message: 'FEATURE_QUEUE=bullmq requires REDIS_URL',
    path: ['REDIS_URL'],
  })
  // The durable store must point at a REAL Postgres — the default DATABASE_URL is a placeholder, so
  // FEATURE_STORE=postgres without an explicitly-set DATABASE_URL is a misconfiguration, not a silent
  // fallback onto a non-existent local DB (fail-fast; keeps the memory default the only zero-config path).
  .refine((c) => !(c.FEATURE_STORE === 'postgres' && c.DATABASE_URL === DEFAULT_DATABASE_URL), {
    message:
      'FEATURE_STORE=postgres requires a real DATABASE_URL (set DATABASE_URL to your Postgres, not the local placeholder default)',
    path: ['DATABASE_URL'],
  })
  .refine((c) => !(c.FEATURE_ROUTING === 'ors' && !c.ORS_API_KEY), {
    message: 'FEATURE_ROUTING=ors requires ORS_API_KEY',
    path: ['ORS_API_KEY'],
  })
  .refine((c) => !(c.CHANNEL_TELEGRAM_MODE === 'live' && !c.TELEGRAM_BOT_TOKEN), {
    message: 'CHANNEL_TELEGRAM_MODE=live requires TELEGRAM_BOT_TOKEN',
    path: ['TELEGRAM_BOT_TOKEN'],
  })
  // A local vision rung with no endpoint is unreachable, and an unreachable rung is worse than an absent
  // one: it degrades to the mock while the configuration claims a local model is in use.
  //
  // There is deliberately NO matching `VISION_MODE=cloud ⇒ key` refine. The cloud provider reuses the LLM
  // ladder's credentials (`LLM_TIER_*`), and those live OUTSIDE this schema by design (build-ai.ts:39) —
  // so this object cannot see them, and a refine written here would either be a lie or force the LLM keys
  // into a schema that has always kept them out. The cloud rung fails fast at composition instead, with the
  // same honest degrade-and-label the LLM ladder itself uses when its key is missing.
  .refine((c) => !(c.VISION_MODE === 'local' && !c.VISION_API_BASE), {
    message: 'VISION_MODE=local requires VISION_API_BASE (the local vision endpoint)',
    path: ['VISION_API_BASE'],
  })
  // The drill banner may not disagree with the drill composition (FOP-4). The server flag is authoritative;
  // this makes the browser mirror a boot-blocking constraint rather than an inert declaration (F-32's defect
  // class), so an operator cannot run an exercise whose UI forgot to say so.
  .refine((c) => c.NEXT_PUBLIC_DRILL_MODE === c.DRILL_MODE, {
    message:
      'NEXT_PUBLIC_DRILL_MODE must equal DRILL_MODE (the browser EXERCISE banner mirrors the server mode; ' +
      'the server flag is authoritative)',
    path: ['NEXT_PUBLIC_DRILL_MODE'],
  })
  // Each of the ten D4/D6 browser mirrors may not disagree with its server flag (F-173, ADR-035 §4) — same
  // reasoning as the DRILL_MODE refine above: an unread-and-unchecked mirror is inert (F-32's defect
  // class), so this is what makes declaring them meaningful rather than dead. Looped over
  // D4_D6_BROWSER_MIRRORED_FLAGS (not re-typed here) so the check and the flag list cannot drift apart, and
  // every mismatch is reported (not just the first) so a multi-flag misconfiguration names every offender.
  .superRefine((c, ctx) => {
    for (const flag of BROWSER_MIRRORED_FLAGS) {
      const mirror = `NEXT_PUBLIC_${flag}` as const;
      // UNSET is not a disagreement — an unset mirror INHERITS the server flag in the transform below.
      // Only an EXPLICIT contradiction is an error. See the design note on the transform for why.
      if (c[mirror] !== undefined && c[mirror] !== c[flag]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${mirror} must equal ${flag} (the browser mirror agrees with the server flag; the server flag is authoritative)`,
          path: [mirror],
        });
      }
    }
  })
  /**
   * Fill every UNSET browser mirror from its server flag, so the mirrors are always present and always
   * agree, and `Env` can keep typing them as `'off' | 'on'` rather than optional.
   *
   * WHY THIS EXISTS (finding F-240, and it is a real operational trap, not a style preference). The mirrors
   * originally carried their own independent `.default('on')`, which made the parity refine fire whenever an
   * operator set only the server flag. Turning ONE feature off then required setting TWO environment
   * variables, and getting it wrong did not degrade — it **refused to boot**. The concrete scenario that
   * makes this unacceptable: the entrant disables `FEATURE_D6_REUNIFICATION_LINKS` because the F-177 URLs
   * did not verify in time, and the app dies at startup with a config error — during a filmed demo, on the
   * one flag most likely to be switched off under time pressure. Three existing tests caught exactly this
   * shape by building explicit-off fixtures and failing to boot (F-240); they were the symptom, not the bug.
   *
   * The guarantee is UNCHANGED and still structural: a mirror can never silently disagree with its flag.
   * What changed is that AGREEMENT IS NOW THE DEFAULT rather than the operator's manual responsibility —
   * inheritance handles the common case, and the refine above still fails the boot on an explicit
   * contradiction, which is the only case where the operator has actually said two different things.
   * Deriving the value beats requiring a human to restate it: the same reasoning as F-24/F-140/F-141/
   * F-190/F-192, applied to configuration instead of types.
   */
  .transform((c) => {
    const filled = { ...c };
    for (const flag of BROWSER_MIRRORED_FLAGS) {
      const mirror = `NEXT_PUBLIC_${flag}` as const;
      filled[mirror] = c[mirror] ?? c[flag];
    }
    return filled as typeof c & {
      readonly [K in `NEXT_PUBLIC_${(typeof BROWSER_MIRRORED_FLAGS)[number]}`]: 'off' | 'on';
    };
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parse + validate an environment record; throws a readable aggregated error on failure. */
export function loadConfig(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid BEACON configuration (fail-fast at boot):\n${issues}`);
  }
  return result.data;
}
