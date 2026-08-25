// BEACON — wind-glyph label localization (ADR-030; FR-I18N-2/4, FUW-2).
// The wind label is the one map string the ENGINE used to compose in English. It is now assembled at the
// presentation edge from structured fields, which has to satisfy three things at once: it reads in the
// active language, the deterministic FIGURES pass through verbatim (Art. XII — no grouping, no rounding,
// no re-expression), and the UNIT of record stays `km/h` in every locale.
import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import { weatherLabel, buildWeatherLayers, type MapT } from './build-layers.js';
import type { WeatherObservation } from './types.js';
import enMessages from '../../../messages/en.json';
import roMessages from '../../../messages/ro.json';
import arMessages from '../../../messages/ar.json';

const OBSERVED_AT = '2026-07-05T22:00:00Z';

const WEATHER: WeatherObservation = {
  position: [-121.6, 39.7],
  speedKmh: 25,
  directionDeg: 225,
  compass: 'SW',
  observedAt: OBSERVED_AT,
  label: `Wind 25 km/h from SW (225°), obs ${OBSERVED_AT}`,
};

type Messages = typeof enMessages;

function translator(locale: string, messages: unknown): MapT {
  return createTranslator<Messages, 'map'>({
    locale,
    messages: messages as Messages,
    namespace: 'map',
  }) as unknown as MapT;
}

describe('weatherLabel', () => {
  it('falls back to the engine-composed English label when no translator is supplied', () => {
    // This is the CLI / API / provider-less-render path, and the reason the engine still ships `label`.
    expect(weatherLabel(WEATHER)).toBe(WEATHER.label);
  });

  it('reproduces the English label exactly when composed from the catalog', () => {
    // Byte-identity in English is what keeps the existing visual baselines and e2e assertions valid.
    expect(weatherLabel(WEATHER, translator('en', enMessages))).toBe(WEATHER.label);
  });

  it('renders in the active language, with the locale-specific compass abbreviation', () => {
    // Romanian names the western points V/SV/NV, not W/SW/NW — a reader would not recognise "SW".
    const label = weatherLabel(WEATHER, translator('ro', roMessages));
    expect(label).toContain('SV');
    expect(label).not.toContain('SW');
    expect(label).toContain('Vânt');
  });

  it('keeps the deterministic figures verbatim and the unit of record untranslated (FUW-2)', () => {
    for (const [locale, messages] of [['ro', roMessages], ['ar', arMessages]] as const) {
      const label = weatherLabel(WEATHER, translator(locale, messages));
      expect(label, locale).toContain('25'); // never "25,0", never grouped
      expect(label, locale).toContain('225');
      expect(label, locale).toContain('km/h'); // a metre per second is the same everywhere
      expect(label, locale).toContain(OBSERVED_AT);
    }
  });

  it('degrades to the raw token if the engine ever emits a compass value the catalog lacks', () => {
    const odd: WeatherObservation = { ...WEATHER, compass: 'NNW' };
    // Better a recognisable bearing token than a blank or a thrown error on a crisis map (Art. XVI).
    expect(weatherLabel(odd, translator('ro', roMessages))).toContain('NNW');
  });
});

describe('buildWeatherLayers', () => {
  it('uses the same label for the point and its text layer', () => {
    const layers = buildWeatherLayers(WEATHER, translator('ro', roMessages));
    expect(layers).toHaveLength(2);
    const labels = layers.map((l) => (l.data[0] as { label?: string }).label);
    expect(labels[0]).toBe(labels[1]);
    expect(labels[0]).toContain('Vânt');
  });

  it('contributes nothing when there is no observation (never an empty glyph)', () => {
    expect(buildWeatherLayers(undefined, translator('ro', roMessages))).toEqual([]);
  });
});
