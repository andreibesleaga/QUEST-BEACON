// BEACON — COP panels barrel (E8·E8 wave W4). Single import surface for the orchestrator composing the COP
// page: the data panels (SitRep / SOS / verifier / logistics / routing / draft-alert / decision-support) plus
// the cross-cutting interaction shell (act menu · command palette · responsive layout). Built over the FE-A
// UI kit (../ui) and the FE-B hooks/store/types (../../_lib).

// ── SitRep (T-371…T-374) ──
export { SitRepPanel, SitRepView } from './sitrep-panel.js';
export type { SitRepPanelProps, SitRepViewProps } from './sitrep-panel.js';

// ── Ranked Outlook (C2.3; ADR-033 §5) — SitRep-sourced, rendered inside the SitRep dock ──
export { OutlookPanel } from './outlook-panel.js';
export type { OutlookPanelProps } from './outlook-panel.js';

// ── Anticipatory action (D7; ADR-034) — display-gated OFF by NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL ──
export { AnticipatoryPanel, ANTICIPATORY_PANEL_ENABLED } from './anticipatory-panel.js';
export type { AnticipatoryPanelProps } from './anticipatory-panel.js';

// ── SOS intake (T-375…T-377) ──
export { SosForm } from './sos-form.js';
export type { SosFormProps } from './sos-form.js';

// ── Verifier queue (T-378…T-381) ──
export { VerifierQueue } from './verifier-queue.js';
export type { VerifierQueueProps } from './verifier-queue.js';

// ── Logistics (T-384…T-386) ──
export { LogisticsBoard, ShelterCapacityWidget } from './logistics-board.js';
export type { LogisticsBoardProps, ShelterCapacityWidgetProps } from './logistics-board.js';

// ── Routing (T-382/T-383) ──
export { RoutingPanel, NearestShelters } from './routing-panel.js';
export type { RoutingPanelProps, NearestSheltersProps } from './routing-panel.js';

// ── DRAFT alert review (T-387) ──
export { DraftAlertReview } from './draft-alert-review.js';
export type { DraftAlertReviewProps, DraftAlertItem } from './draft-alert-review.js';

// ── Decision support (T-388) ──
export { DecisionSupport } from './decision-support.js';
export type { DecisionSupportProps, DecisionFigure } from './decision-support.js';

// ── Interaction shell (T-389 / T-389a / T-350) — re-exported from app/_components for one import point ──
export { ActMenu } from '../act-menu.js';
export type { ActMenuProps } from '../act-menu.js';
export { CommandPalette } from '../command-palette.js';
export type { CommandPaletteProps, NamedRef } from '../command-palette.js';
export { CopLayout } from '../cop-layout.js';
export type { CopLayoutProps } from '../cop-layout.js';

// ── S3·U1/U2 dock panels — display-gated by their NEXT_PUBLIC_FEATURE_D4_*/D6_* mirrors ──
export { SuppliesPanel, SUPPLIES_PANEL_ENABLED } from './supplies-panel.js';
export type { SuppliesPanelProps } from './supplies-panel.js';
export { VolunteerTeamsPanel, VOLUNTEER_TEAMS_PANEL_ENABLED } from './volunteer-teams-panel.js';
export type { VolunteerTeamsPanelProps } from './volunteer-teams-panel.js';
export { ShelterStatusPanel, SHELTER_STATUS_PANEL_ENABLED } from './shelter-status-panel.js';
export type { ShelterStatusPanelProps } from './shelter-status-panel.js';
export { DamageReportsPanel, DAMAGE_REPORTS_PANEL_ENABLED } from './damage-reports-panel.js';
export type { DamageReportsPanelProps } from './damage-reports-panel.js';
export { EmsOverlayPanel, EMS_OVERLAY_PANEL_ENABLED } from './ems-overlay-panel.js';
export type { EmsOverlayPanelProps } from './ems-overlay-panel.js';
