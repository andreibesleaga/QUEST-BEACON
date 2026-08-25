// BEACON — `fixture:` imagery reader (S2·Lane V; Art. XVI). The OFFLINE/gate path, unchanged in meaning:
// `fixture:<id>` has been the demo handle since S03 and every existing test still passes it. What changes is
// that the handle now RESOLVES — `fixtures/vision/<id>.png` are real recorded NASA GIBS tiles (see
// fixtures/vision/PROVENANCE.json), so an air-gapped run can put actual pixels in front of a local model
// instead of only in front of MockVision.
//
// MockVision itself still reads NO pixels (mock-vision.ts says so explicitly) — this reader exists for the
// cloud/local rungs, which do.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ImageryFetcher, VisionImage } from './imagery-source.js';

export const FIXTURE_SCHEME = 'fixture:';

// Same charset the HTTP edge already enforces on a `fixture:<id>` imageRef (channels/http/routing.ts:277).
// Re-asserted HERE because this function opens a FILE: a `..` or `/` in an id would be a path traversal, and
// the edge guard protects one entry point while this protects the read itself.
const FIXTURE_ID = /^[A-Za-z0-9._-]+$/;

/**
 * `fixtures/vision/` at the repo root — five levels up from `src/adapters/ai/vision/imagery/`.
 *
 * Resolved LAZILY, on the first read, not at module load. The vision ladder is reachable from the
 * composition root, which frontend component tests import (they run under happy-dom, where `import.meta.url`
 * is not a `file:` URL) — a module-level `fileURLToPath` threw there and took a whole UI suite down with it,
 * for a path nothing in that suite would ever have used.
 */
function defaultFixturesDir(): string {
  return fileURLToPath(new URL('../../../../../fixtures/vision/', import.meta.url));
}

const FIXTURE_ATTRIBUTION = 'Recorded NASA EOSDIS GIBS tile (offline fixture) — see fixtures/vision/PROVENANCE.json';

export interface FixtureImageryDeps {
  readonly fixturesDir?: string;
  /** Injected reader so tests never touch the filesystem layout (defaults to node:fs/promises). */
  readonly readFileImpl?: (path: string) => Promise<Uint8Array>;
}

export function parseFixtureId(imageRef: string): string {
  if (!imageRef.startsWith(FIXTURE_SCHEME)) throw new Error(`not a fixture imageRef: ${imageRef}`);
  const id = imageRef.slice(FIXTURE_SCHEME.length);
  if (!FIXTURE_ID.test(id)) throw new Error(`imagery ${imageRef} has an invalid fixture id`);
  return id;
}

export function makeFixtureImagery(deps: FixtureImageryDeps = {}): ImageryFetcher {
  const read = deps.readFileImpl ?? ((path: string): Promise<Uint8Array> => readFile(path));
  return {
    scheme: FIXTURE_SCHEME,
    async fetch(imageRef: string): Promise<VisionImage> {
      const dir = deps.fixturesDir ?? defaultFixturesDir();
      const id = parseFixtureId(imageRef);
      // A MISSING fixture is an honest error, not an empty image: the caller degrades to the labelled mock
      // rung rather than asking a model to classify zero bytes.
      const bytes = await read(`${dir}${id}.png`).catch(() => {
        throw new Error(`imagery ${imageRef} not recorded on disk (fixtures/vision/${id}.png)`);
      });
      return { imageRef, bytes, mediaType: 'image/png', attribution: `${FIXTURE_ATTRIBUTION} — ${id}` };
    },
  };
}
