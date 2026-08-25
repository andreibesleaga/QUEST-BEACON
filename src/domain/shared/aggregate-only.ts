// BEACON — AggregateOnly<T> + the person-identifying-key denylist (ADR-035 §4; FR-D6-6/FU-18/FUW-8;
// CURRENT-MASTER-PLAN.md:128-129 "a structural test like the no-LLM-numbers contract"). This is Layer A
// (type-level) PLUS the shared primitives Layers B/C/D all reuse, so there is ONE denylist, not four —
// TASKS-FINAL-VERSION.md's D6.0 brief: "implement EXACTLY these, they are the gate".
//
// D6.0 builds the MECHANISM the five D6 aggregate modules (FR-D6-1…FR-D6-6, ADR-035 §4) will later be held
// to; it does not build those modules. No domain/adapter/UI code is wired to this file yet — it exists so a
// future D6 lane's factory/DTO can carry a compile-time assertion
// (`const _check: AggregateOnly<VolunteerTeamFields> = …`, ADR-035 §4) the day it lands.
//
// Pure TS — no framework/fs/adapter imports (same purity bar as F9's domain-purity fitness function,
// tests/architecture/f9-domain-purity.test.ts, which walks every non-test file under src/domain).
//
// Four independent layers close the "no person-identifying field on any D6 entity" gate:
//   (A) THIS FILE's `AggregateOnly<T>` — fails `tsc --noEmit` (Gate 2) the instant a D6 type declares a
//       key that identifies an individual person.
//   (B) a recursive walk of `schemas/d6-*.schema.json` (`additionalProperties:false`) against the SAME
//       denylist below, plus a case-insensitive substring net, with a written-justification allowlist for
//       deliberate collisions (tests/architecture/d6-no-pii.test.ts). Catches nesting/near-misses a flat
//       type union cannot see.
//   (C) a runtime `Object.keys()` walk over MAXIMAL factory-shaped output (every optional field supplied) —
//       catches a spread/mapper/DB-row key the DECLARED type never mentioned, which (A) cannot see.
//   (D) a fail-closed guard immediately before a D6 payload serializes
//       (`src/application/privacy/incident-summary-guard.ts`) — "the type makes it impossible" is only true
//       INSIDE the type system (the project's own F-79 lesson, reused deliberately here); the one
//       irreversible step (export) re-verifies rather than trusts.
// Layers B, C and D all call `isPersonIdentifyingKey` below, so there is one denylist, not four.

/**
 * Exact-match denylist. Verbatim from ADR-035 §4 — do not partially edit; removing a key silently reopens a
 * hole every other layer trusts this list to close. Extending it is safe and expected (a new key only ever
 * makes the guard stricter).
 *
 * FINDING F-347 EXTENDED IT, and the gap is worth recording. The ADR-035 §4 list was a NAMES-AND-IDENTIFIERS
 * list: it had no concept of WHERE a person is, WHAT DEVICE they used, or WHAT THEY LOOK LIKE — so
 * `geomPrecise`, `latitude`, `chatId` and `photo` all walked straight through every layer, while Art. XIV
 * names PRECISE LOCATION as the flagship class ("precise location only in the responder-authenticated view").
 * These are not invented key names: `geomPrecise` is the real column carrying an SOS reporter's exact
 * coordinate (`src/adapters/persistence/schema/intel-tables.ts:33`) and `chatId` is the real Telegram sender
 * handle (`src/adapters/channels/messaging/subscriber-registry.ts:12`) — one mapper spreading either row into
 * an export payload was the whole exploit. The three groups below are additive; nothing was removed.
 */
export const PERSON_IDENTIFYING_KEYS = [
  'name', 'firstName', 'lastName', 'fullName', 'givenName', 'familyName', 'initials',
  'email', 'phone', 'phoneNumber', 'mobile', 'contact', 'contactName', 'address', 'street', 'postcode',
  'dob', 'dateOfBirth', 'age', 'gender', 'nationalId', 'ssn', 'passport', 'driverLicence',
  'patientId', 'medicalRecord', 'diagnosis', 'triageTag', 'injuries', 'bloodType',
  'donor', 'donorId', 'payment', 'amount', 'cardNumber', 'iban', 'account',
  'photoUrl', 'faceId', 'biometric', 'deviceId', 'imei', 'ipAddress', 'userId', 'personId', 'reporterId',
  // F-347 (a) PRECISE LOCATION — Art. XIV's flagship class. A point IS an identifier: a house-level
  // coordinate plus a timestamp re-identifies a household without a single name. AGGREGATE geography is
  // deliberately NOT here (`regionId`, `affectedAreaKm2`, `geohashPrefix`, `elevationM` all still pass) —
  // this bans the PRECISE forms, which is what the Constitution bans.
  'geomPrecise', 'preciseGeom', 'preciseLocation', 'homeLocation', 'lastKnownLocation',
  'latitude', 'longitude', 'lat', 'lon', 'lng', 'coords', 'coordinates',
  // F-347 (b) DEVICE / CHANNEL HANDLE — a stable per-person routing address. `deviceId`/`imei` were already
  // here; the transports BEACON actually speaks (Telegram/WhatsApp/SMS) were not.
  'chatId', 'senderId', 'subscriberId', 'deviceToken', 'pushToken', 'macAddress', 'imsi', 'msisdn',
  'username', 'socialHandle', 'telegramId', 'whatsapp',
  // F-347 (c) IMAGE OF A PERSON — `photoUrl` was here but the plain forms were not, and the consented-SOS
  // photo path (VisionPort) produces exactly these.
  'photo', 'photos', 'image', 'images', 'imageUrl', 'selfie', 'avatar', 'faceImage',
] as const;

