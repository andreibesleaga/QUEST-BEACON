// BEACON — region-aware CAP text provider tests (D3.4; ADR-036 §5, finding F-53). The end-to-end proof that
// the hop is WIRED lives in src/main/multilingual-cap-emission.test.ts (it goes through the real composition
// root and the real HTTP route). These tests cover the provider's own contract and its degradation
// behaviour, which an end-to-end test cannot reach cleanly.
import { describe, it, expect } from 'vitest';
import { makeAlert, buildAllClear, approveAlert } from '@/domain/alert.js';
import type { Alert } from '@/domain/alert.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import type { PolygonGeometry } from '@/domain/value-objects/geo.js';
import { parseRegionRegistry } from '@/adapters/persistence/region-registry.js';
import { alertToCap, capMachineValuesAgree } from '@/adapters/interop/cap-mapper.js';
import { makeCapTextProvider } from './cap-text.js';
import { LOCALE_IDS } from '@/config/locales.js';
import { warningTranslator } from './warning-catalog.js';

const SENT = '2026-07-05T22:00:00Z';
const RING: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [24.0, 44.0],
      [24.2, 44.0],
      [24.2, 44.2],
      [24.0, 44.2],
      [24.0, 44.0],
    ],
  ],
};

const REGIONS = parseRegionRegistry({
  default_region_id: 'ro',
  regions: [
    {
      id: 'ro',
      name: 'Romania',
      scope: 'COUNTRY',
      bbox: [20, 43, 30, 48],
      enabled_adapters: [],
      iso: 'RO',
      tz: 'Europe/Bucharest',
      languages: ['ro'],
    },
    {
      id: 'us-ca',
      name: 'California',
      scope: 'STATE',
      bbox: [-125, 32, -114, 42],
      enabled_adapters: [],
      iso: 'US',
      tz: 'America/Los_Angeles',
      languages: ['en'],
    },
    // A region configured with a language BEACON does not ship — the honest case (see below).
    {
      id: 'xx',
      name: 'Elsewhere',
      scope: 'COUNTRY',
      bbox: [0, 0, 1, 1],
      enabled_adapters: [],
      iso: 'XK',
      tz: 'UTC',
      languages: ['sw'],
    },
  ],
});

function alert(incidentId: string, over: Partial<Parameters<typeof makeAlert>[0]> = {}): Alert {
  return makeAlert({
    id: asId<AlertId>('alert-1'),
    incidentId: asId<IncidentId>(incidentId),
    capStatus: 'ACTUAL',
    approvedBy: asId<AppUserId>('em-1'),
    category: 'Met',
    severity: 'SEVERE',
    area: RING,
    sentAt: SENT,
    responseType: ['Evacuate'],
    ...over,
  });
}

const provider = makeCapTextProvider({
  regions: REGIONS,
  regionIdFor: (a) => ({ 'inc-ro': 'ro', 'inc-ca': 'us-ca', 'inc-xx': 'xx' })[String(a.incidentId)],
  areaDescFor: () => 'Galați County, Romania',
  whenFor: () => 'from 22:00 UTC',
  impactsFor: () => '3 lifeline nodes inside the hazard footprint',
});

