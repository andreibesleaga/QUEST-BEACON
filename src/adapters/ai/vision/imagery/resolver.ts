// BEACON — imageRef → pixels resolver (S2·Lane V; Art. XII/XIV/XVI). One place that decides which fetcher
// handles a handle, enforces `VISION_MAX_IMAGE_MB`, and applies the `VISION_PII_SCREEN` posture — so no
// individual fetcher can forget any of the three.
//
// Scheme ladder (plan §0 decision 11):
//   fixture:  offline recorded tile — the air-gapped/gate path, always available
//   gibs:     NASA GIBS, KEYLESS, the live default
//   cdse:     Copernicus Sentinel-2, richer but credentialed — DEGRADES TO GIBS when unconfigured
import {
  assertWithinSizeBudget,
  type FetchLike,
  type ImageryEnv,
  type ImageryFetcher,
  type VisionImage,
} from './imagery-source.js';
import { GIBS_SCHEME, GIBS_TASK_LAYERS, makeGibsFetcher } from './gibs.js';
import { CDSE_SCHEME, makeCopernicusFetcher } from './copernicus.js';
import { FIXTURE_SCHEME, makeFixtureImagery } from './fixture-imagery.js';

/** Turns a `VisionRequest.imageRef` into bytes, or REJECTS — the caller then degrades to a labelled rung. */
export interface ImageryResolver {
  resolve(imageRef: string): Promise<VisionImage>;
}

export interface ImageryResolverDeps {
  readonly fetchImpl: FetchLike;
  readonly config: ImageryEnv;
  /** Pixel edge for the live fetchers (kept injectable so a slow link can ask for less). */
  readonly pixels?: number;
  readonly fixturesDir?: string;
  readonly readFileImpl?: (path: string) => Promise<Uint8Array>;
  readonly now?: () => number;
}

const CDSE_DEGRADE_NOTE =
  'Copernicus credentials absent (COPERNICUS_CLIENT_ID/COPERNICUS_CLIENT_SECRET) — served from NASA GIBS instead';

/**
 * `VISION_PII_SCREEN=on` (the default) restricts imagery to the three schemes whose provenance BEACON knows:
 * satellite products and recorded tiles, none of which can contain reporter PII.
 *
 * A bare `https://` imageRef is the SOS-photo transport shape the HTTP edge already allows
 * (channels/http/routing.ts:277) — and BEACON has no automated PII screen for an arbitrary photo. Refusing it
 * here is the flag's real effect: the screen can only ever TIGHTEN the SOS path. Turning the flag off does not
 * loosen consent — `VisionAdapter.sealed` still rejects any un-consented/un-screened image unconditionally
 * (vision-adapter.ts:46), which is why the flag is safe to expose at all.
 */
function assertScreenPosture(imageRef: string, config: ImageryEnv): void {
  if (config.VISION_PII_SCREEN !== 'on') return;
  const known = [FIXTURE_SCHEME, GIBS_SCHEME, CDSE_SCHEME].some((s) => imageRef.startsWith(s));
  if (!known) {
    throw new Error(
      `imagery ${imageRef} refused: VISION_PII_SCREEN=on admits only provenance-known schemes (fixture:/gibs:/cdse:)`,
    );
  }
}

/** `cdse:<bbox>:<date>` → the equivalent `gibs:` handle, used when CDSE has no credentials. */
export function cdseToGibsRef(imageRef: string): string {
  return `${GIBS_SCHEME}:${imageRef.slice(CDSE_SCHEME.length)}`;
}

function buildFetchers(deps: ImageryResolverDeps): readonly ImageryFetcher[] {
  const { COPERNICUS_CLIENT_ID: clientId, COPERNICUS_CLIENT_SECRET: clientSecret } = deps.config;
  const optional: readonly ImageryFetcher[] =
    clientId !== undefined && clientSecret !== undefined
      ? [
          makeCopernicusFetcher({
            fetchImpl: deps.fetchImpl,
            credentials: { clientId, clientSecret },
            ...(deps.pixels !== undefined ? { pixels: deps.pixels } : {}),
            ...(deps.now !== undefined ? { now: deps.now } : {}),
          }),
        ]
      : [];
  return [
    makeFixtureImagery({
      ...(deps.fixturesDir !== undefined ? { fixturesDir: deps.fixturesDir } : {}),
      ...(deps.readFileImpl !== undefined ? { readFileImpl: deps.readFileImpl } : {}),
    }),
    makeGibsFetcher({ fetchImpl: deps.fetchImpl, ...(deps.pixels !== undefined ? { pixels: deps.pixels } : {}) }),
    ...optional,
  ];
}

export function makeImageryResolver(deps: ImageryResolverDeps): ImageryResolver {
  const fetchers = buildFetchers(deps);
  const byScheme = new Map(fetchers.map((f) => [f.scheme, f]));
  return {
    async resolve(imageRef: string): Promise<VisionImage> {
      assertScreenPosture(imageRef, deps.config);
      // CDSE is the OPTIONAL rung: with no credentials its fetcher is never built, so the handle is served
      // from the keyless default instead of failing. The substitution is stated in the attribution, never
      // silent — an operator reading the finding can see which sensor actually answered (Art. XVI).
      const degraded = imageRef.startsWith(CDSE_SCHEME) && !byScheme.has(CDSE_SCHEME);
      const effectiveRef = degraded ? cdseToGibsRef(imageRef) : imageRef;
      const fetcher = fetchers.find((f) => effectiveRef.startsWith(f.scheme));
      if (fetcher === undefined) throw new Error(`imagery ${imageRef} uses an unsupported scheme`);
      const image = await fetcher.fetch(effectiveRef);
      assertWithinSizeBudget(image.bytes, deps.config.VISION_MAX_IMAGE_MB, imageRef);
      return degraded ? { ...image, attribution: `${image.attribution} [${CDSE_DEGRADE_NOTE}]` } : image;
    },
  };
}

/** Task-appropriate GIBS layer for a UI-built handle (burn-area → false colour, flood → true colour). */
export function gibsLayerForTask(task: string): string {
  return GIBS_TASK_LAYERS[task] ?? '';
}
