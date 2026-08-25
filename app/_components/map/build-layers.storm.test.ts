// BEACON — storm layer builder + exhaustive-map guard (ADR-032; FR-STORM-2 / FEV-5).
//
// What must hold, and why each is its own assertion:
//   • the layer is DEFAULT OFF and contributes nothing until toggled (a forecast cone shown unasked reads as
//     an impact area — ADR-032 §4);
//   • track/cone/surge come out as separate descriptors of ONE group, distinguished by geometry KIND and by
//     TEXT, never by colour (T-346: colour is never the sole signal);
//   • the cone always carries an uncertainty caveat naming the issuer + advisory instant, and still carries
//     the "not the extent of hazardous conditions" warning when the wire has no attribution (Art. XVI);
//   • every user-visible string is localizable AND identical in English with or without a translator
//     (FR-I18N-2), so existing baselines stay valid;
//   • the six exhaustive `Record<LayerId, …>` maps cover LAYER_IDS exactly — a belt-and-braces guard in case
//     a future refactor drops a `Record<LayerId, …>` annotation and with it the `tsc` safety net.
import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import { LAYER_IDS, type LayerId } from '../../_lib/types.js';
import {
  buildLayers,
  buildStormLayers,
  stormConeCaveat,
  caveatText,
  LAYER_META,
  LAYER_BUILDERS,
  STORM_CAVEAT,
  STORM_CONE_CAVEAT_UNATTRIBUTED,
  STORM_CONE_LABEL,
  STORM_SURGE_LABEL,
  STORM_TRACK_LABEL,
  type MapT,
} from './build-layers.js';
import { COLOR_BY_GROUP } from './palette.js';
import type { MapData, StormData } from './types.js';
import enMessages from '../../../messages/en.json';
import roMessages from '../../../messages/ro.json';

const ADVISORY_AT = '2026-07-05T22:00:00Z';

type Messages = typeof enMessages;
function translator(locale: string, messages: unknown): MapT {
  return createTranslator<Messages, 'map'>({
    locale,
    messages: messages as Messages,
    namespace: 'map',
  }) as unknown as MapT;
}

const TRACK: StormData['track'] = [
  [125.5, 12.5],
  [123.4, 13.2],
  [121.2, 14.1],
];
const CONE: StormData['cone'] = [[[120, 13], [123, 13], [123, 15], [120, 15], [120, 13]]];
const SURGE: StormData['surge'] = [[[120.9, 14.5], [121.1, 14.5], [121.1, 14.7], [120.9, 14.5]]];

const STORM: StormData = { track: TRACK, cone: CONE, surge: SURGE, agency: 'pagasa-tcb', advisoryAt: ADVISORY_AT };
const data: MapData = { storm: STORM };

/** A synthetic locale catalog: English everywhere except the storm strings, marked so they are unmistakable. */
const TRANSLATED = {
  ...enMessages,
  map: {
    ...enMessages.map,
    caveat: { ...enMessages.map.caveat, storm: '«storm-layer-caveat»' },
    storm: {
      trackLabel: '«track»',
      coneLabel: '«cone»',
      surgeLabel: '«surge»',
      coneCaveat: '«cone-caveat {agency} {advisoryAt}»',
      coneCaveatUnattributed: '«cone-caveat-unattributed»',
    },
  },
};

function allOff(): Record<LayerId, boolean> {
  return Object.fromEntries(LAYER_IDS.map((id) => [id, false])) as Record<LayerId, boolean>;
}

