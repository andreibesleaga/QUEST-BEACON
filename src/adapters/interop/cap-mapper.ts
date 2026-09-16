// BEACON — CAP v1.2 anti-corruption mapper (E7·T-291; ADR-010, Art. XIII). Maps the canonical ALERT
// entity to an OASIS CAP v1.2 alert document (JSON) and validates it against schemas/cap-v1.2.schema.json
// before returning ok (validate-before-emit). The canonical model is the source of truth; CAP is a
// boundary serialization. Only a generalized, PII-free view is emitted — the ALERT entity carries no
// reporter PII, and the mapper never adds addresses/contact from any source. DRAFT → status=Draft;
// ACTUAL → status=Actual, and (defensively) ACTUAL without an approver is rejected (Art. XIII).
import type { Alert, AlertCategory, AlertMsgType, AlertSeverity } from '@/domain/alert.js';
import { alertMsgType } from '@/domain/alert.js';
import type { HazardKind } from '@/domain/hazard-geometry.js';
import type { Geometry, Position } from '@/domain/value-objects/geo.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { definedOnly } from '@/domain/shared/guard.js';
import { conflictErr, parseErr, validatedByFile } from './interop-result.js';
import { DEFAULT_CAP_PROFILE, validateCapProfile } from './cap-profile.js';
import type { CapProfileId } from './cap-profile.js';

const CAP_SCHEMA_PATH = 'schemas/cap-v1.2.schema.json';
const DEFAULT_SENDER = 'beacon@beacon.local';

export type CapStatusValue = 'Actual' | 'Draft';
export type CapMsgType = 'Alert' | 'Update' | 'Cancel' | 'Ack' | 'Error';
export type CapScope = 'Public' | 'Restricted' | 'Private';
export type CapUrgency = 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
export type CapSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
export type CapCertainty = 'Observed' | 'Likely' | 'Possible' | 'Unlikely' | 'Unknown';
export type CapResponseType =
  | 'Shelter'
  | 'Evacuate'
  | 'Prepare'
  | 'Execute'
  | 'Avoid'
  | 'Monitor'
  | 'Assess'
  | 'AllClear'
  | 'None';

/** CAP valueName/value pair — the shape shared by `<eventCode>`, `<parameter>` and `<geocode>`. */
export interface CapNamedValue {
  readonly valueName: string;
  readonly value: string;
}

export interface CapArea {
  readonly areaDesc: string;
  readonly polygon?: readonly string[];
  readonly circle?: readonly string[];
  readonly geocode?: readonly CapNamedValue[];
}

export interface CapInfo {
  readonly language?: string;
  readonly category: readonly string[];
  readonly event: string;
  readonly responseType?: readonly CapResponseType[];
  readonly urgency: CapUrgency;
  readonly severity: CapSeverity;
  readonly certainty: CapCertainty;
  readonly eventCode?: readonly CapNamedValue[];
  readonly expires?: string;
  readonly senderName?: string;
  readonly headline?: string;
  readonly description?: string;
  readonly instruction?: string;
  readonly web?: string;
  readonly parameter?: readonly CapNamedValue[];
  readonly area?: readonly CapArea[];
}

export interface CapAlert {
  readonly identifier: string;
  readonly sender: string;
  readonly sent: string;
  readonly status: CapStatusValue;
  readonly msgType: CapMsgType;
  readonly scope: CapScope;
  /**
   * CAP `<references>` — a SPACE-DELIMITED list of `sender,identifier,sent` triplets
   * (schemas/cap-v1.2.schema.json). Required by the schema when `msgType ∈ {Update, Cancel}`; absent
   * otherwise, so a plain alert's document is byte-identical to the pre-ADR-036 one.
   */
  readonly references?: string;
  readonly code?: readonly string[];
  readonly info: readonly CapInfo[];
}

/**
 * One earlier message an Update/Cancel refers to. CAP identifies a prior message by the TRIPLET
 * `sender,identifier,sent` — the identifier alone is not unique across senders — so the caller must supply
 * the original's `sent` instant; the domain `Alert.references` carries only identifiers, which is why this
 * resolution happens at the boundary where the original document (or its stored `sentAt`) is available.
 */
