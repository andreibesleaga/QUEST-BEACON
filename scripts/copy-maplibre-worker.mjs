#!/usr/bin/env node
// BEACON — put MapLibre's worker where the browser can actually fetch it.
//
// THE DEFECT THIS FIXES, exactly. MapLibre v6 resolves its worker at RUNTIME with
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Inside a Next/webpack bundle `import.meta.url`
// is the emitted CHUNK's url, so the browser asks for `/_next/static/chunks/maplibre-gl-worker.mjs` —
// which webpack never emitted, because `next.config.mjs` deliberately disables the `new URL(…,
// import.meta.url)` asset parser (the live source adapters resolve a fixtures DIRECTORY that way, and the
// parser fails on a directory reference).
//
// So the request 404s, returns the SPA's HTML, and the module worker dies. Nothing appears in the console.
// A RASTER basemap survives this — raster tiles are decoded on the main thread — which is why it went
// unnoticed until the basemap became VECTOR: every vector source needs the worker to parse a tile, so the
// map renders nothing at all. Verified against a real `next build` on 2026-09-12: the chunk references
// `maplibre-gl-worker` and no such file exists anywhere under `.next`.
//
// Copying the two dist files into `public/` and pointing `setWorkerUrl` at them is the smallest fix that
// is also honest about the project's "self-hosted assets only, no CDN" posture. The worker imports
// `./maplibre-gl-shared.mjs` by a RELATIVE specifier, so both files must sit in the same served directory
// — that is why this copies two files and not one.
//
// Run automatically by `prebuild`/`predev`; the destination is gitignored because it is a build artefact
// whose version must track `node_modules`, never a vendored copy that silently goes stale.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'node_modules', 'maplibre-gl', 'dist');
const to = join(here, '..', 'public', 'maplibre');

/** Both, and in this order — the worker is useless without the shared chunk it imports. */
const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

mkdirSync(to, { recursive: true });
for (const file of FILES) {
  copyFileSync(join(from, file), join(to, file));
}
process.stdout.write(`maplibre worker → public/maplibre/ (${FILES.join(', ')})\n`);