describe('buildStormLayers — one toggle, three geometries', () => {
  it('is empty-safe when the region has no storm data', () => {
    expect(buildStormLayers(undefined)).toEqual([]);
    expect(buildStormLayers({})).toEqual([]);
  });

  it('emits the track as a PATH and the cone + surge as POLYGONS, all in the `storm` group', () => {
    const layers = buildStormLayers(STORM);
    expect(layers.map((l) => l.id)).toEqual(['storm-track', 'storm-cone', 'storm-surge']);
    expect(layers.map((l) => l.kind)).toEqual(['path', 'polygon', 'polygon']);
    expect(layers.every((l) => l.group === 'storm')).toBe(true);
    expect(layers.every((l) => l.pickable === true)).toBe(true);
    expect(layers[0]?.data[0]?.path).toEqual(TRACK);
    expect(layers[1]?.data[0]?.polygon).toEqual(CONE);
    expect(layers[2]?.data[0]?.polygon).toEqual(SURGE);
  });

  it('distinguishes the three sub-kinds by TOKEN + TEXT, never by three separate colours (T-346)', () => {
    const layers = buildStormLayers(STORM);
    expect(layers.map((l) => l.data[0]?.status)).toEqual(['TRACK', 'CONE', 'SURGE']);
    expect(layers.map((l) => l.data[0]?.label)).toEqual([
      STORM_TRACK_LABEL,
      STORM_CONE_LABEL,
      STORM_SURGE_LABEL,
    ]);
    // Every descriptor resolves to the ONE storm hue — meaning is carried by kind + label, not by colour.
    expect(new Set(layers.map((l) => COLOR_BY_GROUP[l.group])).size).toBe(1);
    for (const layer of layers) expect(layer.data[0]?.label ?? '').not.toBe('');
  });

  it('labels the advisory track and cone as NOT impact areas, and the surge as one', () => {
    expect(STORM_TRACK_LABEL).toContain('not an impact area');
    expect(STORM_CONE_LABEL).toContain('not an impact area');
    expect(STORM_SURGE_LABEL).toContain('impact area');
  });

  it('emits only what the advisory supplies (track-only, cone-only, surge-only bulletins)', () => {
    expect(buildStormLayers({ track: TRACK }).map((l) => l.id)).toEqual(['storm-track']);
    expect(buildStormLayers({ cone: CONE }).map((l) => l.id)).toEqual(['storm-cone']);
    expect(buildStormLayers({ surge: SURGE }).map((l) => l.id)).toEqual(['storm-surge']);
    // An empty track array is no track at all — never an empty path descriptor.
    expect(buildStormLayers({ track: [], surge: SURGE }).map((l) => l.id)).toEqual(['storm-surge']);
  });

  it('carries the standing "BEACON does not model storms" caveat on the track and surge', () => {
    const layers = buildStormLayers(STORM);
    expect(layers[0]?.caveat).toBe(STORM_CAVEAT);
    expect(layers[2]?.caveat).toBe(STORM_CAVEAT);
    expect(STORM_CAVEAT).toBe(LAYER_META.storm.caveat);
  });
});

describe('stormConeCaveat — mandatory uncertainty labeling (FEV-5)', () => {
  it('names the issuing agency and the advisory instant', () => {
    const caveat = stormConeCaveat(STORM);
    expect(caveat).toContain('pagasa-tcb');
    expect(caveat).toContain(ADVISORY_AT);
    expect(caveat).toContain('NOT the extent of hazardous conditions');
  });

  it('is the caveat the cone descriptor actually carries', () => {
    expect(buildStormLayers(STORM)[1]?.caveat).toBe(stormConeCaveat(STORM));
  });

  it('still warns "cone ≠ impact area" when the wire carries no attribution (Art. XVI)', () => {
    for (const partial of [{ cone: CONE }, { cone: CONE, agency: 'x' }, { cone: CONE, advisoryAt: ADVISORY_AT }]) {
      expect(stormConeCaveat(partial)).toBe(STORM_CONE_CAVEAT_UNATTRIBUTED);
      expect(stormConeCaveat(partial)).toContain('NOT the extent of hazardous conditions');
    }
  });

  it('states no BEACON-computed method or uncertainty figure — the cone is ingested, not modelled (§6)', () => {
    expect(stormConeCaveat(STORM)).not.toMatch(/first-order|±/i);
  });
});