export type PersonIdentifyingKey = (typeof PERSON_IDENTIFYING_KEYS)[number];

/**
 * Layer A. Resolves to `T` unchanged only when `T` has NO person-identifying key; otherwise to an
 * error-carrying type whose single member NAMES the offending key(s) directly in the `tsc` error message.
 * Same trick the project already uses to make an invariant a compile error rather than a convention —
 * `EmittableAlert`'s `capStatus:'ACTUAL'` literal (`src/ports/logistics.ts:41-44`).
 */
export type AggregateOnly<T> =
  Extract<keyof T, PersonIdentifyingKey> extends never
    ? T
    : { readonly __PII_FIELD_FOUND__: Extract<keyof T, PersonIdentifyingKey> };

/**
 * Case-insensitive substring denylist (Layers B/C's near-miss net) — verbatim from ADR-035 §4. Catches e.g.
 * `reporterPhone`, `contactEmail`, `donorAmount` even though none is an exact `PERSON_IDENTIFYING_KEYS`
 * entry.
 *
 * F-347 added the second line. Every fragment there is chosen to be UNAMBIGUOUS at BEACON's own vocabulary:
 * `precise` is the Constitution's own word for the banned location form (`geomPrecise`, `precisePoint`);
 * `latitude|longitude|coordinate` catch the spelled-out geographic forms and their prefixed variants
 * (`centroidLatitude`). The short forms `lat`/`lon` are deliberately EXACT-ONLY above and NOT here — as
 * substrings they would deny `translationKey`, `relatedIncidents`, `latencyMs` and `along*`, and a denylist
 * that cries wolf is a denylist that gets allowlisted into uselessness. Same restraint for `image`: the exact
 * keys are listed above, but no `image` substring, because a satellite-imagery URL on a Copernicus damage
 * product is an aggregate fact about a PLACE, not a picture of a person.
 */
export const PERSON_IDENTIFYING_SUBSTRING =
  /name|mail|phone|contact|addr|ssn|dob|birth|patient|medical|diagnos|donor|pay|card|iban|account|passport|nationalid|person|reporter/i;

/** F-347's location/device/image net, kept as its own expression so each half stays readable and reviewable. */
export const PRIVATE_LOCATION_DEVICE_SUBSTRING =
  /precise|latitude|longitude|coordinate|geolocation|chatid|senderid|imsi|msisdn|selfie|avatar|photo|faceid|biometric/i;

const EMPTY_ALLOWLIST: ReadonlySet<string> = new Set();

/**
 * True when `key` is person-identifying by the exact OR substring denylist, UNLESS it is in `allowlist` — a
 * small, per-caller set of deliberately-ARGUED benign collisions (e.g. `orgId` collides with the `/person/`
 * substring but names an organisation, not a person). This function only ENFORCES an exemption a caller
 * already justified in writing at the call site (ADR-035 §4 Layer B); it never grants one silently.
 */
export function isPersonIdentifyingKey(key: string, allowlist: ReadonlySet<string> = EMPTY_ALLOWLIST): boolean {
  if (allowlist.has(key)) return false;
  if ((PERSON_IDENTIFYING_KEYS as readonly string[]).includes(key)) return true;
  return PERSON_IDENTIFYING_SUBSTRING.test(key) || PRIVATE_LOCATION_DEVICE_SUBSTRING.test(key);
}

export interface DenylistWalkOptions {
  /** Deliberately-argued benign collisions. Every entry's reason belongs at the CALL SITE, not here. */
  readonly allowlist?: ReadonlySet<string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinPath(path: string, segment: string): string {
  return path === '' ? segment : `${path}.${segment}`;
}

// ── Layer B primitive — recursive JSON-Schema property walk (pure; the CALLER does the file I/O) ──────────

/** Minimal shape of the JSON-Schema constructs BEACON's own schemas use (draft 2020-12, self-contained —
 *  see `schemas/cap-v1.2.schema.json`). `$ref` is NOT resolved — an honest, documented limitation; BEACON's
 *  D6 schemas are expected to be single-file documents, the same posture the CAP schema already takes. */
interface JsonSchemaLike {
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly patternProperties?: Readonly<Record<string, unknown>>;
  readonly items?: unknown;
  readonly allOf?: readonly unknown[];
  readonly anyOf?: readonly unknown[];
  readonly oneOf?: readonly unknown[];
  readonly $defs?: Readonly<Record<string, unknown>>;
  readonly definitions?: Readonly<Record<string, unknown>>;
}

function walkSchemaProperties(properties: unknown, opts: DenylistWalkOptions, path: string): string[] {
  if (!isPlainObject(properties)) return [];
  const allowlist = opts.allowlist ?? EMPTY_ALLOWLIST;
  const hits: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const here = joinPath(path, key);
    if (isPersonIdentifyingKey(key, allowlist)) hits.push(here);
    hits.push(...findPersonIdentifyingSchemaKeys(value, opts, here));
  }
  return hits;
}

