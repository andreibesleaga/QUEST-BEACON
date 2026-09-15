// BEACON — the response-header policy in next.config.mjs (audit F-12, 2026-09-14). The one thing that can
// silently break the map is a basemap host the CSP does not name: this test reads the SAME ladder the map
// walks and checks every host is allowed for tiles (connect-src) and decoded images (img-src).
import { describe, expect, it } from 'vitest';
import { BASEMAP_CANDIDATES } from '../_components/map/style.js';
import { securityHeaders } from '../../next.config.mjs';

const header = (
  headers: readonly { key: string; value: string }[],
  key: string,
): string | undefined => headers.find((h) => h.key === key)?.value;

const directive = (csp: string, name: string): string[] =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
    ?.split(/\s+/)
    .slice(1) ?? [];

describe('securityHeaders (next.config.mjs)', () => {
  const prod = securityHeaders({ NODE_ENV: 'production' });
  const csp = header(prod, 'Content-Security-Policy') ?? '';

  it('names every basemap host of the ladder for tiles and images', () => {
    for (const candidate of BASEMAP_CANDIDATES) {
      const origin = new URL(candidate.url.replace('{z}/{x}/{y}', '0/0/0')).origin;
      expect(directive(csp, 'connect-src')).toContain(origin);
      expect(directive(csp, 'img-src')).toContain(origin);
    }
  });

  it('lets MapLibre run its worker and decode tiles from blob: URLs, and frames nobody', () => {
    expect(directive(csp, 'worker-src')).toContain('blob:');
    expect(directive(csp, 'img-src')).toContain('blob:');
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(header(prod, 'X-Frame-Options')).toBe('DENY');
  });

  it('allows an operator-pinned tile host, and only its origin', () => {
    const pinned = securityHeaders({
      NODE_ENV: 'production',
      NEXT_PUBLIC_BASEMAP_TILE_URL: 'https://tiles.example.org/base/{z}/{x}/{y}.png?key=abc',
    });
    const pinnedCsp = header(pinned, 'Content-Security-Policy') ?? '';
    expect(directive(pinnedCsp, 'connect-src')).toContain('https://tiles.example.org');
    expect(pinnedCsp).not.toContain('key=abc');
    const unparsable = securityHeaders({
      NODE_ENV: 'production',
      NEXT_PUBLIC_BASEMAP_TILE_URL: '{z}/{x}',
    });
    expect(header(unparsable, 'Content-Security-Policy')).toBe(csp);
  });

  it('sends HSTS on every build, and no CSP under next dev (HMR needs eval)', () => {
    expect(header(prod, 'Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    const dev = securityHeaders({ NODE_ENV: 'development' });
    expect(header(dev, 'Content-Security-Policy')).toBeUndefined();
    expect(header(dev, 'Strict-Transport-Security')).toBeDefined();
    expect(header(dev, 'X-Content-Type-Options')).toBe('nosniff');
  });
});
