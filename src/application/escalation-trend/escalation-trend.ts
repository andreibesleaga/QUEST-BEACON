// BEACON — escalation-trend classifier use-case (E5·T-217/T-220; FR-4, SPEC §5.7).
// Deterministic least-squares slope with a dead-band (Art. XII — the LLM only narrates the label).
// Too-few samples ⇒ STEADY (insufficient data). Pure & reproducible.
import type { SitRepTrend } from '@/domain/sitrep.js';
import { DEFAULT_TREND_CONFIG, type TrendConfig } from '@/application/shared/config.js';

const SECONDS_PER_HOUR = 3600;

/** One (time, value) sample of the trend signal. `t` is epoch seconds. */
export interface TrendSample {
  readonly t: number;
  readonly value: number;
}

export interface TrendSignal {
  readonly samples: readonly TrendSample[];
}

export interface TrendResult {
  readonly trend: SitRepTrend;
  readonly slopePerHour: number;
  readonly samples: number;
  readonly deadbandPerHour: number;
}

/**
 * Classify the escalation trend over the signal window (SPEC §5.7):
 * slope > +deadband ⇒ ESCALATING, slope < −deadband ⇒ DEESCALATING, else STEADY (dead-band absorbs
 * noise/flat slopes; strict comparison pins the exactly-on-dead-band boundary to STEADY).
 */
export function classifyTrend(signal: TrendSignal, cfg: TrendConfig = DEFAULT_TREND_CONFIG): TrendResult {
  const n = signal.samples.length;
  const deadbandPerHour = cfg.deadbandPerHour;
  if (n < cfg.minSamples) {
    return { trend: 'STEADY', slopePerHour: 0, samples: n, deadbandPerHour };
  }
  const slopePerSecond = leastSquaresSlope(signal.samples);
  const slopePerHour = slopePerSecond * SECONDS_PER_HOUR;
  const trend: SitRepTrend =
    slopePerHour > deadbandPerHour ? 'ESCALATING' : slopePerHour < -deadbandPerHour ? 'DEESCALATING' : 'STEADY';
  return { trend, slopePerHour, samples: n, deadbandPerHour };
}

/** Ordinary least-squares slope of value vs time. Zero-variance time (all equal) ⇒ slope 0. */
function leastSquaresSlope(samples: readonly TrendSample[]): number {
  const n = samples.length;
  let sumT = 0;
  let sumV = 0;
  for (const s of samples) {
    sumT += s.t;
    sumV += s.value;
  }
  const meanT = sumT / n;
  const meanV = sumV / n;
  let num = 0;
  let den = 0;
  for (const s of samples) {
    const dt = s.t - meanT;
    num += dt * (s.value - meanV);
    den += dt * dt;
  }
  return den === 0 ? 0 : num / den;
}
