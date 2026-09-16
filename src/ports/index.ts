// BEACON — src/ports public barrel (E1·T-091). Every hexagonal port interface (P1–P15+) lives here.
// Ports are pure interface signatures over the domain model: `import type` only, Result-returning,
// no adapter/framework imports (enforced by the application-no-adapters + domain-purity boundaries).

export * from './infra.js'; // RepositoryPort, EventBusPort, QueuePort, SpatialPort, CachePort, Sourced<T>
export * from './data-sources.js'; // HazardSourcePort, WeatherSourcePort, FloodGaugePort
export * from './infrastructure-sources.js'; // InfrastructurePort, OutagePort, TelecomPort, PopulationPort
export * from './cameras.js'; // CameraDirectoryPort (live-camera source family, E11)
export * from './air-quality.js'; // AirQualityPort (air/smoke corroboration, S2 Lane A4)
export * from './intel.js'; // NewsIntelPort, LLMPort (narrate-only), VisionPort, AICompliancePort
export * from './public-report.js'; // PublicReportPort (consent:true at the type level)
export * from './logistics.js'; // RoutingPort, ResourceLogisticsPort, ShelterDirectoryPort, AlertSinkPort
export * from './panels.js'; // PanelDataPort — the operator-maintained dock-panel datasets (ADR-041)
export * from './interaction.js'; // InteractionPort, Envelope (DRY), Command, Messaging/NotificationPort
