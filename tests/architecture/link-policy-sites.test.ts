// BEACON — structural fitness function: THE LINK-ONLY URL RULE HAS ONE IMPLEMENTATION (F-153).
//
// "An external link must be an absolute https URL to a NAMED host" was implemented SEVEN times in this
// repository as a private, un-importable predicate, six of them WEAKER than the strictest one:
//   src/domain/camera-feed.ts · src/domain/public-report.ts · the caltrans-cctv / alertwildfire / dot511 /
//   windy-webcams camera ACLs · src/application/map-projection/map-projection.ts.
// MW-E converged all seven onto src/domain/shared/link-policy.ts (F-153 named six of them; the projection
// filter was found by this scan). Two further sites are DECLARED below rather than converged — one because
// it is genuinely STRICTER (converging it would weaken an SSRF gate), one because another lane owns it.
// This file is what stops the next copy.
//
// WHY A FITNESS FUNCTION AND NOT JUST THE TYPE SYSTEM. The ACL row types are branded (`LinkOnlyUrl`), so a
// re-declared predicate there is already a `tsc --noEmit` error — that is the strongest form and it is used
// wherever a validated link is CARRIED in a field. But the three sites that merely CHECK a link in passing
// (a factory invariant, a projection filter) hold a plain `string`, and no type can stop someone from
// writing `new URL(x).protocol === 'https:'` inline there. So the rule is enforced structurally too:
//
//     EVERY non-test file under src/ and app/ that decides whether a URL is an acceptable https link must
//     either DERIVE that decision from @/domain/shared/link-policy, or be declared below with a reason.
//
// The scan is the guard; the enumeration is the audit trail. A new private copy fails this test on the day
// it is written, naming the file — it cannot accumulate quietly the way the first seven did.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const REPO = process.cwd();
const SCANNED_ROOTS = ['src', 'app'] as const;

/** The shapes a hand-rolled "is this an https link?" decision actually takes in this codebase (all seven
 *  converged copies matched one of these). Deliberately broad — the burden is on a new site to declare
 *  itself, not on this regex to anticipate the exact spelling someone reaches for. */
const PRIVATE_HTTPS_RULE =
  /\.protocol\s*[!=]==?\s*['"]https:['"]|startsWith\(\s*['"]https:\/\/['"]\s*\)|\/\^https:\\?\/\\?\//;

/** The one sanctioned source of the rule. A file that imports this DERIVES the decision — that is the fix. */
const DERIVES_FROM_POLICY = /from\s+['"][^'"]*shared\/link-policy\.js['"]/;

/** The policy's own home, plus the sites NOT YET converged (each with the reason it is still listed). */
const DECLARED: ReadonlyMap<string, string> = new Map([
  [
    'src/domain/shared/link-policy.ts',
    'THE HOME. This is the one implementation every other site derives from — of course it matches.',
  ],
  [
    'src/adapters/channels/http/routing.ts',
    'STRICTER BY DESIGN, AND DELIBERATELY LEFT ALONE. `isAllowedLiveViewUrl` is the intake-edge gate for a ' +
      'citizen live-view link: it enforces an explicit HOST allow-list (youtube/youtu.be/twitch/facebook) ' +
      'plus a per-host PATH allow-list, rejects `user:pass@` userinfo, and caps the length. Every one of ' +
      'those is a guarantee the shared policy does NOT make, and the host allow-list already implies ' +
      'https + non-IP host — so replacing it with `isLinkOnlyUrl` would WEAKEN an SSRF gate, which is worse ' +
      'than the duplication F-153 is about. It is also inside src/adapters/channels/http/**, another lane. ' +
      'The transport-independent floor it sits on top of IS the shared policy, enforced in the domain by ' +
      'makePublicReport — so nothing here is un-derived, it is defence in depth.',
  ],
]);

/** Code only — a rule QUOTED IN A COMMENT is not a rule, and several converged sites document the private
 *  predicate they replaced. Block comments and whole-line `//` comments go; string literals are left intact
 *  (`startsWith('https://')` contains `//`, so a naive comment stripper would corrupt the very thing we
 *  are looking for). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__fixtures__' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full) && !/\.d\.ts$/.test(full)) out.push(full);
  }
  return out;
}

/** Repo-relative, POSIX-separated path (the keys in DECLARED are written that way). */
function rel(file: string): string {
  return relative(REPO, file).split(sep).join('/');
}

const SITES: readonly string[] = SCANNED_ROOTS.flatMap((root) => walk(resolve(REPO, root)))
  .filter((file) => PRIVATE_HTTPS_RULE.test(code(readFileSync(file, 'utf8'))))
  .map(rel)
  .sort();

describe('F-153 — the link-only URL rule is derived, never re-declared', () => {
  it('the scan is not vacuous: it finds real files to judge', () => {
    // If the walk ever silently matched nothing (a moved root, a broken regex) every assertion below would
    // pass while guarding nothing at all — the exact failure mode that let seven copies accumulate.
    expect(SITES.length).toBeGreaterThan(0);
    expect(SITES).toContain('src/domain/shared/link-policy.ts');
  });

  it.each(SITES.map((s) => [s, s] as const))(
    '%s either derives from shared/link-policy or is a declared exception',
    (_name, site) => {
      const declared = DECLARED.get(site);
      if (declared !== undefined) {
        expect(declared.length).toBeGreaterThan(40); // a declaration without a reason is not a declaration
        return;
      }
      expect(
        DERIVES_FROM_POLICY.test(code(readFileSync(resolve(REPO, site), 'utf8'))),
        `${site} decides whether a URL is an acceptable https link without importing ` +
          `@/domain/shared/link-policy. That rule has ONE home (F-153) — import isLinkOnlyUrl/` +
          `assertLinkOnlyUrl, or add ${site} to DECLARED here with the reason it cannot.`,
      ).toBe(true);
    },
  );

  it('every DECLARED exception still exists and still matches — the list cannot rot into a lie', () => {
    for (const site of DECLARED.keys()) {
      expect(SITES, `${site} no longer matches the scan — delete its DECLARED entry`).toContain(site);
    }
  });

  it('the converged sites all derive from the shared policy and re-declare nothing', () => {
    const converged = [
      'src/domain/camera-feed.ts',
      'src/domain/public-report.ts',
      'src/application/map-projection/map-projection.ts',
      'src/adapters/sources/caltrans-cctv/caltrans-cctv-acl.ts',
      'src/adapters/sources/alertwildfire/alertwildfire-acl.ts',
      'src/adapters/sources/dot511/dot511-acl.ts',
      'src/adapters/sources/windy-webcams/windy-webcams-acl.ts',
      // …plus the fifth camera ACL, whose HOST ALLOW-LIST was kept and the shared policy added on top.
      'src/adapters/sources/cnadnr-ro/cnadnr-ro-acl.ts',
    ];
    for (const site of converged) {
      const text = code(readFileSync(resolve(REPO, site), 'utf8'));
      expect(DERIVES_FROM_POLICY.test(text), `${site} must import the shared link policy`).toBe(true);
      // …and must no longer carry a private copy of the rule beside it (the scan above only sees files that
      // match; this pins these eight specifically, so a re-declaration here fails even if DECLARED grows).
      expect(PRIVATE_HTTPS_RULE.test(text), `${site} re-declares the https rule instead of deriving it`).toBe(
        false,
      );
    }
  });
});
