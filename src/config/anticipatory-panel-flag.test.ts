// BEACON — FEATURE_ANTICIPATORY_PANEL + its browser mirror (D7; ADR-034, F-32/F-173/F-240).
//
// In its own file rather than appended to `index.test.ts`, which is a multi-lane hot file this wave
// (F-181/F-241). The invariants pinned here are the ones F-240 was fixed to guarantee, restated for the
// eleventh mirrored flag: an UNSET mirror INHERITS its server flag, an EXPLICIT contradiction refuses to
// boot, and the mirror carries NO default of its own — so turning this feature off is one variable, never
// two that must be kept in agreement by hand.
import { describe, it, expect } from 'vitest';
import { loadConfig } from './index.js';

const parse = (env: Record<string, string | undefined>) => loadConfig(env);

describe('FEATURE_ANTICIPATORY_PANEL — the server flag', () => {
  it('defaults OFF, so the COP renders exactly as it did before this lane (F-194)', () => {
    expect(parse({}).FEATURE_ANTICIPATORY_PANEL).toBe('off');
  });

  it('accepts on/off and refuses anything else at BOOT (a typo may not silently downgrade)', () => {
    expect(parse({ FEATURE_ANTICIPATORY_PANEL: 'on' }).FEATURE_ANTICIPATORY_PANEL).toBe('on');
    expect(() => parse({ FEATURE_ANTICIPATORY_PANEL: 'yes' })).toThrow(/Invalid BEACON configuration/);
  });
});

describe('NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL — the browser mirror (F-240 inheritance rule)', () => {
  it('INHERITS the server flag when unset — turning the panel on is ONE variable, not two', () => {
    expect(parse({}).NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL).toBe('off');
    expect(parse({ FEATURE_ANTICIPATORY_PANEL: 'on' }).NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL).toBe('on');
  });

  it('carries NO independent default: it never disagrees with the server flag by simply being unset', () => {
    // The exact trap F-240 closed. If this mirror ever regains a `.default(...)`, the assertion below flips
    // to the stale default and this test fails — before an operator meets it at startup during a demo.
    for (const value of ['off', 'on'] as const) {
      const cfg = parse({ FEATURE_ANTICIPATORY_PANEL: value });
      expect(cfg.NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL).toBe(cfg.FEATURE_ANTICIPATORY_PANEL);
    }
  });

  it('accepts an EXPLICIT agreement (the operator restated it; that is not a contradiction)', () => {
    const cfg = parse({ FEATURE_ANTICIPATORY_PANEL: 'on', NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL: 'on' });
    expect(cfg.NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL).toBe('on');
  });

  it('REFUSES TO BOOT on an explicit contradiction, naming the offending variable', () => {
    expect(() => parse({ FEATURE_ANTICIPATORY_PANEL: 'off', NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL: 'on' })).toThrow(
      /NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL must equal FEATURE_ANTICIPATORY_PANEL/,
    );
    expect(() => parse({ FEATURE_ANTICIPATORY_PANEL: 'on', NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL: 'off' })).toThrow(
      /the browser mirror agrees with the server flag; the server flag is authoritative/,
    );
  });

  it('is covered by the SAME parity loop as the ten D4/D6 mirrors (one list, not two mechanisms)', () => {
    // A multi-flag misconfiguration must name every offender, including this one — which only holds if the
    // D2 flag really was composed into the single mirrored-flag list rather than given its own bespoke check.
    let message = '';
    try {
      parse({
        FEATURE_D6_SUPPLIES: 'off',
        NEXT_PUBLIC_FEATURE_D6_SUPPLIES: 'on',
        FEATURE_ANTICIPATORY_PANEL: 'off',
        NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL: 'on',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/NEXT_PUBLIC_FEATURE_D6_SUPPLIES/);
    expect(message).toMatch(/NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL/);
  });
});