export interface CapMessageRef {
  readonly identifier: string;
  readonly sent: string;
  /** Defaults to the emitting `sender` — BEACON references its own prior messages. */
  readonly sender?: string;
}

export interface CapOptions {
  readonly sender?: string;
  readonly sent?: string;
  readonly msgType?: CapMsgType;
  readonly scope?: CapScope;
  readonly event?: string;
  readonly urgency?: CapUrgency;
  readonly certainty?: CapCertainty;
  readonly responseType?: readonly CapResponseType[];
  readonly areaDesc?: string;
  readonly senderName?: string;
  readonly headline?: string;
  readonly description?: string;
  readonly instruction?: string;
  readonly web?: string;
  readonly language?: string;
  /**
   * The earlier message(s) this Update/Cancel refers to, as CAP `sender,identifier,sent` triplets. The
   * domain says WHICH alerts (`Alert.references`); this says WHEN they were sent, which only the boundary
   * knows. An UPDATE/CANCEL reaching `alertToCap` with none is rejected with an actionable PARSE_ERROR
   * rather than an Ajv "must have required property 'references'" (ADR-036 §2, finding F-29).
   */
  readonly references?: readonly CapMessageRef[];
  /**
   * CAP `<code>` — special handling codes. The IPAWS profile requires one of these to carry `IPAWSv1.0`
   * (see schemas/cap-profiles/ipaws.schema.json), which is why it is a config-supplied option rather than
   * a literal: BEACON does not assert a profile it was not configured for.
   */
  readonly code?: readonly string[];
  /** CAP `<expires>` — REQUIRED by the IPAWS profile; absent by default (base CAP does not require it). */
  readonly expires?: string;
  /** CAP `<eventCode>` — e.g. the IPAWS-profile-required single `SAME` three-letter code. */
  readonly eventCode?: readonly CapNamedValue[];
  /** CAP `<parameter>` — system-specific pairs (e.g. the profile's `EAS-ORG`). */
  readonly parameter?: readonly CapNamedValue[];
  /** CAP `<geocode>` — area codes (e.g. a 6-digit `SAME` location) written into every `<area>` block. */
  readonly geocode?: readonly CapNamedValue[];
  /**
   * The CAP profile rule set the produced document must ALSO satisfy before it may be emitted
   * (`CAP_PROFILE`; default `base` = the base CAP v1.2 schema only). Composition supplies it once, per
   * deployment — see `AlertSinkDeps.capProfile` (ADR-036 §1, ADR-012 config-not-code).
   */
  readonly profile?: CapProfileId;
  /**
   * Per-language `<info>` blocks (FR-I18N-6; ADR-030/ADR-036). CAP v1.2 §3.2 carries multiple `<info>`
   * elements distinguished by `<language>` — that is the standard's own answer to multilingual alerting,
   * so BEACON uses it rather than inventing a wrapper.
   *
   * ONLY human-readable text varies per block. `category`, `urgency`, `severity`, `certainty`,
   * `responseType`, `web` and the `<area>` geometry are machine-readable values and are written
   * IDENTICALLY into every block — a recipient must never get a different severity depending on which
   * language they read (enforced by `capMachineValuesAgree`).
   *
   * Empty/absent ⇒ a single block, exactly as before (the existing single-language behaviour is
   * byte-identical, which is why every pre-existing CAP test still passes unchanged).
   */
  readonly translations?: readonly CapLocalizedText[];
}

/**
 * The human-readable half of a CAP `<info>`, for one language. A translation that omits a field inherits
 * the base option — so a partially-translated alert degrades to English for that field rather than
 * emitting a blank one (the same fallback doctrine as the UI catalogs).
 */
export interface CapLocalizedText {
  /** RFC 3066 / BCP-47 language tag written to `<language>`. */
  readonly language: string;
  readonly event?: string;
  readonly headline?: string;
  readonly description?: string;
  readonly instruction?: string;
  readonly senderName?: string;
  readonly areaDesc?: string;
}

