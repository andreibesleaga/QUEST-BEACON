// BEACON src/adapters barrel (S05). Layer boundary enforced by eslint + depcruise (F9): adapters
// implement ports + may use domain/application interfaces; they are never imported by domain/application.
// Channel adapters (CLI/HTTP/messaging) are DRIVING adapters over the same core (ADR-023); the memory
// core is the offline-first default wiring (Art. XVI). The `beacon` binary (cli/bin.ts) is intentionally
// NOT re-exported here — importing this barrel must have no runtime side effects.
export * from './memory/memory-core.js';
export * from './channels/cli/index.js';
export * from './channels/http/index.js';
export * from './channels/messaging/index.js';
