#!/usr/bin/env node
// BEACON — `beacon` CLI entrypoint (E10·T-454). Thin wrapper: delegate to run(), write stdout, set exit
// code. All logic lives in run()/parse-args/render so the binary stays trivial and fully testable.
// Wired as `package.json#bin` → "beacon": "dist/adapters/channels/cli/bin.js" (see README.md).
import { run } from './run.js';

async function main(): Promise<void> {
  const result = await run(process.argv.slice(2), {});
  process.stdout.write(`${result.stdout}\n`);
  process.exit(result.exitCode);
}

void main();