describe('makeCapTextProvider', () => {
  it('produces one translation per region language, region first, English always', () => {
    const opts = provider(alert('inc-ro'));
    expect(opts.translations?.map((t) => t.language)).toEqual(['ro', 'en']);
    // The base (English) fields are set too, so the single- and multi-language paths are one code path —
    // and the BASE is the English source of record even for a Romanian region (ADR-030 §7).
    expect(opts.headline).toBe('FLOOD OR SEVERE WEATHER — Severe');
    expect(opts.event).toBe('Flood or severe weather');
    expect(opts.areaDesc).toBe('Galați County, Romania');
    // …while the Romanian block genuinely carries Romanian copy.
    expect(opts.translations?.[0]?.headline).toBe('INUNDAȚIE SAU VREME SEVERĂ — Severă');
  });

  it('produces English only for an English-speaking region', () => {
    expect(provider(alert('inc-ca')).translations?.map((t) => t.language)).toEqual(['en']);
  });

  it('SKIPS a region language BEACON does not ship rather than mislabelling English as it', () => {
    // config may name any language; only SHIPPED locales have copy. Emitting an <info language="sw"> block
    // holding English text would be a lie about what the block contains, so the block is simply not emitted.
    const opts = provider(alert('inc-xx'));
    expect(opts.translations?.map((t) => t.language)).toEqual(['en']);
  });

  it('falls back to English for an alert whose region is unknown', () => {
    const opts = provider(alert('inc-unmapped'));
    expect(opts.translations?.map((t) => t.language)).toEqual(['en']);
  });

  it('leads an ALL-CLEAR with ALL CLEAR, not with the hazard and its severity', () => {
    const original = alert('inc-ro');
    const cleared = approveAlert(
      buildAllClear({ id: asId<AlertId>('alert-1-clear'), original }),
      asId<AppUserId>('em-1'),
    );
    const opts = provider(cleared);
    const [ro, en] = opts.translations ?? [];
    expect(en?.headline).toBe('ALL CLEAR — Flood or severe weather');
    expect(ro?.headline).toBe('ALERTĂ ÎNCHEIATĂ — Inundație sau vreme severă');
    expect(en?.description).toContain('has ended');
    expect(en?.instruction).toContain('danger in Galați County, Romania has ended');
  });

  it('never varies a MACHINE value by language when its options are fed to the mapper', () => {
    const a = alert('inc-ro');
    const res = alertToCap(a, provider(a));
    expect(res.ok, res.ok ? '' : res.error.message).toBe(true);
    if (!res.ok) return;
    expect(capMachineValuesAgree(res.value)).toBe(true);
    expect(new Set(res.value.info.map((i) => i.severity))).toEqual(new Set(['Severe']));
    expect(new Set(res.value.info.map((i) => JSON.stringify(i.responseType)))).toEqual(
      new Set([JSON.stringify(['Evacuate'])]),
    );
    // The area description names a real place and is the SAME in every block — a translated place name
    // would be a wrong place name.
    expect(new Set(res.value.info.map((i) => i.area?.[0]?.areaDesc))).toEqual(
      new Set(['Galați County, Romania']),
    );
  });

  it('names the region when the composition has no description of the area (2026-11-21)', () => {
    // The live defect: an alert for a discovered incident read "WHERE: ." and "Watch for updates about .".
    const bare = makeCapTextProvider({ regions: REGIONS, regionIdFor: () => 'ro' });
    const opts = bare(alert('inc-ro'));
    expect(opts.areaDesc).toBe('Romania');
    expect(opts.translations).toHaveLength(2);
    for (const text of opts.translations ?? []) {
      expect(text.description).toContain('Romania');
      expect(text.instruction).toContain('Romania');
      expect(text.description).not.toMatch(/:\s*\.$/);
    }
  });

  it('a blank description counts as none; an unknown region still has no words to give', () => {
    const blank = makeCapTextProvider({
      regions: REGIONS,
      regionIdFor: () => 'us-ca',
      areaDescFor: () => '   ',
    });
    expect(blank(alert('inc-ca')).areaDesc).toBe('California');
    const unknown = makeCapTextProvider({ regions: REGIONS, regionIdFor: () => undefined });
    expect(unknown(alert('inc-x')).areaDesc).toBeUndefined();
  });

  it("adds a discovered incident's coordinates to the region, as a noun phrase the action can use", () => {
    const live = makeCapTextProvider({
      regions: REGIONS,
      regionIdFor: () => 'us-ca',
      locatorFor: () => '36.25°N 121.71°W',
    });
    const opts = live(alert('discovered:us-ca:WILDFIRE:-487:145'));
    expect(opts.areaDesc).toBe('California (36.25°N 121.71°W)');
    expect(opts.instruction).toContain('Leave California (36.25°N 121.71°W) now.');
    // A described area always wins over the fallback.
    const seeded = makeCapTextProvider({
      regions: REGIONS,
      regionIdFor: () => 'us-ca',
      areaDescFor: () => 'Butte County, California',
      locatorFor: () => '39.70°N 121.60°W',
    });
    expect(seeded(alert('us-ca-wildfire-demo')).areaDesc).toBe('Butte County, California');
  });
});

describe('warningTranslator (server-side catalog, ADR-030 fallback ladder)', () => {
  it('memoizes per locale and renders the shipped copy', () => {
    expect(warningTranslator('ro')).toBe(warningTranslator('ro'));
    expect(warningTranslator('en')('warning.label.what')).toBe('WHAT');
    expect(warningTranslator('ro')('warning.label.what')).toBe('CE');
  });

  it('resolves a key the locale lacks to the ENGLISH source text, never to a raw key or a blank', () => {
    // `ui.severity.MINOR` exists in every catalog; a key that exists ONLY in English exercises the merge.
    const t = warningTranslator('ar');
    const rendered = t('warning.label.action');
    expect(rendered.trim()).not.toBe('');
    expect(rendered).not.toContain('warning.label');
  });

  it('carries its catalogs in the code: no file read can leave an alert with raw keys (2026-11-21)', async () => {
    // The live defect: the runtime image has no `messages/` directory, the disk read failed, the English
    // base came back empty and an approved alert was emitted as "<headline>warning.headline</headline>".
    // The module must therefore not touch the file system at all.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./warning-catalog.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/from 'node:fs'|readFileSync|import\.meta\.url/);
  });

  it('renders real text for every shipped locale — never a key, never a blank', () => {
    for (const locale of LOCALE_IDS) {
      const t = warningTranslator(locale);
      for (const key of ['warning.label.what', 'warning.label.where', 'warning.label.action']) {
        const text = t(key);
        expect(text.trim(), `${locale} ${key}`).not.toBe('');
        expect(text, `${locale} ${key}`).not.toContain('warning.');
      }
    }
  });
});
