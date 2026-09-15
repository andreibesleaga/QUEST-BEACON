'use client';
// BEACON — AI SitRep panel (E8·T-371…T-374; FR-4/U2/U3/F2/Art.XII). Renders the cited AI summary + trend,
// a per-field citations renderer (a field with NO citation is a VISIBLE error, F2), and a ranked-priorities
// list whose numbers come STRAIGHT from data.priorities — never computed in the component (Art. XII).
// Deterministic-only degraded rung (data.aiMode === 'deterministic-only') hides the AI narration but KEEPS
// the priorities plus a labelled "deterministic-only" badge. Report/field text renders via React's default
// escaping (no dangerouslySetInnerHTML) — XSS-safe (T-394a).
import type { ReactNode } from 'react';
import { Calculator, ChevronDown, FileWarning, Quote, Sparkles } from 'lucide-react';
import {
  BadgeShell,
  EmptyState,
  ErrorState,
  ExternalViewLinks,
  OriginalLanguageChip,
  Panel,
  ProvenancePopover,
  Skeleton,
} from '../ui/index.js';
import { OutlookPanel } from './outlook-panel.js';
import { useMapData, useSitRep } from '../../_lib/hooks.js';
import { useT } from '../../_lib/i18n.js';
import { useUiStore } from '../../_lib/store.js';
import { positionForIncident } from '../../_lib/incident-position.js';
import type { MapData } from '../map/types.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type { CitationView, SitRepData } from '../../_lib/types.js';

const DETERMINISTIC_ONLY = 'deterministic-only';

