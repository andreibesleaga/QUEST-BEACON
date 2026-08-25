// BEACON — Next.js config (E0·T-007). App Router; minimal, self-hosted assets only (offline-identical).
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true, // moved out of experimental in Next 15.5
  // Baseline security response headers (THREAT_MODEL §11 hardening). Conservative set only:
  // no CSP here — the demo runs same-origin with Next inline runtime chunks, and all external
  // camera/view links open via window.open/anchor (never framed), so DENY is safe.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
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
