/* global process, URL */
// BEACON — Next.js config (E0·T-007). App Router; minimal, self-hosted assets only (offline-identical).
/** Hosts the operator's browser reaches for basemap tiles, styles, sprites and glyphs (see style.ts). */
export const BASEMAP_HOSTS = [
  'https://tile.openstreetmap.org',
  'https://tiles.openfreemap.org',
  'https://tiles.versatiles.org',
];

/** The origin of an operator-pinned tile URL, or nothing when unset/unparsable (a template is a URL too). */
function pinnedBasemapOrigin(env) {
  const url = env.NEXT_PUBLIC_BASEMAP_TILE_URL;
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** The response headers every route carries. `env` is injectable so the policy is testable. */
export function securityHeaders(env = process.env) {
  const pinned = pinnedBasemapOrigin(env);
  const tileHosts = [...BASEMAP_HOSTS, ...(pinned ? [pinned] : [])].join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tileHosts}`,
    "font-src 'self' data:",
    `connect-src 'self' ${tileHosts}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    ...(env.NODE_ENV === 'development' ? [] : [{ key: 'Content-Security-Policy', value: csp }]),
  ];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true, // moved out of experimental in Next 15.5
  // Security response headers (THREAT_MODEL §11 hardening; audit finding F-12, 2026-09-13).
  //   - HSTS: the deployment is served over TLS by the platform; a browser ignores it on plain http.
  //   - CSP (production builds only — `next dev` needs eval for HMR): everything is same-origin except the
  //     basemap tiles the OPERATOR'S browser fetches from the keyless hosts in app/_components/map/style.ts
  //     (and the host an operator pins with NEXT_PUBLIC_BASEMAP_TILE_URL). MapLibre runs its worker from a
  //     blob: URL and decodes raster tiles through blob: images. Next's hydration runtime is inline, so
  //     script-src and style-src carry 'unsafe-inline' (no nonce/hash without a middleware; recorded in
  //     SECURITY_BASELINE as the accepted residual). frame-ancestors 'none' duplicates X-Frame-Options.
  //   The allow-list is tested (app/_lib/security-headers.test.ts) against the basemap ladder, so a new
  //   tile host cannot be added without the policy learning about it.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders(process.env),
      },
    ];
  },
  // The codebase uses ESM `.js` import specifiers that resolve to `.ts`/`.tsx` (tsc moduleResolution
  // bundler). Teach webpack the same alias so `next build` resolves them (Turbopack/tsc already do).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
      ...config.resolve.extensionAlias,
    };
    // The live source adapters resolve their mock-fixture DIR at runtime via
    // `fileURLToPath(new URL('./__fixtures__', import.meta.url))`. Webpack otherwise special-cases
    // `new URL(..., import.meta.url)` as a bundle-time asset and fails on the directory reference. BEACON
    // serves only self-hosted assets (no URL-asset bundling), so disable that parser feature and leave the
    // expression as a runtime read (dev/Node resolve it from source; production live-mode uses network, and
    // the mock/cached fixture fallback is a dev/docker affordance — see docs/audit/LIVE_VERIFICATION.md).
    config.module.parser = {
      ...config.module.parser,
      javascript: { ...config.module.parser?.javascript, url: false },
    };
    return config;
  },
};
export default nextConfig;