describe('storm layer localization (FR-I18N-2)', () => {
  it('renders byte-identical English with and without a translator', () => {
    const withT = buildStormLayers(STORM, translator('en', enMessages));
    const withoutT = buildStormLayers(STORM);
    expect(withT.map((l) => l.data[0]?.label)).toEqual(withoutT.map((l) => l.data[0]?.label));
    expect(withT.map((l) => l.caveat)).toEqual(withoutT.map((l) => l.caveat));
    expect(caveatText(translator('en', enMessages), STORM_CAVEAT)).toBe(STORM_CAVEAT);
  });

  it('renders labels and the cone caveat in the active language, keeping the machine values verbatim', () => {
    // A synthetic catalog rather than a shipped locale: the 13 translated catalogs are topped up centrally,
    // and this test must assert the LOOKUP PATH, not the state of any one translation.
    const t = translator('xx', TRANSLATED);
    const layers = buildStormLayers(STORM, t);
    expect(layers.map((l) => l.data[0]?.label)).toEqual(['«track»', '«cone»', '«surge»']);
    const cone = layers[1]?.caveat ?? '';
    // The issuing source id and the ISO instant are machine values — never localized, always present.
    expect(cone).toBe(`«cone-caveat pagasa-tcb ${ADVISORY_AT}»`);
    expect(caveatText(t, STORM_CAVEAT)).toBe('«storm-layer-caveat»');
    expect(stormConeCaveat({ cone: CONE }, t)).toBe('«cone-caveat-unattributed»');
  });

  it('falls back to the shipped Romanian catalog without leaking a raw key for a translated string', () => {
    // `ro` is a real shipped catalog; whatever it does or does not yet carry for `map.storm.*`, the layer
    // must still produce readable text for every label (the fallback ladder, FR-I18N-2 / FUW-1).
    const t = translator('ro', { ...roMessages, map: { ...enMessages.map, ...roMessages.map } });
    for (const layer of buildStormLayers(STORM, t)) {
      expect(layer.data[0]?.label ?? '', layer.id).not.toMatch(/^map\./);
      expect(layer.caveat ?? '', layer.id).not.toMatch(/^map\./);
    }
  });
});

describe('buildLayers — the storm toggle', () => {
  it('contributes nothing while OFF and every descriptor once ON', () => {
    expect(buildLayers({ layers: allOff(), role: 'PUBLIC' }, data)).toEqual([]);
    const on = buildLayers({ layers: { ...allOff(), storm: true }, role: 'PUBLIC' }, data);
    expect(on.map((l) => l.id)).toEqual(['storm-track', 'storm-cone', 'storm-surge']);
  });

  it('threads the translator through to the storm builder', () => {
    const t = translator('xx', TRANSLATED);
    const on = buildLayers({ layers: { ...allOff(), storm: true }, role: 'PUBLIC' }, data, t);
    expect(on[1]?.caveat).toBe(stormConeCaveat(STORM, t));
    expect(on.map((l) => l.data[0]?.label)).toEqual(['«track»', '«cone»', '«surge»']);
  });

  it('is absent from the default-ON set — storm is opt-in (ADR-032 §4)', async () => {
    const { useUiStore } = await import('../../_lib/store.js');
    const layers = useUiStore.getState().layers;
    expect(layers.storm).toBe(false);
    // …while the two primary hazard layers stay on, so this decision changed nothing else.
    expect(layers.fire).toBe(true);
    expect(layers.flood).toBe(true);
  });
});

describe('exhaustive layer maps cover LAYER_IDS exactly', () => {
  it('has a legend label, a hue and a builder for every layer id — and no orphans', () => {
    const ids = [...LAYER_IDS].sort();
    expect(Object.keys(LAYER_META).sort()).toEqual(ids);
    expect(Object.keys(COLOR_BY_GROUP).sort()).toEqual(ids);
    expect(Object.keys(LAYER_BUILDERS).sort()).toEqual(ids);
  });

  it('gives every layer a non-empty catalog label, so a legend row is never colour-only (T-346)', () => {
    const t = translator('en', enMessages);
    for (const id of LAYER_IDS) {
      expect(LAYER_META[id].label, id).not.toBe('');
      expect(t(`layer.${id}`), id).toBe(LAYER_META[id].label);
    }
  });

  it('gives the storm hue its own distinct RGBA (colour reinforces, it never carries alone)', () => {
    const hues = LAYER_IDS.map((id) => COLOR_BY_GROUP[id].join(','));
    expect(new Set(hues).size).toBe(LAYER_IDS.length);
    expect(hues.filter((h) => h === COLOR_BY_GROUP.storm.join(','))).toHaveLength(1);
  });
});
