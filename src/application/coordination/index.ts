// BEACON — D5 coordination barrel (MW-D/D5; ADR-036 §7). The five response-coordination surfaces, each
// behind its own `FEATURE_D4_*` gate (all default OFF). Pure application layer: PORTS + DOMAIN + sibling
// use-cases only, no adapters/framework (`.dependency-cruiser.cjs:8-10`).
//
// Deliberately NOT re-exported from `src/application/index.ts`: that barrel is the composition root's import
// surface for the SHIPPED engine, and nothing here is wired into a running surface yet (finding F-152).
export {
  D5_FEATURE_FLAGS,
  DEFAULT_COORDINATION_FLAGS,
  gateCoordinationFeature,
  isCoordinationFeatureEnabled,
  type CoordinationFlags,
  type D5FeatureFlag,
  type FeatureGate,
} from './coordination-flags.js';

export {
  RUMOR_BOARD_CAVEAT,
  RUMOR_FLAG_REASONS,
  buildRumorBoard,
  isFlaggedFact,
  type FlaggedFact,
  type RumorBoard,
  type RumorBoardSummary,
  type RumorFlagReason,
  type RumorRow,
} from './rumor-board.js';

export {
  MUTUAL_AID_BOARD_CAVEAT,
  MUTUAL_AID_CONFLICT_REASONS,
  buildMutualAidBoard,
  type MutualAidBoard,
  type MutualAidConflict,
  type MutualAidConflictReason,
  type MutualAidLocalRow,
  type MutualAidRequestRow,
} from './mutual-aid-board.js';

export { CSV_RECORD_SEPARATOR, csvCell, toCsv, type CsvColumn } from './csv.js';

export {
  SHELTER_CSV_COLUMNS,
  buildShelterStatusBoard,
  shelterProvenanceClaim,
  shelterStatusCsv,
  type AggregateShelterRow,
  type ShelterStatusBoard,
  type ShelterStatusInput,
  type ShelterStatusProvenance,
  type ShelterStatusRow,
  type ShelterStatusTotals,
} from './shelter-status.js';

export {
  DAMAGE_ASSESSMENT_CAVEAT,
  UNVERIFIED_LABEL,
  assessDamage,
  type AssessDamageInput,
  type DamageAssessment,
  type DamageCounts,
} from './damage-assessment.js';

export {
  EMS_OVERLAY_CAVEAT,
  EMS_REJECTION_REASONS,
  buildEmsOverlay,
  type EmsOverlay,
  type EmsOverlayProductView,
  type EmsOverlayInput,
  type EmsRejectedProduct,
  type EmsRejectionReason,
} from './ems-overlay.js';
