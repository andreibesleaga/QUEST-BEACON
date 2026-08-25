// BEACON — region registry loader (E3·T-129; ADR-011). Reads config/regions.json → Region entities
// via makeRegion, preserving each region's per-source mode overrides (LIVE|CACHED|MOCK). Adding a region
// is one config entry, zero code change (FR-10). Adapter layer (Art. II) — config in, domain out.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeRegion, asId } from '@/domain/index.js';
import type { BBox, Region, RegionId, RegionScope } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { alertLocalesFor } from '@/config/locales.js';
import type { LocaleId } from '@/config/locales.js';

/** One region as read from config, pairing the domain entity with its non-domain runtime metadata. */
export interface LoadedRegion {
  readonly configId: string; // registry key (e.g. "us-ca", "ro")
  readonly region: Region;
  readonly sourceModeOverrides: Record<string, string>;
}

export interface RegionRegistry {
  readonly defaultRegionId: string;
  readonly regions: readonly LoadedRegion[];
}

interface RawRegion {
  id?: unknown;
  name?: unknown;
  scope?: unknown;
  bbox?: unknown;
  enabled_adapters?: unknown;
  source_mode_overrides?: unknown;
  iso?: unknown;
  tz?: unknown;
  languages?: unknown;
}

/**
 * The default config path, resolved LAZILY rather than at module evaluation. `fileURLToPath` throws on a
 * non-`file:` `import.meta.url`, which is exactly what a browser-environment test runner (happy-dom) hands
 * this module — so computing it eagerly made merely IMPORTING this file a crash in any graph that reaches it
 * from a client-side test, even when nothing ever loads a region. Deferring it to the call keeps the server
 * behaviour byte-identical and makes the failure (if any) a typed `Result` from `loadRegionRegistry` instead
 * of an import-time throw (Art. XVI — degrade, never dead-end).
 */
function defaultConfigPath(): string {
  return fileURLToPath(new URL('../../../config/regions.json', import.meta.url));
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function asRecord(v: unknown): Record<string, string> {
  if (typeof v !== 'object' || v === null) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  return out;
}

function parseRegion(raw: RawRegion): LoadedRegion {
  // `iso`, `tz` and `languages` are now carried ON THE ENTITY rather than as loose side-metadata: they are
  // properties of the region, and keeping them off the entity is what forced the composition root to hold a
  // hardcoded ISO map (finding F-04/F-05). `units` was removed — it claimed a per-region imperial/metric
  // switch that nothing implemented; BEACON displays SI everywhere, always labelled.
  const region = makeRegion({
    id: asId<RegionId>(String(raw.id)),
    name: String(raw.name),
    scope: raw.scope as RegionScope,
    bbox: raw.bbox as BBox,
    enabledAdapters: asStringArray(raw.enabled_adapters),
    ...(typeof raw.iso === 'string' && raw.iso !== '' ? { iso: raw.iso } : {}),
    ...(typeof raw.tz === 'string' ? { tz: raw.tz } : {}),
    ...(Array.isArray(raw.languages) ? { languages: asStringArray(raw.languages) } : {}),
  });
  return {
    configId: String(raw.id),
    region,
    sourceModeOverrides: asRecord(raw.source_mode_overrides),
  };
}

/** Parse an already-loaded registry object into typed domain regions (pure — used by tests). */
export function parseRegionRegistry(raw: unknown): RegionRegistry {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { regions?: unknown }).regions)) {
    throw new DomainError('PARSE_ERROR', 'region registry must be { default_region_id, regions[] }');
  }
  const obj = raw as { default_region_id?: unknown; regions: RawRegion[] };
  return {
    defaultRegionId: String(obj.default_region_id ?? ''),
    regions: obj.regions.map(parseRegion),
  };
}

/**
 * One loaded region by its config id, or undefined when the id is not configured (no invented default).
 * Exported as THE config-id lookup (finding F-55): the live composition (src/main/live-seed.ts) used to
 * carry its own duplicate of this find — one copy here keeps "which region is this id" a single answer.
 */
export function findRegion(registry: RegionRegistry, regionId: string): LoadedRegion | undefined {
  return registry.regions.find((r) => r.configId === regionId);
}

/**
 * The ordered locale list every outbound alert for this region must carry: the region's configured
 * `languages` first, then English ALWAYS (FR-I18N-6) — resolved through the ONE definition of that ordering,
 * `alertLocalesFor()` (src/config/locales.ts). This is where a region's `languages` becomes an operational
 * input rather than persisted-but-unused metadata (B1.3, finding F-05; it also gives `alertLocalesFor`
 * its first non-test caller, finding F-14).
 *
 * An unconfigured region — or a region whose configured languages are not shipped locales — resolves to
 * ENGLISH ONLY: never another region's language, and never a locale with no catalog (which would emit an
 * <info> block whose `<language>` lies about its contents). `languages` is REQUIRED of every config-authored
 * region (schemas/regions.schema.json), so the empty case is a programmatic/unknown region, not a shipped one.
 *
 * REMAINING WIRING (owned by the interop/alerting lane, not here): the CAP emission path must call this and
 * pass the result to `capTranslationsFor(languages, texts)` (src/adapters/interop/cap-mapper.ts:256) via
 * `CapOptions.translations` — the seam is `makeAlertSink({ clock })` in src/main/feature-seed.ts:213, which
 * today supplies no `capOptions` at all, so every emitted CAP carries exactly one English <info> block.
 */
export function regionAlertLocales(registry: RegionRegistry, regionId: string): readonly LocaleId[] {
  return alertLocalesFor(findRegion(registry, regionId)?.region.languages ?? []);
}

/** Load + parse config/regions.json (default path). Returns a typed Result — never throws upstream. */
export function loadRegionRegistry(path?: string): Result<RegionRegistry, DomainError> {
  try {
    return ok(parseRegionRegistry(JSON.parse(readFileSync(path ?? defaultConfigPath(), 'utf8'))));
  } catch (e) {
    return e instanceof DomainError
      ? err(e)
      : err(new DomainError('PARSE_ERROR', `failed to load region registry: ${String(e)}`));
  }
}
