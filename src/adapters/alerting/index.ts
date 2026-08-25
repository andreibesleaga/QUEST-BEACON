// BEACON — alerting adapter barrel (E1·T-089 P10; ADR-010, Art. XIII). The AlertSinkPort adapter that
// emits approved ACTUAL alerts as validated CAP v1.2 into a hash-chained audit log (MOCK sink; no live
// IPAWS origination). Composed at the root and wired into the interop HTTP routes.
export { makeAlertSink, asEmittable } from './alert-sink.js';
export type { AlertSink, AlertSinkDeps, EmissionRecord } from './alert-sink.js';
