// BEACON — EDXL-RM 1.0 anti-corruption mapper (E7·T-295/T-297/T-303; ADR-010). Maps the canonical
// RESOURCE_TASK entity to/from an OASIS EDXL-RM resource message (JSON) and back, LOSSLESSLY: the
// task-lifecycle status is carried in ResourceStatus.deploymentStatus, the round-trip correlation id in
// OriginatingMessageID (== task.edxlRmRef), the optional shelter in a typed Resource keyword, and the
// optional geo target in ScheduleInformation.Location.targetArea (GeoJSON per ADR-010). Every produced
// message is validated against schemas/edxl-rm.schema.json before it is returned. Canonical model is the
// source of truth; EDXL-RM is a boundary serialization.
import type { MakeResourceTaskInput, ResourceTask, ResourceTaskStatus } from '@/domain/resource-task.js';
import { makeResourceTask } from '@/domain/resource-task.js';
import type { Geometry } from '@/domain/value-objects/geo.js';
import type { IncidentId, ResourceId, ResourceTaskId, ShelterId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { Result } from '@/domain/shared/result.js';
import { ok } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { definedOnly } from '@/domain/shared/guard.js';
import { parseErr, validatedByFile } from './interop-result.js';

const RM_SCHEMA_PATH = 'schemas/edxl-rm.schema.json';
const SHELTER_URN = 'urn:beacon:shelter-id';

export type DeploymentStatus =
  | 'Requested' | 'Committed' | 'Mobilizing' | 'EnRoute' | 'OnScene'
  | 'Demobilizing' | 'Returned' | 'Cleared' | 'Unknown';

export type EdxlRmMessageType =
  | 'RequestResource' | 'ResponseToRequestResource' | 'RequisitionResource' | 'CommitResource'
  | 'RequestInformation' | 'ResponseToRequestInformation' | 'OfferUnsolicitedResource' | 'ReleaseResource'
  | 'RequestReturn' | 'ResponseToRequestReturn' | 'RequestQuote' | 'ResponseToRequestQuote'
  | 'RequestResourceDeploymentStatus' | 'ResponseToRequestResourceDeploymentStatus';

// Canonical task status → EDXL-RM deploymentStatus (the 5 canonical values; a bijection over this subset).
const TASK_TO_DEPLOYMENT: Readonly<Record<ResourceTaskStatus, DeploymentStatus>> = {
  PROPOSED: 'Requested',
  TASKED: 'Committed',
  ENROUTE: 'EnRoute',
  ONSCENE: 'OnScene',
  CLEARED: 'Cleared',
};

// EDXL-RM deploymentStatus → canonical task status (9→5; informational values EnRoute..Returned collapse
// onto the nearest lifecycle state; Unknown is intentionally absent → un-mappable). Inverts the 5
// canonical values exactly, so a canonical→EDXL→canonical round-trip is lossless.
const DEPLOYMENT_TO_TASK: Readonly<Partial<Record<DeploymentStatus, ResourceTaskStatus>>> = {
  Requested: 'PROPOSED',
  Committed: 'TASKED',
  Mobilizing: 'TASKED',
  EnRoute: 'ENROUTE',
  OnScene: 'ONSCENE',
  Demobilizing: 'CLEARED',
  Returned: 'CLEARED',
  Cleared: 'CLEARED',
};

// Canonical status → the EDXL-RM message role that best expresses it.
const TASK_TO_MESSAGE_TYPE: Readonly<Record<ResourceTaskStatus, EdxlRmMessageType>> = {
  PROPOSED: 'RequestResource',
  TASKED: 'CommitResource',
  ENROUTE: 'ResponseToRequestResourceDeploymentStatus',
  ONSCENE: 'ResponseToRequestResourceDeploymentStatus',
  CLEARED: 'ReleaseResource',
};

// Reply-type messages MUST cite the request they answer (schema allOf → precedingMessageID required).
const REPLY_TYPES: ReadonlySet<EdxlRmMessageType> = new Set<EdxlRmMessageType>([
  'ResponseToRequestResource', 'CommitResource', 'ResponseToRequestInformation',
  'ResponseToRequestReturn', 'ResponseToRequestQuote', 'ResponseToRequestResourceDeploymentStatus',
]);

export interface ValueListUrn {
  readonly valueListUrn?: string;
  readonly value: string;
}
export interface EdxlLocation {
  readonly locationDescription?: string;
  readonly targetArea?: Geometry;
}
export interface EdxlScheduleInformation {
  readonly scheduleType: string;
  readonly dateTime?: string;
  readonly location?: EdxlLocation;
}
export interface EdxlResourceStatus {
  readonly deploymentStatus?: DeploymentStatus;
  readonly statusDateTime?: string;
}
export interface EdxlResource {
  readonly resourceID?: string;
  readonly name: string;
  readonly keyword?: readonly ValueListUrn[];
  readonly resourceStatus?: EdxlResourceStatus;
}
export interface EdxlResourceInformation {
  readonly resourceInfoElementID: string;
  readonly resource: EdxlResource;
  readonly scheduleInformation?: readonly EdxlScheduleInformation[];
}
export interface EdxlContentObject {
  readonly resourceInformation: readonly EdxlResourceInformation[];
}
export interface EdxlIncidentInformation {
  readonly incidentID?: string;
  readonly incidentDescription?: string;
}
export interface EdxlRmMessage {
  readonly messageType: EdxlRmMessageType;
  readonly messageID: string;
  readonly sentDateTime: string;
  readonly messageContentType: string;
  readonly originatingMessageID: string;
  readonly precedingMessageID?: string;
  /**
   * RFC 3066/BCP-47 language tag for this message's human-readable text (messageDescription,
   * incidentInformation[].incidentDescription, contentObject[].contentDescription, resource names/
   * descriptions). Not a native EDXL-RM 1.0 element — see `schemas/edxl-rm.schema.json`
   * `#/properties/language` for the full grounding note (borrowed from OASIS EDXL-DE 2.0's
   * `<language>`/`<contentLanguage>`, the family's actual language-tagging mechanism). Absent ⇒
   * byte-identical to pre-i18n output.
   */
  readonly language?: string;
  readonly incidentInformation?: readonly EdxlIncidentInformation[];
  readonly contentObject: readonly EdxlContentObject[];
}

export interface EdxlRmOptions {
  readonly messageId?: string;
  readonly sentDateTime?: string;
  /** See `EdxlRmMessage.language`. Omitted ⇒ the message carries no `language` field, exactly as before. */
  readonly language?: string;
}

function scheduleFor(target: Geometry | undefined): readonly EdxlScheduleInformation[] | undefined {
  if (!target) return undefined;
  return [{ scheduleType: 'ReportTo', location: { targetArea: target } }];
}

function keywordFor(shelterId: ShelterId | undefined): readonly ValueListUrn[] | undefined {
  if (shelterId === undefined) return undefined;
  return [{ valueListUrn: SHELTER_URN, value: shelterId }];
}

function buildResourceInformation(task: ResourceTask, sentDateTime: string): EdxlResourceInformation {
  const resource: EdxlResource = definedOnly({
    resourceID: task.resourceId,
    name: `Resource ${task.resourceId}`,
    keyword: keywordFor(task.shelterId),
    resourceStatus: { deploymentStatus: TASK_TO_DEPLOYMENT[task.status], statusDateTime: sentDateTime },
  }) as EdxlResource;
  return definedOnly({
    resourceInfoElementID: task.id,
    resource,
    scheduleInformation: scheduleFor(task.target),
  }) as EdxlResourceInformation;
}

/** Pure transform: canonical ResourceTask → EDXL-RM message (no validation, no IO). */
export function buildEdxlRm(task: ResourceTask, opts: EdxlRmOptions, sentDateTime: string): EdxlRmMessage {
  const originatingMessageID = task.edxlRmRef ?? opts.messageId ?? task.id;
  const messageID = opts.messageId ?? originatingMessageID;
  const messageType = TASK_TO_MESSAGE_TYPE[task.status];
  return definedOnly({
    messageType,
    messageID,
    sentDateTime,
    messageContentType: messageType,
    originatingMessageID,
    precedingMessageID: REPLY_TYPES.has(messageType) ? originatingMessageID : undefined,
    language: opts.language,
    incidentInformation: [{ incidentID: task.incidentId }],
    contentObject: [{ resourceInformation: [buildResourceInformation(task, sentDateTime)] }],
  }) as EdxlRmMessage;
}

/**
 * True when two EDXL-RM messages built for the SAME canonical ResourceTask — one per resolved language —
 * carry identical machine-readable values (in the spirit of `capMachineValuesAgree` in cap-mapper.ts, and
 * `edxlSitRepMachineValuesAgree` in edxl-sitrep-mapper.ts). `language` and any translated description text
 * may differ; the message type/ids, correlation chain, resource identity/status and geometry never do.
 */
export function edxlRmMachineValuesAgree(a: EdxlRmMessage, b: EdxlRmMessage): boolean {
  const signature = (m: EdxlRmMessage): string =>
    JSON.stringify([
      m.messageType,
      m.messageID,
      m.sentDateTime,
      m.originatingMessageID,
      m.precedingMessageID ?? null,
      m.incidentInformation?.map((i) => i.incidentID ?? null) ?? [],
      m.contentObject.map((co) =>
        co.resourceInformation.map((ri) => [
          ri.resourceInfoElementID,
          ri.resource.resourceID ?? null,
          ri.resource.resourceStatus?.deploymentStatus ?? null,
          ri.resource.resourceStatus?.statusDateTime ?? null,
          ri.scheduleInformation?.map((s) => [s.scheduleType, s.dateTime ?? null, s.location?.targetArea ?? null]) ?? [],
        ]),
      ),
    ]);
  return signature(a) === signature(b);
}

/**
 * Serialize a canonical ResourceTask to a schema-valid EDXL-RM message. The round-trip correlation id
 * (task.edxlRmRef) is preserved as OriginatingMessageID so a request→commit→response chain stays linked
 * (ADR-010 round-trip fidelity).
 */
export function resourceTaskToEdxlRm(
  task: ResourceTask,
  opts: EdxlRmOptions = {},
): Result<EdxlRmMessage, DomainError> {
  const sentDateTime = opts.sentDateTime ?? new Date().toISOString();
  return validatedByFile('EDXL-RM message', RM_SCHEMA_PATH, buildEdxlRm(task, opts, sentDateTime));
}

function shelterFromKeywords(kw: readonly ValueListUrn[] | undefined): ShelterId | undefined {
  const hit = kw?.find((k) => k.valueListUrn === SHELTER_URN);
  return hit ? asId<ShelterId>(hit.value) : undefined;
}

function firstResourceInfo(msg: EdxlRmMessage): EdxlResourceInformation | undefined {
  return msg.contentObject[0]?.resourceInformation[0];
}

function firstIncidentId(msg: EdxlRmMessage): string | undefined {
  return msg.incidentInformation?.[0]?.incidentID;
}

function statusFrom(info: EdxlResourceInformation): ResourceTaskStatus | undefined {
  const deployment = info.resource.resourceStatus?.deploymentStatus;
  return deployment ? DEPLOYMENT_TO_TASK[deployment] : undefined;
}

function targetFrom(info: EdxlResourceInformation): Geometry | undefined {
  return info.scheduleInformation?.[0]?.location?.targetArea;
}

/**
 * INBOUND SCHEMA GATE (MW-D/D5.2 — closes finding F-31 / ADR-036 §7's G11).
 *
 * Until now the emit side validated (`resourceTaskToEdxlRm` → `validatedByFile`) and the INGEST side did
 * not: `src/adapters/channels/http/routes/feature-router.ts:287` casts a parsed JSON body straight to
 * `EdxlRmMessage` (`b as unknown as EdxlRmMessage`) and hands it to `handleEdxlRmPost` →
 * `edxlRmToResourceTask`. A `as unknown as` cast is not a check, so ANY document whose first
 * `resourceInformation` happened to carry the four fields the mapper reads was accepted — wrong
 * `messageType`, unknown top-level members (`additionalProperties:false` in the schema), a non-ISO
 * `sentDateTime`, a missing `originatingMessageID` (the round-trip correlation id) all sailed through.
 *
 * The fix is placed HERE, inside the mapper, rather than at the route: the route is one caller of many
 * (HTTP today, a queue/CLI tomorrow) and a validation step a caller can forget to perform is a filter, not a
 * guarantee. Every inbound path now goes through the schema because the MAPPER will not map without it —
 * fail closed, with the Ajv reasons in the typed `PARSE_ERROR`.
 *
 * Accepts `unknown` deliberately: an unvalidated document has no business being typed as an
 * `EdxlRmMessage` before the schema has said so.
 */
export function parseInboundEdxlRm(raw: unknown): Result<EdxlRmMessage, DomainError> {
  return validatedByFile('Inbound EDXL-RM message', RM_SCHEMA_PATH, raw as EdxlRmMessage);
}

/**
 * Parse an EDXL-RM message back into a canonical ResourceTask (anti-corruption inbound). The message is
 * FIRST validated against `schemas/edxl-rm.schema.json` (see `parseInboundEdxlRm` — F-31), then the task
 * lifecycle status is recovered from ResourceStatus.deploymentStatus and the correlation id from
 * OriginatingMessageID. Returns a typed PARSE_ERROR if the document fails the schema, lacks the elements
 * needed to rebuild a canonical task, or carries an un-mappable deployment status.
 */
export function edxlRmToResourceTask(msg: EdxlRmMessage): Result<ResourceTask, DomainError> {
  const validated = parseInboundEdxlRm(msg);
  if (!validated.ok) return validated;
  const info = firstResourceInfo(msg);
  if (!info) return parseErr('EDXL-RM message has no ResourceInformation to map');
  const incidentID = firstIncidentId(msg);
  if (!incidentID) return parseErr('EDXL-RM message has no IncidentInformation.incidentID');
  const resourceID = info.resource.resourceID;
  if (!resourceID) return parseErr('EDXL-RM ResourceInformation has no Resource.resourceID');
  const status = statusFrom(info);
  if (!status) return parseErr('EDXL-RM deploymentStatus does not map to a canonical task status');

  // definedOnly drops undefined optionals so the exactOptionalPropertyTypes input contract holds.
  const input = definedOnly({
    id: asId<ResourceTaskId>(info.resourceInfoElementID),
    resourceId: asId<ResourceId>(resourceID),
    incidentId: asId<IncidentId>(incidentID),
    status,
    shelterId: shelterFromKeywords(info.resource.keyword),
    target: targetFrom(info),
    edxlRmRef: msg.originatingMessageID,
  }) as MakeResourceTaskInput;
  return ok(makeResourceTask(input));
}
