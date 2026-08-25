'use client';
// BEACON — SOS intake form (E8·T-375…T-377; FR-5/EV4/WCAG 2.2 §3.3.7/§3.3.8). zod-validated fields with
// INLINE, aria-live, screen-reader-announced errors (no re-entry); an explicit consent checkbox GATES the
// submit (disabled until checked, EV4); the result is always UNVERIFIED + confidence components. Report text
// is rendered via React's default escaping (no dangerouslySetInnerHTML) — XSS-safe (T-394a).
import { useEffect, useId, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { z } from 'zod';
import { Button, UnverifiedBadge } from '../ui/index.js';
import { useSubmitReport } from '../../_lib/hooks.js';
import { useUiStore } from '../../_lib/store.js';
import { useT } from '../../_lib/i18n.js';
import type { GeoPoint, SubmitReportBody } from '../../_lib/types.js';


interface CoordFields {
  readonly lat: string;
  readonly lon: string;
}

/** Parse the optional coordinate pair; returns undefined when either side is blank/invalid (not required). */
function parseLocation(coords: CoordFields): GeoPoint | undefined {
  const lat = Number.parseFloat(coords.lat);
  const lon = Number.parseFloat(coords.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return undefined;
}

/**
 * Build the wire body only from present fields (exactOptionalPropertyTypes-safe).
 *
 * F-360: the coordinate goes on the wire as TOP-LEVEL `lat`/`lng` — the shape the server has always parsed.
 * This used to send a nested `location: {lat, lon}`, which the server never read; because the coordinate is
 * optional, it saw a location-less report and returned **201 Created**, so every SOS coordinate a citizen
 * typed was silently discarded and nothing anywhere reported a problem. `SubmitReportBody` is now DERIVED
 * from that parser (`SubmitReportWireBody`), so this can no longer drift without failing the build.
 *
 * `incidentId` links the SOS to the incident the reporter is looking at, which is what later lets a VERIFIED
 * decision scope a DRAFT CAP alert to it (F-362). Absent when nothing is selected — never a guessed incident.
 */
function buildBody(
  text: string,
  location: GeoPoint | undefined,
  liveViewUrl: string | undefined,
  incidentId: string | undefined,
): SubmitReportBody {
  return {
    consent: true,
    text,
    ...(location !== undefined ? { lat: location.lat, lng: location.lon } : {}),
    ...(incidentId !== undefined && incidentId !== '' ? { incidentId } : {}),
    ...(liveViewUrl !== undefined ? { liveViewUrl } : {}),
  };
}

export interface SosFormProps {
  className?: string | undefined;
  /**
   * Live Views v1.2 (ADR-029). Surfaces the optional "public live stream link" field ONLY when the citizen
   * live-view feature is enabled. Defaults FALSE so the field is hidden and the form is byte-identical to the
   * pre-feature build unless a parent threads an env-derived flag (FEATURE_CITIZEN_STREAM). The server is
   * authoritative regardless — with the feature off, POST /reports REJECTS a liveViewUrl with a 400.
   */
  citizenStreamEnabled?: boolean | undefined;
}

export function SosForm({ className, citizenStreamEnabled = false }: SosFormProps): ReactNode {
  const t = useT('sos');
  // The schema lives INSIDE the component (memoised on the translator) because its validation messages are
  // user-facing copy from the active catalog, not code constants.
  const sosSchema = useMemo(
    () =>
      z.object({
        text: z.string().trim().min(10, t('errors.tooShort')).max(2000, t('errors.tooLong')),
      }),
    [t],
  );
  const [text, setText] = useState('');
  const [coords, setCoords] = useState<CoordFields>({ lat: '', lon: '' });
  const [liveViewUrl, setLiveViewUrl] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const submit = useSubmitReport();

  const errorId = useId();
  const textId = useId();
  const liveViewId = useId();
  // F-362: the incident the reporter is looking at, carried through intake so a later VERIFIED decision can
  // scope its DRAFT CAP alert to a real incident. Undefined when nothing is selected — never guessed.
  const selectedIncidentId = useUiStore((s) => s.selectedIncidentId);

  // Map click → these fields. A citizen reporting from a phone should point at where they are, not read
  // coordinates off a screen and retype them; the fields stay fully editable afterwards (this pre-fills,
  // it never locks). Six decimals ≈ 0.1 m — far finer than any consumer GPS fix, so nothing is lost.
  const pickedPoint = useUiStore((s) => s.pickedPoint);
  useEffect(() => {
    if (pickedPoint === undefined) return;
    const [lon, lat] = pickedPoint;
    setCoords({ lat: lat.toFixed(6), lon: lon.toFixed(6) });
  }, [pickedPoint]);

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const parsed = sosSchema.safeParse({ text });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('errors.generic'));
      return;
    }
    setError(undefined);
    const link = citizenStreamEnabled && liveViewUrl.trim() !== '' ? liveViewUrl.trim() : undefined;
    submit.mutate(buildBody(parsed.data.text, parseLocation(coords), link, selectedIncidentId));
  }

  const result = submit.data?.data;

  return (
    <form onSubmit={onSubmit} noValidate className={className} aria-label="Send an SOS report" data-testid="sos-form">
      <div className="flex flex-col gap-1">
        <label htmlFor={textId} className="text-sm font-medium text-fg">
          What is happening?
        </label>
        <textarea
          id={textId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          aria-invalid={error !== undefined}
          aria-describedby={error !== undefined ? errorId : undefined}
          className="min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
          placeholder="Describe the emergency and any immediate needs."
        />
        {/* aria-live so a screen reader announces the inline error without re-entry (WCAG 2.2 §3.3.7). */}
        <p id={errorId} role="alert" aria-live="assertive" className="min-h-5 text-xs text-alert">
          {error}
        </p>
      </div>

      <fieldset className="mt-2 flex gap-2 border-0 p-0">
        {/* Name the map-click gesture: an affordance nobody is told about does not exist. */}
        <legend className="mb-1 text-xs font-medium text-fg-muted">
          Location (optional — click the map to drop a pin, or type coordinates)
        </legend>
        <input
          aria-label="Latitude"
          inputMode="decimal"
          value={coords.lat}
          onChange={(e) => setCoords((c) => ({ ...c, lat: e.target.value }))}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
          placeholder="Latitude"
        />
        <input
          aria-label="Longitude"
          inputMode="decimal"
          value={coords.lon}
          onChange={(e) => setCoords((c) => ({ ...c, lon: e.target.value }))}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
          placeholder="Longitude"
        />
      </fieldset>

      {/* Live Views v1.2 (ADR-029): optional consent-adjacent public live-stream link, feature-gated. The
          warning is deliberately shown INLINE with the field (consent-adjacent) so the reporter reads it at
          the moment of entry. The link is advisory + permanently "Unofficial" downstream; never fetched here. */}
      {citizenStreamEnabled ? (
        <div className="mt-3 flex flex-col gap-1" data-testid="live-view-field">
          <label htmlFor={liveViewId} className="text-sm font-medium text-fg">
            Live stream link (public) — optional
          </label>
          <input
            id={liveViewId}
            inputMode="url"
            value={liveViewUrl}
            onChange={(e) => setLiveViewUrl(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
            placeholder="https://youtube.com/live/… or twitch.tv/…"
          />
          <p className="text-[11px] text-fg-muted">
            Only link public streams you operate; don&apos;t film identifiable people or private property.
          </p>
        </div>
      ) : null}

      <label className="mt-3 flex items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-[color:var(--color-primary)]"
        />
        <span>
          I consent to sharing this report (and location, if provided) with emergency responders.
        </span>
      </label>

      <Button
        type="submit"
        variant="primary"
        disabled={!consent || submit.isPending}
        className="mt-3 w-full"
        data-testid="sos-submit"
      >
        {submit.isPending ? 'Sending…' : 'Send SOS'}
      </Button>

      {result ? (
        <div
          role="status"
          className="mt-4 flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-fg">Report received</span>
            <UnverifiedBadge />
          </div>
          {result.confidence ? (
            <dl className="flex flex-col gap-1" aria-label="Confidence components">
              {Object.entries(result.confidence).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-xs">
                  <dt className="text-fg-muted">{key}</dt>
                  <dd className="tabular-nums text-fg">{Math.round(value * 100)}%</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