const SEVERITY_MAP: Readonly<Record<AlertSeverity, CapSeverity>> = {
  MINOR: 'Minor',
  MODERATE: 'Moderate',
  SEVERE: 'Severe',
  EXTREME: 'Extreme',
};

// Domain AlertCategory values are already valid CAP <category> codes (Fire|Met|Safety).
const capCategory = (c: AlertCategory): string => c;

/** One GeoJSON polygon ring ([lon,lat] positions) → CAP polygon string ('lat,lon' pairs, closed ring). */
function ringToCap(ring: readonly Position[]): string {
  return ring.map(([lon, lat]) => `${lat},${lon}`).join(' ');
}

/** Map a canonical Geometry to a CAP <area> (Polygon/MultiPolygon → polygon[]; Point → circle radius 0). */
function geometryToCapArea(geometry: Geometry, areaDesc: string): CapArea {
  switch (geometry.type) {
    case 'Polygon':
      return { areaDesc, polygon: [ringToCap(geometry.coordinates[0] ?? [])] };
    case 'MultiPolygon':
      return { areaDesc, polygon: geometry.coordinates.map((poly) => ringToCap(poly[0] ?? [])) };
    case 'Point': {
      const [lon, lat] = geometry.coordinates;
      return { areaDesc, circle: [`${lat},${lon} 0`] };
    }
    default:
      return { areaDesc }; // LineString has no CAP area primitive — describe by text only.
  }
}

/** Domain msgType token → the CAP wire spelling. Exhaustive: a new AlertMsgType fails `tsc` here. */
const CAP_MSG_TYPE: Readonly<Record<AlertMsgType, CapMsgType>> = {
  ALERT: 'Alert',
  UPDATE: 'Update',
  CANCEL: 'Cancel',
};

/**
 * Serialize `<references>`: one `sender,identifier,sent` triplet per referenced message, space-delimited
 * (CAP v1.2 §3.2.1). `sender` falls back to the emitting sender because BEACON only ever references its own
 * prior messages. Returns undefined for an empty list so the element is simply absent.
 */
function capReferences(refs: readonly CapMessageRef[], sender: string): string | undefined {
  if (refs.length === 0) return undefined;
  return refs.map((r) => `${r.sender ?? sender},${r.identifier},${r.sent}`).join(' ');
}

/**
 * True when a canonical geometry can only be conveyed to CAP as `<areaDesc>` TEXT, with no `<polygon>`/
 * `<circle>` element.
 *
 * This is a genuine OASIS CAP v1.2 limitation, not a BEACON gap (ADR-032 §6): the standard's `<area>` block
 * defines `polygon`, `circle` and `geocode` primitives and has NO line primitive — so a cyclone `TRACK`
 * (a LineString) has nothing standards-compliant to serialize into. BEACON does not invent a non-standard
 * extension to paper over it; instead the caller MUST put the track's descriptive location (station,
 * landfall area) into `areaDesc`, since geometry alone cannot carry it. Exported so that obligation is
 * checkable by a caller and assertable in a test, rather than living only in a comment.
 *
 * `CONE` and `STORM_SURGE` are polygon kinds and map through the existing branches unchanged.
 */
export function capAreaIsTextOnly(geometry: Geometry): boolean {
  const area = geometryToCapArea(geometry, '');
  return area.polygon === undefined && area.circle === undefined;
}

/**
 * CAP `<category>` per hazard kind. Storm and surge are `Met` — CAP's own vocabulary already covers
 * meteorological hazards including tropical cyclones and flooding — so the domain `ALERT_CATEGORIES` enum
 * needed no new value (ADR-032 §2). Exhaustive: a new `HazardKind` fails `tsc` here until it is categorized.
 */
