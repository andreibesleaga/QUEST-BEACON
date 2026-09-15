#!/usr/bin/env node
// BEACON — live production check. Run it against a deployment while it is serving.
//
//   node scripts/check-live.mjs                                  # defaults to the Railway URL below
//   node scripts/check-live.mjs --base https://host --secret X   # operator detail on a failed composition
//   node scripts/check-live.mjs --region ro --json               # machine-readable, for a cron or a wrapper
//
// WHY IT EXISTS. Three outages in two days were each invisible from the outside for the same reason: the
// only thing an operator could see was "the site is up" or an opaque 500. This asks the questions that
// actually distinguish a working deployment from a broken one, in the order that isolates the fault —
// process, then composition, then data, then whether that data is LIVE or a recorded fixture.
//
// Exit code is the contract: 0 every check passed, 1 something is wrong, 2 the script itself could not run.
// It reads nothing from the repo, so it can be pointed at any deployment from anywhere.

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const BASE = flag(
  'base',
  process.env.BEACON_BASE_URL ?? 'https://quest-beacon.up.railway.app',
).replace(/\/$/, '');
const REGION = flag('region', 'us-ca');
const SECRET = flag('secret', process.env.AUTH_SECRET ?? '');
const JSON_OUT = args.includes('--json');
// Generous: a cold container legitimately spends tens of seconds composing five regions of adapters.
const TIMEOUT_MS = Number(flag('timeout', '120')) * 1000;