function walkSchemaPatternProperties(patternProperties: unknown, opts: DenylistWalkOptions, path: string): string[] {
  if (!isPlainObject(patternProperties)) return [];
  const hits: string[] = [];
  // Pattern-property NAMES are regex fragments, not field names — only their value schemas are walked.
  for (const value of Object.values(patternProperties)) {
    hits.push(...findPersonIdentifyingSchemaKeys(value, opts, path));
  }
  return hits;
}

function walkSchemaItems(items: unknown, opts: DenylistWalkOptions, path: string): string[] {
  if (items === undefined) return [];
  const list = Array.isArray(items) ? items : [items];
  const hits: string[] = [];
  for (const item of list) hits.push(...findPersonIdentifyingSchemaKeys(item, opts, path));
  return hits;
}

function walkSchemaCombinators(schema: JsonSchemaLike, opts: DenylistWalkOptions, path: string): string[] {
  const hits: string[] = [];
  for (const branch of [schema.allOf, schema.anyOf, schema.oneOf]) {
    if (!Array.isArray(branch)) continue;
    for (const member of branch) hits.push(...findPersonIdentifyingSchemaKeys(member, opts, path));
  }
  return hits;
}

function walkSchemaNamedDefs(defs: unknown, opts: DenylistWalkOptions, path: string, label: string): string[] {
  if (!isPlainObject(defs)) return [];
  const hits: string[] = [];
  for (const [name, value] of Object.entries(defs)) {
    hits.push(...findPersonIdentifyingSchemaKeys(value, opts, joinPath(path, `${label}.${name}`)));
  }
  return hits;
}

/**
 * Layer B's core. Recursively walks an already-PARSED JSON-Schema document and returns every property PATH
 * (dot-joined, `$defs.<name>`/`definitions.<name>` prefixed for named subschemas) whose name is
 * person-identifying by the shared denylist. No I/O — the caller reads the file
 * (`tests/architecture/d6-no-pii.test.ts` does, mirroring how `f9-domain-purity.test.ts` reads `src/domain`
 * directly in the test rather than through an application-layer module).
 */
export function findPersonIdentifyingSchemaKeys(
  schema: unknown,
  opts: DenylistWalkOptions = {},
  path = '',
): string[] {
  if (!isPlainObject(schema)) return [];
  const s = schema as JsonSchemaLike;
  return [
    ...walkSchemaProperties(s.properties, opts, path),
    ...walkSchemaPatternProperties(s.patternProperties, opts, path),
    ...walkSchemaItems(s.items, opts, path),
    ...walkSchemaCombinators(s, opts, path),
    ...walkSchemaNamedDefs(s.$defs, opts, path, '$defs'),
    ...walkSchemaNamedDefs(s.definitions, opts, path, 'definitions'),
  ];
}

// ── Layer C/D primitive — recursive RUNTIME Object.keys() walk over a constructed value ────────────────────

function walkRuntimeArray(value: readonly unknown[], opts: DenylistWalkOptions, path: string): string[] {
  const hits: string[] = [];
  value.forEach((item, i) => {
    hits.push(...findPersonIdentifyingRuntimeKeys(item, opts, `${path}[${i}]`));
  });
  return hits;
}

function walkRuntimeObject(value: Record<string, unknown>, opts: DenylistWalkOptions, path: string): string[] {
  const allowlist = opts.allowlist ?? EMPTY_ALLOWLIST;
  const hits: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    const here = joinPath(path, key);
    if (isPersonIdentifyingKey(key, allowlist)) hits.push(here);
    hits.push(...findPersonIdentifyingRuntimeKeys(v, opts, here));
  }
  return hits;
}

/**
 * Layers C and D's shared core. Recursively walks an already-CONSTRUCTED value (a factory's output, an
 * export payload, …) via `Object.keys()`/array iteration and returns every PATH whose key is
 * person-identifying. This is what catches a key that exists at RUNTIME but not in the declared TYPE — a
 * spread, a mapper, a DB row shape drifting from its DTO — which Layer A structurally cannot see, because
 * Layer A only ever looks at the declared type, never the value.
 */
export function findPersonIdentifyingRuntimeKeys(
  value: unknown,
  opts: DenylistWalkOptions = {},
  path = '',
): string[] {
  if (Array.isArray(value)) return walkRuntimeArray(value, opts, path);
  if (!isPlainObject(value)) return [];
  return walkRuntimeObject(value, opts, path);
}