const CAP_CATEGORY_BY_HAZARD_KIND: Readonly<Record<HazardKind, AlertCategory>> = {
  HOTSPOT: 'Fire',
  PERIMETER: 'Fire',
  SPREAD_CONE: 'Fire',
  FLOOD_REACH: 'Met',
  TRACK: 'Met',
  CONE: 'Met',
  STORM_SURGE: 'Met',
};

/**
 * Default CAP `<event>` text per hazard kind. English source-of-record only: a multilingual alert overrides
 * it per `<info>` block via `CapOptions.translations[].event` (the machine-readable `<category>` above never
 * varies by language — FUW-2). Deliberately plain hazard names, never a severity or an instruction.
 */
const CAP_EVENT_BY_HAZARD_KIND: Readonly<Record<HazardKind, string>> = {
  HOTSPOT: 'Wildfire',
  PERIMETER: 'Wildfire',
  SPREAD_CONE: 'Wildfire spread projection',
  FLOOD_REACH: 'Flood',
  TRACK: 'Tropical cyclone',
  CONE: 'Tropical cyclone forecast cone',
  STORM_SURGE: 'Storm surge',
};

/** The CAP `<category>` code an alert about this hazard kind must carry. */
export function capCategoryForHazardKind(kind: HazardKind): AlertCategory {
  return CAP_CATEGORY_BY_HAZARD_KIND[kind];
}

/** The default CAP `<event>` text for an alert about this hazard kind (English source of record). */
export function capEventForHazardKind(kind: HazardKind): string {
  return CAP_EVENT_BY_HAZARD_KIND[kind];
}

/** The text fields whose per-language value simply falls back to the base option. */
const TEXT_FIELDS = ['event', 'senderName', 'headline', 'description', 'instruction'] as const;

interface ResolvedText {
  readonly language?: string | undefined;
  readonly event?: string | undefined;
  readonly senderName?: string | undefined;
  readonly headline?: string | undefined;
  readonly description?: string | undefined;
  readonly instruction?: string | undefined;
  /** Always present — CAP requires an `areaDesc` on every `<area>`, so it has a documented default. */
  readonly areaDesc: string;
}

/**
 * Resolve the human-readable half of one `<info>`: the translation's value where it has one, else the base
 * (English) option. Expressed as a LOOP over the field list rather than a wall of `??` so the fallback rule
 * is stated once — which also keeps this function well inside the cyclomatic-complexity gate.
 */
function resolveText(opts: CapOptions, text?: CapLocalizedText): ResolvedText {
  const merged: Record<string, string | undefined> = {};
  for (const field of TEXT_FIELDS) merged[field] = text?.[field] ?? opts[field];
  return {
    ...merged,
    language: text?.language ?? opts.language,
    areaDesc: text?.areaDesc ?? opts.areaDesc ?? 'Affected area',
  };
}

/**
 * One `<area>` block for the alert, or none when the alert has no footprint. `geocode` (an IPAWS-profile
 * SHOULD) is attached here so it is written identically into every language's block — it is a machine value.
 */
function buildAreas(
  alert: Alert,
  opts: CapOptions,
  areaDesc: string,
): readonly CapArea[] | undefined {
  if (!alert.area) return undefined;
  const area = geometryToCapArea(alert.area, areaDesc);
  return [definedOnly({ ...area, geocode: nonEmpty(opts.geocode) }) as CapArea];
}

/** The list itself, or `undefined` when empty — an absent CAP element is absent, never an empty array. */
function nonEmpty<T>(items: readonly T[] | undefined): readonly T[] | undefined {
  return (items ?? []).length > 0 ? items : undefined;
}

