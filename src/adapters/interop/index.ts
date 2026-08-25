// BEACON — interop anti-corruption layer barrel (E7; ADR-010). CAP v1.2 / EDXL-RM / EDXL-SitRep / GeoJSON
// boundary serializations. Pure mappers: canonical model in, standard document out (and back), every
// output schema-validated (Ajv draft 2020-12). No HTTP, no DB, no raw formats leak above this layer.
export {
  alertToCap, buildCapAlert, capMachineValuesAgree, capTranslationsFor,
  capCategoryForHazardKind, capEventForHazardKind, capAreaIsTextOnly,
} from './cap-mapper.js';
export type {
  CapAlert, CapArea, CapInfo, CapOptions, CapStatusValue, CapMsgType, CapScope,
  CapUrgency, CapSeverity, CapCertainty, CapResponseType, CapLocalizedText, CapMessageRef, CapNamedValue,
} from './cap-mapper.js';

// Selectable CAP profile rule sets (D3.1; ADR-036 §1) — the blocking second validation pass.
export {
  CAP_PROFILE_IDS, DEFAULT_CAP_PROFILE, isCapProfileId, toCapProfileId, capProfilePath, validateCapProfile,
} from './cap-profile.js';
export type { CapProfileId } from './cap-profile.js';

// `parseInboundEdxlRm` is the inbound schema gate added by D5.2 (F-31 / ADR-036 §7 G11): validate an
// untrusted document against schemas/edxl-rm.schema.json BEFORE it is treated as an EdxlRmMessage.
export {
  resourceTaskToEdxlRm, edxlRmToResourceTask, buildEdxlRm, parseInboundEdxlRm,
} from './edxl-rm-mapper.js';
export type {
  EdxlRmMessage, EdxlRmMessageType, EdxlRmOptions, EdxlContentObject, EdxlResourceInformation,
  EdxlResource, EdxlResourceStatus, EdxlScheduleInformation, EdxlLocation, EdxlIncidentInformation,
  DeploymentStatus, ValueListUrn,
} from './edxl-rm-mapper.js';

export { sitRepToEdxlSitRep, buildEdxlSitRep } from './edxl-sitrep-mapper.js';
export type {
  EdxlSitRep, EdxlSitRepResult, EdxlSitRepSummary, EdxlIncidentInfo, EnvelopeCitation,
  SitRepType, SitRepOptions,
} from './edxl-sitrep-mapper.js';

export {
  geometryToFeature, featureToGeometry, geometriesToFeatureCollection,
  featureCollectionToGeometries, buildFeature,
} from './geojson-mapper.js';
export type { Feature, FeatureCollection } from './geojson-mapper.js';
