// BEACON — client-safe region view tests (ADR-031; FR-ZONE-1/7, findings F-06/F-22).
// Two properties matter here. First, the UI's region list is DERIVED from config, so adding a zone is a
// config entry rather than a code edit. Second — and this is the one that would hurt — no lookup ever
// substitutes another region's geography or timezone: a foreign incident labelled in the wrong timezone, or
// drawn over the wrong bounding box, is a wrong answer that looks like a right one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REGION_ID, SHIPPED_REGIONS, regionTimeZone, shippedRegion } from './regions.js';

const raw = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../config/regions.json', import.meta.url)), 'utf8'),
) as { default_region_id: string; regions: { id: string; tz: string; iso: string }[] };

describe('SHIPPED_REGIONS is derived from config, in registry order', () => {
  it('exposes exactly the configured regions', () => {
    expect(SHIPPED_REGIONS.map((r) => r.id)).toEqual(raw.regions.map((r) => r.id));
  });

  it('carries each region’s own iso, tz, languages and bbox', () => {
    for (const region of SHIPPED_REGIONS) {
      expect(region.iso, region.id).toMatch(/^[A-Z]{2}$/);
      expect(region.tz.length, region.id).toBeGreaterThan(2);
      expect(region.languages.length, region.id).toBeGreaterThan(0);
      expect(region.bbox).toHaveLength(4);
    }
  });

  it('does NOT leak operational posture to the client', () => {
    // `enabled_adapters` / `source_mode_overrides` are the server's business; a client that could read them
    // would eventually branch on them, and the server would stop being authoritative.
    for (const region of SHIPPED_REGIONS as unknown as Record<string, unknown>[]) {
      expect(region['enabled_adapters']).toBeUndefined();
      expect(region['source_mode_overrides']).toBeUndefined();
    }
  });

  it('agrees with the config on the default region', () => {
    expect(DEFAULT_REGION_ID).toBe(raw.default_region_id);
    expect(SHIPPED_REGIONS.map((r) => r.id)).toContain(DEFAULT_REGION_ID);
  });
});

describe('lookups never substitute another region (finding F-06)', () => {
  it('returns undefined for an unconfigured region', () => {
    expect(shippedRegion('atlantis')).toBeUndefined();
  });

  it('resolves each configured region to ITS OWN timezone', () => {
    for (const region of raw.regions) expect(regionTimeZone(region.id)).toBe(region.tz);
  });

  it('resolves an unknown or absent region to UTC, not to another region and not to the viewer’s zone', () => {
    expect(regionTimeZone('atlantis')).toBe('UTC');
    expect(regionTimeZone(undefined)).toBe('UTC');
    // Specifically: it must not silently inherit the default region's timezone.
    const defaultTz = raw.regions.find((r) => r.id === raw.default_region_id)?.tz;
    if (defaultTz !== undefined && defaultTz !== 'UTC')
      expect(regionTimeZone('atlantis')).not.toBe(defaultTz);
  });

  it('gives every region a distinct timezone or bbox (no shared fallback geography)', () => {
    const boxes = SHIPPED_REGIONS.map((r) => JSON.stringify(r.bbox));
    expect(new Set(boxes).size).toBe(boxes.length);
  });
});