function buildInfo(alert: Alert, opts: CapOptions, text?: CapLocalizedText): CapInfo {
  const t = resolveText(opts, text);
  return definedOnly({
    // Human-readable fields, per language (an empty `language` is dropped by definedOnly ⇒ absent, as before).
    language: t.language,
    event: t.event ?? `${alert.category} hazard alert`,
    senderName: t.senderName,
    headline: t.headline,
    description: t.description,
    instruction: t.instruction,
    // Machine-readable fields: identical in every block, by construction. Never localized (FUW-2).
    // The DOMAIN value wins where the alert carries one (ADR-036 §2 moved these off the mapper's
    // hardcoded 'Expected'/'Likely'); `opts` remains the config-level default for an alert that has none.
    category: [capCategory(alert.category)],
    responseType: alert.responseType ?? opts.responseType,
    urgency: alert.urgency ?? opts.urgency ?? 'Expected',
    severity: SEVERITY_MAP[alert.severity],
    certainty: alert.certainty ?? opts.certainty ?? 'Likely',
    eventCode: nonEmpty(opts.eventCode),
    expires: opts.expires,
    web: opts.web,
    parameter: nonEmpty(opts.parameter),
    area: buildAreas(alert, opts, t.areaDesc),
  }) as CapInfo;
}

/**
 * Order the languages an alert must carry and drop any for which no text exists: the region's
 * language(s) first, then English ALWAYS (FR-I18N-6) — a responder or agency reading only English must
 * never be shut out of an alert issued in Romania, and vice versa.
 *
 * `texts` is the available translated copy, keyed by language tag. A language with no entry is skipped
 * rather than emitted with English text under a foreign `<language>` tag, which would be a lie about
 * what the block contains.
 */
export function capTranslationsFor(
  languages: readonly string[],
  texts: Readonly<Record<string, Omit<CapLocalizedText, 'language'>>>,
): readonly CapLocalizedText[] {
  const ordered: string[] = [];
  for (const language of languages) if (!ordered.includes(language)) ordered.push(language);
  if (!ordered.includes('en')) ordered.push('en');
  return ordered.filter((l) => texts[l] !== undefined).map((l) => ({ language: l, ...texts[l] }));
}

/**
 * The alert's OWN warning text is the source of record and overrides the config-level `CapOptions` default
 * (ADR-036 §2 — before this, `headline`/`description`/`instruction` existed only as boundary options and
 * were fabricated separately by the UI and the Telegram digest). Per-language overrides still apply on top,
 * through `opts.translations` — this only settles what the ENGLISH base block says.
 */
function withDomainText(alert: Alert, opts: CapOptions): CapOptions {
  return definedOnly({
    ...opts,
    headline: alert.headline ?? opts.headline,
    description: alert.description ?? opts.description,
    instruction: alert.instruction ?? opts.instruction,
  }) as CapOptions;
}

/** Pure transform: canonical Alert → CAP v1.2 alert document (no validation, no IO). */
export function buildCapAlert(alert: Alert, rawOpts: CapOptions, sent: string): CapAlert {
  const opts = withDomainText(alert, rawOpts);
  const translations = opts.translations ?? [];
  const sender = opts.sender ?? DEFAULT_SENDER;
  return definedOnly({
    identifier: alert.id,
    sender,
    sent,
    status: alert.capStatus === 'ACTUAL' ? 'Actual' : 'Draft',
    // The DOMAIN decides the message's nature (finding F-29: it used to be pinned to `Alert` because only
    // the boundary option existed). `opts.msgType` remains the fallback for an alert with no `msgType`.
    msgType: alert.msgType ? CAP_MSG_TYPE[alertMsgType(alert)] : (opts.msgType ?? 'Alert'),
    scope: opts.scope ?? 'Public',
    references: capReferences(opts.references ?? [], sender),
    code: nonEmpty(opts.code),
    // One <info> per language when translations are supplied; otherwise exactly one, unchanged.
    info:
      translations.length > 0
        ? translations.map((t) => buildInfo(alert, opts, t))
        : [buildInfo(alert, opts)],
  }) as CapAlert;
}

/**
 * True when every `<info>` block carries the same machine-readable values. This is the invariant that
 * makes multilingual CAP safe: translation may change what a human reads, never what a machine acts on.
 * Exported so it can be asserted in tests and by the pre-emit validator (ADR-036).
 */
