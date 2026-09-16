import { describe, it, expect } from 'vitest';
import { classifyTrend, type TrendSample } from './escalation-trend.js';
import { DEFAULT_TREND_CONFIG } from '@/application/shared/config.js';

function series(values: number[], stepSec = 600): TrendSample[] {
  return values.map((value, i) => ({ t: i * stepSec, value }));
}

describe('classifyTrend', () => {
  it('returns STEADY with too few samples (insufficient data)', () => {
    const r = classifyTrend({ samples: series([1, 5]) });
    expect(r.trend).toBe('STEADY');
    expect(r.slopePerHour).toBe(0);
    expect(r.samples).toBe(2);
  });

  it('classifies a rising series as ESCALATING', () => {
    const r = classifyTrend({ samples: series([1, 2, 3, 4, 5]) });
    expect(r.trend).toBe('ESCALATING');
    expect(r.slopePerHour).toBeGreaterThan(DEFAULT_TREND_CONFIG.deadbandPerHour);
  });

  it('classifies a falling series as DEESCALATING', () => {
    const r = classifyTrend({ samples: series([5, 4, 3, 2, 1]) });
    expect(r.trend).toBe('DEESCALATING');
  });

  it('reads a flat-but-noisy series as STEADY (dead-band absorbs noise)', () => {
    const r = classifyTrend({ samples: series([3, 3.1, 2.9, 3.05, 2.95]) });
    expect(r.trend).toBe('STEADY');
  });

  it('pins the exactly-on-dead-band boundary to STEADY (strict comparison)', () => {
    // craft a slope of exactly deadband units/hour: value increments give slope = deadband/hour.
    const cfg = { minSamples: 3, deadbandPerHour: 1 };
    // t in seconds; want slope_per_hour == 1 → slope_per_sec == 1/3600. Over samples t=0,3600,7200s
    const samples: TrendSample[] = [
      { t: 0, value: 0 },
      { t: 3600, value: 1 },
      { t: 7200, value: 2 },
    ];
    const r = classifyTrend({ samples }, cfg);
    expect(r.slopePerHour).toBeCloseTo(1, 9);
    expect(r.trend).toBe('STEADY');
  });

  it('treats all-equal timestamps (zero time variance) as slope 0 / STEADY', () => {
    const samples: TrendSample[] = [
      { t: 100, value: 1 },
      { t: 100, value: 9 },
      { t: 100, value: 5 },
    ];
    expect(classifyTrend({ samples }).trend).toBe('STEADY');
  });

  it('is sign-stable under positive scaling of the signal (property)', () => {
    const base = series([1, 3, 2, 5, 8]);
    const scaled = base.map((s) => ({ t: s.t, value: s.value * 7 }));
    const a = classifyTrend({ samples: base });
    const b = classifyTrend({ samples: scaled });
    expect(Math.sign(a.slopePerHour)).toBe(Math.sign(b.slopePerHour));
    expect(a.trend).not.toBe('DEESCALATING');
  });
});
