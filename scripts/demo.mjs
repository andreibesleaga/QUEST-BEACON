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

/** The environment the switch acts on. Railway's own name for it; a project can hold several. */
const ENVIRONMENT = process.env.RAILWAY_ENVIRONMENT_NAME ?? 'production';

/** What the CLI says when a service has no deployment left to redeploy (CLI 5.75, 2026-11-21). */
const NO_DEPLOYMENT = /no deployment found/i;

/** Run the Railway CLI and keep what it printed, echoing it as well. Never throws. */
function railwayCaptured(args) {
  const run = spawnSync('railway', args, { encoding: 'utf8' });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  process.stdout.write(output);
  return { code: run.error ? 2 : (run.status ?? 1), output };
}

/**
 * Start the service when there is NO deployment to redeploy.
 *
 * `demo:off` removes the deployment, and from then on `railway redeploy` has nothing to act on: the CLI
 * answers "No deployment found for service" — the switch could be turned off and not on again. A fresh
 * deployment of the service's configured source is the same outcome, and the public API offers it as
 * one mutation. The ids come from `railway status --json`, so nothing about the project is written into
 * this file — and ONLY the instance in the environment named above is used: a project with a staging
 * environment has a service of the same name there, and starting that one would leave the public demo
 * offline while reporting success.
 */
function deployFresh() {
  const status = spawnSync('railway', ['status', '--json'], { encoding: 'utf8' });
  let ids;
  try {
    const environment = JSON.parse(status.stdout).environments.edges.find(
      (edge) => edge.node.name === ENVIRONMENT,
    );
    const instance = environment?.node.serviceInstances.edges.find(
      (edge) => edge.node.serviceName === SERVICE,
    );
    if (instance !== undefined) ids = { s: instance.node.serviceId, e: environment.node.id };
  } catch {
    ids = undefined;
  }
  if (ids === undefined) {
    console.error(
      `could not find the service "${SERVICE}" in the "${ENVIRONMENT}" environment (railway status --json).`,
    );
    return 1;
  }
  return railway([
    'api',
    'mutation start($s: String!, $e: String!) { serviceInstanceDeployV2(serviceId: $s, environmentId: $e) }',
    '--variables',
    JSON.stringify(ids),
  ]);
}

async function on() {
  const redeploy = railwayCaptured(['redeploy', '--service', SERVICE, '--yes']);
  let code = redeploy.code;
  // Only this one failure has a second way through. A login, link or network failure is reported as it
  // is: retrying it by another route would hide the real cause behind a second error.
  if (code !== 0 && NO_DEPLOYMENT.test(redeploy.output)) {
    console.error(
      '\nNothing to redeploy (the deployment was removed). Starting a fresh deployment.',
    );
    code = deployFresh();
  }
  if (code !== 0) return code;
  banner([
    'THE DEMO IS NOW PUBLIC.',
    `  ${URL_BASE}`,
    '',
    'Anyone with the link can reach it. Switch it off when you are done:',
    '  npm run demo:off',
    '',
    'A deployment takes about five minutes to build and start, and a few more until every answer',
    'is fast (the first data cycle). Until then the public address shows the offline page. Check with:',
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
