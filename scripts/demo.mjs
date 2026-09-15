#!/usr/bin/env node
// BEACON — the demo switch. The live deployment is NORMALLY OFF and brought online to be shown.
//
//   npm run demo:on     # redeploy the latest build; the URL starts serving
//   npm run demo:off    # remove the deployment; the URL stops serving
//   npm run demo:status # ask the URL whether it is serving, without changing anything
//
// WHY A SCRIPT AND NOT THE DASHBOARD. Two reasons, and neither is convenience. First, this is the one
// state in the project that is easy to get wrong in the expensive direction: leaving a deployment online
// after a demonstration is not a bug you notice, so `demo:on` prints what is now public and what has to
// happen afterwards. Second, a documented command can be handed to someone else; a sequence of clicks
// cannot.
//
// WHY NOT PUSH-TO-DEPLOY. Because then "is the demo online" would be a side effect of merging, and a
// merge would silently publish the site. The off state has to be something you choose.
//
// WHY NOT SCALE-TO-ZERO. A removed deployment is unambiguous: the URL 404s. A zero-scaled one can leave a
// stale replica answering with old data, which is the one failure mode a live demonstration cannot afford.
//
// THE DATABASE IS NOT TOUCHED. `railway down` acts on the service named below and nothing else, so the
// Postgres service — and the seeded data in it — survives an off/on cycle. Verify that once on a real
// project before relying on it; the note is in docs/ops/DEMO_SWITCH.md.
import { spawnSync } from 'node:child_process';

const SERVICE = process.env.RAILWAY_SERVICE ?? 'Quest-BEACON';
const URL_BASE = (process.env.BEACON_BASE_URL ?? 'https://quest-beacon.up.railway.app').replace(
  /\/$/,
  '',
);
const action = process.argv[2];

/** Run the Railway CLI, streaming its output. Returns the exit code; never throws. */
function railway(args) {
  const run = spawnSync('railway', args, { stdio: 'inherit', encoding: 'utf8' });
  if (run.error !== undefined && run.error !== null) {
    console.error(
      `\ncould not run the Railway CLI: ${run.error.message}\n` +
        `Install it (https://docs.railway.com/guides/cli) and run \`railway link\` in this directory first.\n` +
        `Check which service you are linked to with \`railway status\` — being linked to the DATABASE\n` +
        `service instead of the app is a mistake this project has made before, and every command then\n` +
        `silently acts on the wrong thing.`,
    );
    return 2;
  }
  return run.status ?? 1;
}

/** Is the deployment answering? Deliberately asks /api/v1/health, not the page: a page can be cached. */
async function serving() {
  try {
    const res = await fetch(`${URL_BASE}/api/v1/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function banner(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  console.log(`\n┌${'─'.repeat(width)}┐`);
  for (const line of lines) console.log(`│ ${line.padEnd(width - 1)}│`);
  console.log(`└${'─'.repeat(width)}┘\n`);
}

async function on() {
  const code = railway(['redeploy', '--service', SERVICE, '--yes']);
  if (code !== 0) return code;
  banner([
    'THE DEMO IS NOW PUBLIC.',
    `  ${URL_BASE}`,
    '',
    'Anyone with the link can reach it. Switch it off when you are done:',
    '  npm run demo:off',
    '',
    'A deployment takes a minute or two to start serving. Check it with:',
    '  npm run demo:status     (or: node scripts/check-live.mjs)',
  ]);
  return 0;
}

async function off() {
  const code = railway(['down', '--service', SERVICE, '--yes']);
  if (code !== 0) return code;
  // Asked, not assumed: `railway down` returning 0 means the command was accepted, not that the edge has
  // stopped answering. A demo that is reported off while it is still serving is the failure this guards.
  const stillUp = await serving();
  banner(
    stillUp
      ? [
          'THE DEPLOYMENT WAS REMOVED, BUT THE URL IS STILL ANSWERING.',
          `  ${URL_BASE}`,
          '',
          'The edge can serve for a few seconds after removal. Re-check with:',
          '  npm run demo:status',
        ]
      : ['The demo is OFF. The URL no longer serves.', `  ${URL_BASE}`],
  );
  return 0;
}

async function status() {
  const up = await serving();
  console.log(up ? `ONLINE   ${URL_BASE}` : `OFFLINE  ${URL_BASE}`);
  return up ? 0 : 1; // the exit code is the answer, so this composes into a cron or a shell check
}

const actions = { on, off, status };
const run = actions[action ?? ''];
if (run === undefined) {
  console.error('usage: node scripts/demo.mjs <on|off|status>');
  process.exit(2);
}
process.exit(await run());
