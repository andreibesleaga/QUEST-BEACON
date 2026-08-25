// BEACON — branded entity id value objects (E1·T-041). Prevents mixing id types at compile time.
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type RegionId = Brand<string, 'RegionId'>;
export type IncidentId = Brand<string, 'IncidentId'>;
export type HazardGeometryId = Brand<string, 'HazardGeometryId'>;
export type GaugeId = Brand<string, 'GaugeId'>;
export type CameraFeedId = Brand<string, 'CameraFeedId'>;
export type InfrastructureNodeId = Brand<string, 'InfrastructureNodeId'>;
export type PredictionId = Brand<string, 'PredictionId'>;
export type PublicReportId = Brand<string, 'PublicReportId'>;
export type SitRepId = Brand<string, 'SitRepId'>;
export type CitationId = Brand<string, 'CitationId'>;
export type SourceId = Brand<string, 'SourceId'>;
export type AlertId = Brand<string, 'AlertId'>;
export type ThresholdRuleId = Brand<string, 'ThresholdRuleId'>;
export type ResourceId = Brand<string, 'ResourceId'>;
export type ResourceTaskId = Brand<string, 'ResourceTaskId'>;
export type ShelterId = Brand<string, 'ShelterId'>;
export type EvacRouteId = Brand<string, 'EvacRouteId'>;
export type AppUserId = Brand<string, 'AppUserId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type OrgId = Brand<string, 'OrgId'>;

/** Cast a raw string to a branded id (use only at the ACL/repository boundary). */
export const asId = <T extends string>(raw: string): T => raw as T;