// A probe script is a LINEAR CHECKLIST, and that is the point: each check reads top to bottom in the order
// that isolates a fault, and every branch is a distinct diagnostic message. Splitting it into helpers to
// satisfy a source-code complexity budget would scatter the one property that makes it useful — that you
// can read the whole thing and know exactly what it asked, and in what order — across a call graph. The
// rule is right for the application and wrong for this file, so it is disabled here and only here.
// eslint-disable-next-line complexity
async function main() {
  const results = [];
  const record = (name, ok, detail, extra = {}) => {
    results.push({ name, ok, detail, ...extra });
    if (!JSON_OUT) {
      const mark = ok === true ? 'PASS' : ok === null ? 'WARN' : 'FAIL';
      console.log(`${mark.padEnd(4)}  ${name.padEnd(34)}  ${detail}`);
    }
  };

  async function get(path, headers = {}) {
    const started = Date.now();
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 400);
      }
      return { ok: true, status: res.status, body, ms: Date.now() - started };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        body: undefined,
        ms: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // 1. LIVENESS. This route is deliberately independent of the composition, so it answers even when the app
  //    cannot serve anything else. If THIS fails, the container is not running or the edge cannot reach it.
  const health = await get(
    '/api/v1/health',
    SECRET === '' ? {} : { authorization: `Bearer ${SECRET}` },
  );
  if (!health.ok || health.status !== 200) {
    record(
      'liveness',
      false,
      `GET /api/v1/health → ${health.status || health.error} after ${health.ms}ms`,
    );
  } else {
    record('liveness', true, `200 in ${health.ms}ms`);
    // 2. READINESS. Separate from liveness on purpose: a process that is up but whose composition failed is
    //    the exact state a bad variable produces, and it needs a different fix from a crash.
    const h = health.body ?? {};
    if (h.ready === true) {
      record(
        'composition',
        true,
        `ready${h.elapsedMs === undefined ? '' : ` (built in ${Math.round(h.elapsedMs / 1000)}s)`}`,
      );
    } else if (h.composition === 'failed') {
      record(
        'composition',
        false,
        `FAILED — ${h.error ?? 'reason withheld; pass --secret to see it'}`,
      );
    } else {
      record(
        'composition',
        null,
        `${h.composition ?? 'unknown'} — not ready yet; re-run in a minute`,
      );
    }
    // 2b. THE LIVE-DATA POSTURE, checked BEFORE the per-source modes below, because it overrules them.
    //     DATA_SOURCE_COMPOSITION gates the whole adapter path and defaults to `seed`; under `seed` no
    //     adapter is consulted whatever its own SOURCE_*_MODE says, and every source then reports MOCK.
    //     Checking the 38 modes first makes that look like 38 broken upstreams. It is one variable.
    if (h.liveAdapters === false) {
      record(
        'live posture',
        false,
        `DATA_SOURCE_COMPOSITION=${h.dataSourceComposition ?? 'seed'} — the live adapter path is OFF, so ` +
          `every SOURCE_*_MODE below is inert and every source will report MOCK. Set it to 'adapters'.`,
      );
    } else if (h.liveAdapters === true) {
      const sec = h.liveReingestSec ?? 0;
      // Live sources with no reingest interval are assembled once at boot and never again: the picture is
      // live exactly once and then ages silently for the life of the process.
      record(
        'live posture',
        sec > 0 ? true : null,
        sec > 0
          ? `adapters, refreshing every ${sec}s`
          : `adapters, but LIVE_REINGEST_INTERVAL_SEC is 0 — assembled once at boot, never refreshed`,
      );
    }
  }

  // 3. THE PAGE. A 200 here with a broken API means the shell renders and every panel inside it is empty,
  //    which is what an operator actually sees.
  const page = await get('/');
  record(
    'page',
    page.ok && page.status === 200,
    page.ok ? `${page.status} in ${page.ms}ms` : `${page.error}`,
  );

  // 4. THE API PROPER. Goes through the composition, so it is the first check that exercises config, the
  //    adapters and (when FEATURE_STORE=postgres) the database.
  const status = await get(`/api/v1/status?regionId=${encodeURIComponent(REGION)}`);
  record(
    'api status',
    status.ok && status.status === 200,
    status.ok ? `${status.status} in ${status.ms}ms` : `${status.error}`,
  );

  // 5. LIVE vs RECORDED. The question this project turns on: how much of what an operator is looking at is
  //    real. A deployment can be perfectly healthy and still be showing fixtures, which is a different kind
  //    of broken and the one that is easiest to miss.
  const sources = await get(`/api/v1/sources?regionId=${encodeURIComponent(REGION)}`);
  if (sources.ok && sources.status === 200) {
    const list = sources.body?.data?.sources ?? [];
    const byMode = {};
    for (const s of list) byMode[s.mode] = (byMode[s.mode] ?? 0) + 1;
    const liveCount = byMode.LIVE ?? 0;
    // EVERY MODE THAT IS NOT `LIVE` IS NOT LIVE. The served-mode vocabulary is LIVE | CACHED | MOCK | DB,
    // and the first version of this check only counted MOCK — so a deployment serving nothing but cached
    // rows reported "all 0 sources live" and passed without a word (review, PR #12). Cached is a legitimate
    // rung and DB is operator-maintained truth; neither is a live reading, and this line is the one place
    // an operator asks how much of the picture is live.
    const notLive = list.filter((s) => s.mode !== 'LIVE');
    const summary = Object.entries(byMode)
      .map(([m, n]) => `${m}=${n}`)
      .join(' ');
    record('sources reachable', true, `${list.length} sources: ${summary}`, { byMode });
    // Not a pass/fail on a threshold nobody agreed: it reports the ratio, names what is not live and says
    // which mode each one served. A hard gate here would either be arbitrary or start getting ignored.
    const byNonLiveMode = {};
    for (const s of notLive) (byNonLiveMode[s.mode] ??= []).push(s.sourceId);
    record(
      'live data',
      notLive.length === 0 ? true : null,
      notLive.length === 0
        ? `all ${liveCount} sources live`
        : `${liveCount} of ${list.length} live; not live — ` +
            Object.entries(byNonLiveMode)
              .map(([m, ids]) => `${m}(${ids.length}): ${ids.join(', ')}`)
              .join(' | '),
    );
  } else {
    record('sources reachable', false, sources.ok ? `HTTP ${sources.status}` : `${sources.error}`);
  }

  // 6. FRESHNESS. `LIVE_REINGEST_INTERVAL_SEC=0` means the picture is composed once at boot and never again;
  //    the app looks healthy for days while the data silently ages. Age is the only way to see that.
  const map = await get(`/api/v1/regions/${encodeURIComponent(REGION)}/map`);
  if (map.ok && map.status === 200) {
    const freshness = map.body?.freshness;
    const ageMin =
      freshness === undefined ? null : Math.round((Date.now() - Date.parse(freshness)) / 60_000);
    record(
      'data freshness',
      ageMin === null ? null : ageMin <= 60,
      ageMin === null ? 'no freshness on the envelope' : `${ageMin} min old (${freshness})`,
    );
  } else {
    record('data freshness', false, map.ok ? `HTTP ${map.status}` : `${map.error}`);
  }

  // 7. AUTHENTICATION. The operator sign-in path, checked WITHOUT a password: a wrong credential must come
  //    back 401 quickly. A timeout or a 500 here is the cold-start/composition fault, not a bad password —
  //    the distinction that cost an evening on 2026-09-11.
  const login = await (async () => {
    const started = Date.now();
    try {
      const res = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'check-live-probe', password: 'not-a-real-password' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { ok: true, status: res.status, ms: Date.now() - started };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        ms: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  })();
  record(
    'login path',
    login.ok && login.status === 401,
    login.ok
      ? `${login.status} in ${login.ms}ms (401 is the expected answer to a wrong password)`
      : `${login.error}`,
  );

  // 8. THE SEED HAS RUN. `/regions` answers with the CONFIG ids (`us-ca`, `ro`, …) only once the seed has
  //    backfilled `region.domain_id`; surrogate uuids here mean the pre-deploy seed step is missing — and with
  //    it the operational tables (resources, reports, rules) and the incident lookup by id (2026-09-14).
  const regionsRes = await get('/api/v1/regions');
  if (regionsRes.ok && regionsRes.status === 200) {
    const ids = (regionsRes.body?.data?.regions ?? []).map((r) => String(r.id));
    const configIds = ids.filter((id) => !/^[0-9a-f-]{36}$/i.test(id));
    record(
      'seed has run (regions keyed by config id)',
      ids.length > 0 && configIds.length === ids.length,
      ids.length === 0
        ? 'no regions served'
        : configIds.length === ids.length
          ? `${ids.join(', ')}`
          : `${ids.length - configIds.length} of ${ids.length} regions are surrogate uuids — set the Railway pre-deploy command to \`node scripts/migrate.mjs && node scripts/seed.mjs\` and redeploy`,
    );
  } else {
    record(
      'seed has run (regions keyed by config id)',
      false,
      regionsRes.ok ? `HTTP ${regionsRes.status}` : `${regionsRes.error}`,
    );
  }

  // 9. THE PICTURE IS LIVE. Under LIVE_PICTURE=auto (the default on the adapters posture) no hand-seeded demo
  //    incident is served; every incident is one discovered from live hazards. A `*-demo` id here means the
  //    deployment is on the hybrid picture (or an old build). Pass --allow-demo to make this a warning.
  const incidentIds = (status.body?.data?.incidents ?? []).map((i) => String(i.id));
  const demoIds = incidentIds.filter((id) => id.endsWith('-demo'));
  const discoveredIds = incidentIds.filter((id) => id.startsWith('discovered:'));
  record(
    'incidents are live',
    // Hybrid picture (LIVE_PICTURE=hybrid): the demo incident is listed BESIDE the discovered ones — a
    // labelled choice, reported as a warning; a demo with NO discovered incident is the failure.
    demoIds.length === 0
      ? true
      : discoveredIds.length > 0 || args.includes('--allow-demo')
        ? null
        : false,
    `${incidentIds.length} incidents: ${discoveredIds.length} discovered from live hazards${demoIds.length > 0 ? `, ${demoIds.length} hand-seeded demo (${demoIds.join(', ')})` : ''}`,
  );

  // 10. AN INCIDENT CAN BE FETCHED BY ID, with no region hint — the path the UI's panels take.
  if (incidentIds.length > 0) {
    // The incident every signed-in probe uses: a discovered one when there is one (its headline carries
    // its place), else the first listed.
    const probeId = discoveredIds[0] ?? incidentIds[0];
    const byId = await get(`/api/v1/incidents/${encodeURIComponent(probeId)}`);
    record(
      'incident lookup by id',
      byId.ok && byId.status === 200,
      byId.ok ? `GET /incidents/${probeId} → ${byId.status}` : `${byId.error}`,
    );
  }

  // 11. EVERY MAP LAYER IS INSIDE THE REGION'S OUTLINE (ADR-042). Reads config/regions.json and the boundary
  //     file from the repository this script runs in; skipped (warning) when they are not there.
  const outline = await (async () => {
    try {
      const { readFileSync } = await import('node:fs');
      const { dirname, resolve } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
      const regions = JSON.parse(
        readFileSync(resolve(root, 'config/regions.json'), 'utf8'),
      ).regions;
      const cfg = regions.find((r) => r.id === REGION);
      if (!cfg?.boundary) return null;
      const doc = JSON.parse(readFileSync(resolve(root, 'config', cfg.boundary), 'utf8'));
      return { bbox: cfg.bbox, geometry: doc.type === 'Feature' ? doc.geometry : doc };
    } catch {
      return null;
    }
  })();
  if (outline === null) {
    record(
      'map layers inside the region outline',
      null,
      'config/regions.json or the boundary file not readable from here',
    );
  } else if (map.ok && map.status === 200) {
    const inRing = (x, y, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i],
          [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const polys =
      outline.geometry.type === 'Polygon'
        ? [outline.geometry.coordinates]
        : outline.geometry.coordinates;
    const inside = (x, y) =>
      polys.some((rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h)));
    // Within ~3 km (0.03°) of any outline EDGE, as the server measures it (region-clip `nearRing`): a
    // coastal camera on a headland the 1:50m coastline cuts off is in the region.
    const TOL = 0.03;
    const nearEdge = (x, y, ring) => {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1],
          [bx, by] = ring[i];
        if (Math.min(ax, bx) - TOL > x || Math.max(ax, bx) + TOL < x) continue;
        if (Math.min(ay, by) - TOL > y || Math.max(ay, by) + TOL < y) continue;
        const dx = bx - ax,
          dy = by - ay,
          len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const ex = ax + t * dx - x,
          ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= TOL * TOL) return true;
      }
      return false;
    };
    const near = (x, y) =>
      inside(x, y) || polys.some((rings) => rings.some((ring) => nearEdge(x, y, ring)));
    const positions = (node, out) => {
      if (Array.isArray(node)) {
        if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number')
          out.push([node[0], node[1]]);
        else for (const c of node) positions(c, out);
      } else if (node && typeof node === 'object')
        for (const v of Object.values(node)) positions(v, out);
    };
    const outsideByLayer = [];
    for (const [layer, value] of Object.entries(map.body?.data ?? {})) {
      if (layer === 'layerSources' || typeof value !== 'object') continue;
      // A projection (fire cone, flood reach) is a first-order forecast that legitimately crosses a
      // coastline or a border; it is labelled as such and is not a served record about the region.
      if (layer === 'predictions' || layer === 'prediction') continue;
      const pts = [];
      positions(value, pts);
      const out = pts.filter(([x, y]) => !near(x, y));
      if (out.length > 0)
        outsideByLayer.push(`${layer}: ${out.length} of ${pts.length} e.g. ${out[0].join(',')}`);
    }
    record(
      'map layers inside the region outline',
      outsideByLayer.length === 0,
      outsideByLayer.length === 0
        ? 'every position of every served layer is inside (or within ~3 km of) the outline; projections excluded'
        : outsideByLayer.join(' | '),
    );
  }

  // 12–16. SIGNED-IN CHECKS — only with an operator account: --user <id> --pass <password> (or the
  //         CHECK_LIVE_USER / CHECK_LIVE_PASS environment). Nothing here is printed except the role the
  //         server assigned. These are the paths the owner reported broken on 2026-09-14: the logistics
  //         board, the verification queue, the route, the SitRep.
  const USER = flag('user', process.env.CHECK_LIVE_USER ?? '');
  const PASS = flag('pass', process.env.CHECK_LIVE_PASS ?? '');
  if (USER !== '' && PASS !== '') {
    const auth = await (async () => {
      try {
        const res = await fetch(`${BASE}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: USER, password: PASS }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await res.json().catch(() => ({}));
        return res.ok && typeof body.token === 'string'
          ? { token: body.token, role: String(body.role ?? '?') }
          : null;
      } catch {
        return null;
      }
    })();
    record(
      'signed-in login',
      auth !== null,
      auth === null ? 'login failed' : `signed in (role ${auth.role})`,
    );
    if (auth !== null) {
      const H = { authorization: `Bearer ${auth.token}` };
      const firstId = discoveredIds[0] ?? incidentIds[0];
      // 12. SitRep: fields with citations.
      if (firstId !== undefined) {
        const sitrep = await get(`/api/v1/incidents/${encodeURIComponent(firstId)}/sitrep`, H);
        const fields = sitrep.body?.data?.fields ?? [];
        const cited = fields.filter(
          (f) => Array.isArray(f.citations) && f.citations.length > 0,
        ).length;
        record(
          'sitrep has cited fields',
          sitrep.ok && sitrep.status === 200 && fields.length > 0 && cited === fields.length,
          sitrep.ok
            ? `${fields.length} fields, ${cited} cited (aiMode ${sitrep.body?.data?.aiMode ?? '?'})`
            : `${sitrep.error}`,
        );
        // 13. Resources: the region's roster for this incident.
        const res = await get(`/api/v1/resources?incidentId=${encodeURIComponent(firstId)}`, H);
        const list = res.body?.data?.resources ?? [];
        const kinds = [...new Set(list.map((r) => r.kind))].sort();
        record(
          'resources for the incident',
          res.ok && res.status === 200 && list.length > 0,
          res.ok
            ? `${list.length} resources (${kinds.join(', ') || 'none'}) — 0 means the seed has not run or the role sees no org`
            : `${res.error}`,
        );
        // 14. Route: from the incident's own place to the nearest open shelter, inside the outline.
        const m = /near (\d+(?:\.\d+)?)°([NS]) (\d+(?:\.\d+)?)°([EW])/.exec(
          status.body?.data?.incidents?.find((i) => i.id === firstId)?.headline ?? '',
        );
        const origin = m
          ? [Number(m[3]) * (m[4] === 'W' ? -1 : 1), Number(m[1]) * (m[2] === 'S' ? -1 : 1)]
          : null;
        if (origin !== null) {
          const route = await (async () => {
            const started = Date.now();
            try {
              const r = await fetch(`${BASE}/api/v1/routes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...H },
                body: JSON.stringify({ origin, incidentId: firstId }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
              });
              return {
                ok: true,
                status: r.status,
                body: await r.json().catch(() => ({})),
                ms: Date.now() - started,
              };
            } catch (e) {
              return {
                ok: false,
                status: 0,
                body: {},
                ms: Date.now() - started,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          })();
          const rt = route.body?.data?.route;
          const coords = rt?.geom?.coordinates ?? [];
          const km = rt?.distanceM !== undefined ? (rt.distanceM / 1000).toFixed(1) : '?';
          record(
            'evacuation route',
            route.ok && route.status === 200 && coords.length >= 2,
            route.ok
              ? `${route.status}: engine ${rt?.engine ?? '?'}, ${coords.length} points, ${km} km, ${rt?.steps?.length ?? 0} turns, ${(route.body?.data?.shelters ?? []).length} shelters (${route.ms}ms)`
              : `${route.error}`,
          );
        } else {
          // A discovered incident's headline always names its place; a seeded/hybrid headline does not.
          // Recorded explicitly so a skipped probe can never pass as a checked one (review, PR #32).
          record(
            'route from the incident place',
            args.includes('--allow-demo') ? null : false,
            'incident headline carries no place — route not probed (seeded/hybrid incident)',
          );
        }
      }
      // 15. Verification queue: file a consented report, see it in the queue.
      const filed = await (async () => {
        try {
          const r = await fetch(`${BASE}/api/v1/reports`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              consent: true,
              text: `check:live probe ${new Date().toISOString()}`,
              ...(firstId ? { incidentId: firstId } : {}),
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          return { status: r.status, body: await r.json().catch(() => ({})) };
        } catch (e) {
          return { status: 0, body: {}, error: e instanceof Error ? e.message : String(e) };
        }
      })();
      const filedId = filed.body?.data?.id;
      const queue = await get('/api/v1/reports', H);
      const queued = queue.body?.data?.reports ?? [];
      record(
        'report → verification queue',
        filed.status === 201 || filed.status === 200 ? queued.some((q) => q.id === filedId) : false,
        `filed ${filed.status}${filedId ? ` (${filedId})` : ''}; queue ${queue.ok ? queue.status : queue.error}: ${queued.length} entries${filedId && queued.some((q) => q.id === filedId) ? ' — the probe is in it' : ''}`,
      );
    }
  } else {
    record(
      'signed-in checks',
      null,
      'skipped — pass --user/--pass (or CHECK_LIVE_USER/CHECK_LIVE_PASS) to exercise SitRep, resources, route and the verification queue',
    );
  }

  const failed = results.filter((r) => r.ok === false);
  const warned = results.filter((r) => r.ok === null);
  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { base: BASE, region: REGION, checkedAt: new Date().toISOString(), results },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `\n${failed.length === 0 ? 'OK' : 'PROBLEMS'} — ${results.length - failed.length - warned.length} passed, ${warned.length} warnings, ${failed.length} failed  (${BASE}, region ${REGION})`,
    );
  }
  return failed.length === 0 ? 0 : 1;
}

// THE EXIT CODE IS THE CONTRACT, so it has to be kept. 0 all clear, 1 the deployment has a problem, 2 the
// PROBE ITSELF could not run. The header promised 2 and nothing ever emitted it (review, PR #12): an
// uncaught throw exited with Node's default 1, indistinguishable from a failed check — so a wrapper or a
// cron could not tell "your site is down" from "your monitoring is broken", which are opposite actions.
main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`check-live could not run: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  });