export function capMachineValuesAgree(cap: CapAlert): boolean {
  const [first, ...rest] = cap.info;
  if (first === undefined) return false;
  // `eventCode` and `parameter` joined the signature with ADR-036: the IPAWS profile requires every <info>
  // block of one alert to carry the SAME <category> and <eventCode> ("All <info> blocks in a single alert
  // MUST relate to a single incident or update, with the same <category> and <eventCode> values" — OASIS
  // CAP v1.2 IPAWS Profile v1.0 CS01 §2), and that rule cannot be expressed in JSON Schema, so it is
  // enforced here. `geocode` is included for the same reason a polygon is: it is a machine-readable
  // targeting value, and a per-language difference would target different people per language.
  const signature = (i: CapInfo): string =>
    JSON.stringify([
      i.category,
      i.responseType ?? null,
      i.urgency,
      i.severity,
      i.certainty,
      i.web ?? null,
      i.eventCode ?? null,
      i.parameter ?? null,
      i.expires ?? null,
      (i.area ?? []).map((a) => [a.polygon ?? null, a.circle ?? null, a.geocode ?? null]),
    ]);
  const expected = signature(first);
  return rest.every((i) => signature(i) === expected);
}

/**
 * The gates that can be decided BEFORE the document is built: approver, `sent` instant, and a resolvable
 * reference for an Update/Cancel. Returns the failing Result, or null when all three pass. Split out so
 * `alertToCap` reads as its six-step chain rather than a branch pile (and stays under the complexity gate).
 */
function preEmitGuard(alert: Alert, opts: CapOptions): Result<CapAlert, DomainError> | null {
  if (alert.capStatus === 'ACTUAL' && !alert.approvedBy) {
    return conflictErr('CAP Actual alert requires an approver (Art. XIII)');
  }
  if (!(alert.sentAt ?? opts.sent)) {
    return parseErr('CAP alert requires a `sent` timestamp (alert.sentAt or opts.sent)');
  }
  const msgType = alertMsgType(alert);
  if (msgType !== 'ALERT' && (opts.references ?? []).length === 0) {
    return parseErr(
      `CAP ${CAP_MSG_TYPE[msgType]} requires references to the message(s) it supersedes: supply CapOptions.references as sender,identifier,sent triplet(s) for alert.references [${(alert.references ?? []).join(', ')}]`,
    );
  }
  return null;
}

/**
 * Map a canonical Alert to a schema-valid, profile-valid CAP v1.2 document. The BLOCKING pre-emit gate
 * (ADR-036 §1) in full, in order:
 *
 *   1. ACTUAL-without-approver ⇒ CONFLICT (Art. XIII, defense in depth over `EmittableAlert`).
 *   2. no `sent` instant ⇒ PARSE_ERROR.
 *   3. UPDATE/CANCEL without a resolved reference triplet ⇒ PARSE_ERROR naming the missing input.
 *   4. base CAP v1.2 schema (schemas/cap-v1.2.schema.json) — pre-existing.
 *   5. machine values must AGREE across every `<info>` block — the multilingual safety invariant.
 *   6. the selected PROFILE rule set (`CAP_PROFILE`, default `base`) — new in ADR-036.
 *
 * Nothing is recorded, audited or sent unless all six pass: `makeAlertSink` returns this Result unchanged
 * before its audit append (src/adapters/alerting/alert-sink.ts).
 */
export function alertToCap(alert: Alert, opts: CapOptions = {}): Result<CapAlert, DomainError> {
  const guard = preEmitGuard(alert, opts);
  if (guard) return guard;
  const sent = (alert.sentAt ?? opts.sent)!; // guaranteed non-empty by preEmitGuard above
  const base = validatedByFile('CAP v1.2 alert', CAP_SCHEMA_PATH, buildCapAlert(alert, opts, sent));
  if (!base.ok) return base;
  if (!capMachineValuesAgree(base.value)) {
    return parseErr(
      'CAP <info> blocks disagree on a machine-readable value (category/responseType/urgency/severity/certainty/web/area): translation may change what a human reads, never what a machine acts on (FUW-2)',
    );
  }
  return validateCapProfile(base.value, opts.profile ?? DEFAULT_CAP_PROFILE);
}
