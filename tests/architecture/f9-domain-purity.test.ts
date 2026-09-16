// BEACON — F9 fitness function: DOMAIN PURITY (E1·T-092).
// The domain layer is the deterministic heart of the system; it must never depend on a framework,
// runtime, HTTP/DB client, or an outer layer. This is CONSTITUTION Article II + AGENTS §3 as an
// executable gate — belt-and-suspenders alongside the eslint boundary rule and dependency-cruiser.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DOMAIN_DIR = resolve(process.cwd(), 'src/domain');

/** Anything the domain is forbidden to import. Matches the eslint `domain-purity` boundary. */
const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /^next(\/|$)/, why: 'Next.js framework' },
  { pattern: /^react(\/|$|-dom)/, why: 'React' },
  { pattern: /^postgres(\/|$)/, why: 'postgres driver' },
  { pattern: /^drizzle-orm(\/|$)/, why: 'Drizzle ORM' },
  { pattern: /^node:/, why: 'Node.js built-in (domain must be runtime-agnostic)' },
  { pattern: /^@\/adapters(\/|$)/, why: 'adapters layer (inward dependency rule)' },
  { pattern: /^@\/main(\/|$)/, why: 'composition root (inward dependency rule)' },
  { pattern: /^@\/application(\/|$)/, why: 'application layer (inward dependency rule)' },
];

/** All non-test .ts files under src/domain (recursive). */
function domainSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...domainSourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Extract every module specifier from `import ... from '<x>'` and `export ... from '<x>'`. */
function importedSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[1]) specs.push(m[1]);
  }
  // Also catch bare side-effect imports: import 'x';
  const bare = /\bimport\s*['"]([^'"]+)['"]/g;
  while ((m = bare.exec(source)) !== null) {
    if (m[1]) specs.push(m[1]);
  }
  return specs;
}

describe('F9 — domain purity (Constitution Art. II)', () => {
  const files = domainSourceFiles(DOMAIN_DIR);

  it('finds domain source files to check', () => {
    expect(files.length).toBeGreaterThan(20); // 19 entities + primitives + value objects + barrel
  });

  it.each(files.map((f) => [f.slice(DOMAIN_DIR.length + 1), f] as const))(
    'src/domain/%s imports nothing forbidden',
    (_rel, full) => {
      const specs = importedSpecifiers(readFileSync(full, 'utf8'));
      for (const spec of specs) {
        for (const { pattern, why } of FORBIDDEN) {
          expect(pattern.test(spec), `forbidden import "${spec}" (${why})`).toBe(false);
        }
      }
    },
  );
});
