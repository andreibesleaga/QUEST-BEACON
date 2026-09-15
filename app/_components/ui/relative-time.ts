// BEACON — deterministic relative-time helper (E8·T-355/T-357). Pure: the caller passes a fixed `now`
// (tests always do) so freshness/provenance rendering is reproducible — never reads the wall clock itself.

/** Coerce a Date | ISO string | epoch-ms into epoch-ms; NaN for unparseable input. */
export function toEpochMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

/** Which tabular unit an age falls into; `unknown` = unparseable input. */
export type RelativeTimeUnit = 'unknown' | 'seconds' | 'minutes' | 'hours' | 'days';

/** The English suffix per unit (s/m/h/d) — kept here so the fallback string below cannot drift. */
const UNIT_SUFFIX: Record<Exclude<RelativeTimeUnit, 'unknown'>, string> = {
  seconds: 's',
  minutes: 'm',
  hours: 'h',
  days: 'd',
};

/**
 * Catalog key per unit (`ui.relativeTime.*`). This is a MODULE-LEVEL constant (no hook here); React render
 * sites translate the pattern with the numeric part supplied as an ICU argument.
 */
export const RELATIVE_TIME_MESSAGE_KEY = {
  unknown: 'relativeTime.unknown',
  seconds: 'relativeTime.seconds',
  minutes: 'relativeTime.minutes',
  hours: 'relativeTime.hours',
  days: 'relativeTime.days',
} as const satisfies Record<RelativeTimeUnit, string>;

/**
 * The unit/value DECISION behind a relative time, split out so a React render site can translate the
 * pattern ("{value}m ago") instead of hard-coding English. Clamps negative (future) deltas to 0.
 */
export function relativeTimeParts(
  fetchedAt: Date | string | number,
  now: Date | number,
): { unit: RelativeTimeUnit; value: number } {
  const then = toEpochMs(fetchedAt);
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (Number.isNaN(then) || Number.isNaN(nowMs)) return { unit: 'unknown', value: 0 };
  const deltaSec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (deltaSec < 60) return { unit: 'seconds', value: deltaSec };
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return { unit: 'minutes', value: min };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { unit: 'hours', value: hr };
  return { unit: 'days', value: Math.floor(hr / 24) };
}

/**
 * Compact, screen-reader-friendly "x ago" string — the ENGLISH form, for non-React consumers and as the
 * fallback the catalog mirrors. Uses tabular units (s/m/h/d) so badges align in a column.
 */
export function formatRelativeTime(fetchedAt: Date | string | number, now: Date | number): string {
  const { unit, value } = relativeTimeParts(fetchedAt, now);
  if (unit === 'unknown') return 'unknown';
  return `${value}${UNIT_SUFFIX[unit]} ago`;
}