/** Per-field grounding (F2): ≥1 citation → source, or a VISIBLE uncited error. */
function FieldCitations({
  field,
  citations,
}: {
  field: string;
  citations: readonly CitationView[];
}): ReactNode {
  const t = useT('sitrep');
  const cites = citations.filter((c) => c.field === field);
  if (cites.length === 0) {
    return (
      <span
        role="alert"
        className="inline-flex items-center gap-1 text-xs font-medium text-alert"
        data-testid="uncited-field"
      >
        <FileWarning aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
        {t('uncited')}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {cites.map((c, i) => (
        <span
          key={`${c.sourceId}-${i}`}
          className="inline-flex items-center gap-1 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted"
        >
          <Quote aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
          <span className="font-mono">{c.sourceId}</span>
        </span>
      ))}
    </span>
  );
}

/** Ranked priorities — rank/score are read verbatim from data (Art. XII: never computed here). */
function PrioritiesList({ priorities }: { priorities: SitRepData['priorities'] }): ReactNode {
  const t = useT('sitrep');
  if (priorities.length === 0) {
    return <p className="text-sm text-fg-muted">{t('noPriorities')}</p>;
  }
  return (
    <ol className="flex flex-col gap-2" aria-label={t('rankedPriorities')}>
      {priorities.map((p) => (
        <li key={`${p.rank}-${p.label}`} className="flex items-start gap-2 text-sm">
          <span className="min-w-6 shrink-0 rounded bg-surface-2 px-1.5 text-center font-semibold tabular-nums text-fg">
            {/* rank straight from the engine — deterministic (Art. XII) */}
            {p.rank}
          </span>
          <span className="flex-1 text-fg">
            {p.label}
            {/* Engine-built ranked label — English by construction (Art. XII), labelled as such. */}
            <OriginalLanguageChip />
          </span>
          {p.detail ? (
            <span className="shrink-0 tabular-nums text-fg-muted">{p.detail}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Ranked-Outlook display gate (C2.3; ADR-033 §5). The Outlook is computed, served and tested end-to-end —
 * `GET /incidents/:id/sitrep` carries `outlook[]` unconditionally — but the COP renders it only when this
 * build-time-inlined flag is on. Rationale, recorded rather than assumed: the section adds ~190 px to the
 * SitRep dock, which measurably changes all four `cop.png` visual baselines plus `cop-rtl.png` (verified by
 * RUNNING Playwright, per finding F-47, not by reasoning), and the feature's remaining baseline-regeneration
 * budget is a single unit that is the orchestrator's to spend. Same seam as `NEXT_PUBLIC_FEATURE_CITIZEN_STREAM`
 * (`app/page.tsx`) and the same "ship inert, cost nothing" precedent as the storm layer. Turning it on is
 * `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL=on` plus one baseline regeneration — no code change.
 */
const OUTLOOK_PANEL_ENABLED = process.env.NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL === 'on';

/**
 * External Views display gate (UNIMPLEMENTED_REGISTER row 25). `FEATURE_EXTERNAL_VIEWS` has shipped since
 * E11 with a documented `off` state that did nothing: no client code read it, so the section below rendered
 * unconditionally and an operator who disabled it still saw it. The server flag now has a validated browser
 * mirror (`NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS`, joined to LIVE_VIEWS_BROWSER_MIRRORED_FLAGS in
 * src/config/index.ts, where an unset mirror INHERITS the server value and an explicit contradiction fails
 * the boot), and this is the consumer that makes the documented state real.
 *
 * Compared against `'off'` rather than `'on'` because an UNSET mirror must keep the server default (`on`):
 * the inheritance that config.ts performs at boot cannot reach an inlined browser constant, so the default
 * has to live on this side of the comparison too. Testing for `=== 'on'` would silently hide the section in
 * every build that simply never set the mirror — the F-382 silent-off failure mode, arriving from the
 * opposite direction.
 */
const EXTERNAL_VIEWS_ENABLED = process.env.NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS !== 'off';

export interface SitRepViewProps {
  data: SitRepData;
  citations: readonly CitationView[];
  /** Override the display gate above (tests + a future composition root that threads the flag itself). */
  showOutlook?: boolean | undefined;
}

/** Presentational SitRep body — prop-driven so it renders identically in tests without a network. */
export function SitRepView({ data, citations, showOutlook }: SitRepViewProps): ReactNode {
  const t = useT('sitrep');
  const deterministicOnly = data.aiMode === DETERMINISTIC_ONLY;
  return (
    <div className="flex flex-col gap-4">
      {deterministicOnly ? (
        <BadgeShell icon={Calculator} className="self-start text-fg-muted">
          <span>{t('deterministicOnly')}</span>
        </BadgeShell>
      ) : null}

      {/* LLM narration only — hidden in the deterministic-only rung (F2/UW3: numbers + citations are retained
          below). Art. VI: model-authored prose is LABELLED as such, and the label is attached to the prose
          itself rather than to the panel, so the badge cannot outlive the paragraph it describes (F-341).
          The deterministic-only rung renders no summary at all, so the two badges are never both shown. */}
      {!deterministicOnly && data.summary ? (
        <div className="flex flex-col items-start gap-1.5">
          <BadgeShell icon={Sparkles} className="text-fg-muted">
            <span>{t('aiGenerated')}</span>
          </BadgeShell>
          <p className="max-w-prose text-sm leading-relaxed text-fg" data-testid="sitrep-summary">
            {data.summary}
          </p>
        </div>
      ) : null}

      {/* Trend is a DETERMINISTIC engine output — it renders in EVERY rung, incl. deterministic-only (F2/Art. XVI). */}
      {data.trend ? (
        <p className="text-sm text-fg-muted">
          {/* The trailing space is layout, not content — it stays in the JSX so the catalog value is clean. */}
          <span className="font-semibold text-fg">{t('trendLabel')} </span>
          {data.trend}
          {/* Deterministic engine trend sentence — stays English, labelled (Art. XII/XVI). */}
          <OriginalLanguageChip />
        </p>
      ) : null}

      {/* Cited fields render in EVERY rung — each carries its per-field citation chip (deterministic-only keeps them). */}
      {data.fields.length > 0 ? (
        <dl className="flex flex-col gap-3">
          {data.fields.map((f) => (
            <div key={f.field} className="flex flex-col gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {f.field}
              </dt>
              {/* Value cell carries the claim AND its per-field citation chips — keeping the <dl>
                  structure valid (each group is only <dt>/<dd>) while citations stay with the claim (F2/WCAG). */}
              <dd className="flex flex-col gap-1 text-sm text-fg">
                {f.claim ? (
                  <span>
                    {f.claim}
                    {/* Engine-built cited fact — English by construction (Art. XII), labelled as such. */}
                    <OriginalLanguageChip />
                  </span>
                ) : null}
                <FieldCitations field={f.field} citations={citations} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {t('priorities')}
        </h3>
        <PrioritiesList priorities={data.priorities} />
      </div>

      {/* Ranked Outlook (ADR-033 §5) — engine-ranked predictions, sourced from THIS response (the SitRep
          path), not from the map wire, which by contract carries only map-plottable predictions (F-77).
          Renders nothing when the incident has no prediction, so an Outlook-less incident looks exactly as
          it did before rather than gaining an empty section; gated by OUTLOOK_PANEL_ENABLED above. */}
      {(showOutlook ?? OUTLOOK_PANEL_ENABLED) ? (
        <OutlookPanel outlook={data.outlook ?? []} />
      ) : null}
    </div>
  );
}

export interface SitRepPanelProps {
  /** Override the store's selected incident (composition/testing). */
  incidentId?: string | undefined;
  /** Override the EXTERNAL_VIEWS_ENABLED build gate (tests + a composition root that threads the flag
   *  itself) — same seam and same reason as `SitRepViewProps.showOutlook`: a build-time inlined constant
   *  is fixed at module load, so the only way to exercise BOTH states in one run is an explicit override. */
  showExternalViews?: boolean | undefined;
  className?: string | undefined;
}

/** Connected SitRep panel — resolves the selected incident, fetches via useSitRep, renders every rung. */
/**
 * WHERE the external deep-links open, and at WHAT framing.
 *
 * Three candidates, ranked, most deliberate first:
 *   1. `pickedPoint` — the operator POINTED at something. An explicit act always wins.
 *   2. `mapView.center` — where the camera is. Ambient, but it is what they are looking at.
 *   3. `positionForIncident` — the first seeded feature of the region. A last resort.
 *
 * Until 2026-09-11 only (1) and (3) existed, so an operator who panned and zoomed — the ordinary way a
 * map is used — got links anchored on a feature they had left behind, at a fixed default scale. Owner
 * report: the COP view "must be kept with all the other sources and external sources ... for all the
 * external links".
 *
 * The zoom always comes from the camera, even when a picked point wins the position: the operator's own
 * framing is still the right framing for a point they chose inside it.
 */
function useExternalViewAnchor(mapData: MapData): {
  position: Position | undefined;
  zoom: number | undefined;
} {
  const pickedPoint = useUiStore((s) => s.pickedPoint);
  const mapView = useUiStore((s) => s.mapView);
  return {
    position: pickedPoint ?? mapView?.center ?? positionForIncident(mapData),
    zoom: mapView?.zoom,
  };
}

export function SitRepPanel({
  incidentId,
  showExternalViews,
  className,
}: SitRepPanelProps): ReactNode {
  const t = useT('sitrep');
  const selected = useUiStore((s) => s.selectedIncidentId);
  const activeRegionId = useUiStore((s) => s.activeRegionId);
  const actorRole = useUiStore((s) => s.actorRole);
  const id = incidentId ?? selected;
  const query = useSitRep(id);
  // External Views (E11/ADR-028, FR-VIEW-1): the incident itself carries no point geometry (it's a
  // fire/flood EVENT, not a coordinate — src/domain/incident.ts), so the deep-link target is a best-effort
  // position read off the region's already-fetched map data (see app/_lib/incident-position.ts). This reuses
  // the SAME query the map view issues (identical queryKey → TanStack Query dedupes, no extra network call).
  // Whether the section renders at all is EXTERNAL_VIEWS_ENABLED below — the flag reaches the browser now.
  const mapData = useMapData(activeRegionId, actorRole);
  // The operator's own map click WINS over the feature scan: if they pointed somewhere, THAT is the
  // "current view" the external deep-links should open on — not the first seeded feature of the region
  // (2026-08-04: links anchored kilometres from where the operator was actually looking). The picked
  // point is cleared on region switch (store.setRegion), so it can never anchor another region's links.
  const { position, zoom } = useExternalViewAnchor(mapData);

  let body: ReactNode;
  let actions: ReactNode = null;

  if (id === undefined) {
    body = <EmptyState title={t('noIncidentTitle')} description={t('noIncidentDescription')} />;
  } else if (query.isPending) {
    body = <Skeleton className="h-40 w-full" />;
  } else if (query.isError) {
    body = (
      <ErrorState
        title={t('unavailable')}
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    const env = query.data;
    actions = <ProvenancePopover provenance={env.provenance} label={t('provenance')} />;
    body = <SitRepView data={env.data} citations={env.citations ?? []} />;
  }

  return (
    <Panel title={t('title')} actions={actions} className={className} data-testid="sitrep-panel">
      {body}
      {(showExternalViews ?? EXTERNAL_VIEWS_ENABLED) && position ? (
        <details className="mt-4 border-t border-line pt-3" data-testid="external-views-section">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-muted [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
            {t('externalViews')}
          </summary>
          <ExternalViewLinks
            position={position}
            {...(zoom !== undefined ? { zoom } : {})}
            className="mt-2"
          />
        </details>
      ) : null}
    </Panel>
  );
}
