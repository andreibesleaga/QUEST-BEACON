// BEACON test harness — branded-id helpers. Domain ids are compile-time-branded strings (src/domain/
// value-objects/ids.ts). Tests must mint them without sprinkling `asId` casts everywhere; these thin
// wrappers keep the brand while reading as intent (`incidentId('inc-ca-1')`).
import { asId } from '@/domain/value-objects/ids.js';
import type {
  AlertId,
  AppUserId,
  AuditEventId,
  CitationId,
  EvacRouteId,
  GaugeId,
  HazardGeometryId,
  IncidentId,
  InfrastructureNodeId,
  OrgId,
  PredictionId,
  PublicReportId,
  RegionId,
  ResourceId,
  ResourceTaskId,
  ShelterId,
  SitRepId,
  SourceId,
  ThresholdRuleId,
} from '@/domain/value-objects/ids.js';

export const regionId = (raw: string): RegionId => asId<RegionId>(raw);
export const incidentId = (raw: string): IncidentId => asId<IncidentId>(raw);
export const hazardGeometryId = (raw: string): HazardGeometryId => asId<HazardGeometryId>(raw);
export const gaugeId = (raw: string): GaugeId => asId<GaugeId>(raw);
export const infrastructureNodeId = (raw: string): InfrastructureNodeId => asId<InfrastructureNodeId>(raw);
export const predictionId = (raw: string): PredictionId => asId<PredictionId>(raw);
export const publicReportId = (raw: string): PublicReportId => asId<PublicReportId>(raw);
export const sitrepId = (raw: string): SitRepId => asId<SitRepId>(raw);
export const citationId = (raw: string): CitationId => asId<CitationId>(raw);
export const sourceId = (raw: string): SourceId => asId<SourceId>(raw);
export const alertId = (raw: string): AlertId => asId<AlertId>(raw);
export const thresholdRuleId = (raw: string): ThresholdRuleId => asId<ThresholdRuleId>(raw);
export const resourceId = (raw: string): ResourceId => asId<ResourceId>(raw);
export const resourceTaskId = (raw: string): ResourceTaskId => asId<ResourceTaskId>(raw);
export const shelterId = (raw: string): ShelterId => asId<ShelterId>(raw);
export const evacRouteId = (raw: string): EvacRouteId => asId<EvacRouteId>(raw);
export const appUserId = (raw: string): AppUserId => asId<AppUserId>(raw);
export const auditEventId = (raw: string): AuditEventId => asId<AuditEventId>(raw);
export const orgId = (raw: string): OrgId => asId<OrgId>(raw);
