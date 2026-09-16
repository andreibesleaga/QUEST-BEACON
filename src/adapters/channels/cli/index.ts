// BEACON — CLI channel adapter public surface (E10·T-453). Re-exports the parser + runner so the
// composition root (and tests) import from one place. The `beacon` binary lives in bin.ts.
export { parseArgs } from './parse-args.js';
export type { ParsedInvocation } from './parse-args.js';
export { run } from './run.js';
export type { CliDeps, CliResult } from './run.js';
export { renderHuman, renderJson } from './render.js';
