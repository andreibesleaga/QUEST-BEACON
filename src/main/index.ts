// BEACON src/main barrel (E-main). Composition root: config-validated, offline-first wiring that hands
// every channel (HTTP/CLI/messaging) the single InteractionPort. Layer boundary enforced by eslint +
// depcruise (F9): main may import application + adapters + ports + domain; nothing imports main except app/.
export * from './build-core.js';
export * from './seed.js';
