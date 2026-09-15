'use client';
// BEACON — DRAFT alert review (E8·T-387; FR-11/EV6/Art.XIII). Lists DRAFT alerts with provenance. A DRAFT is
// NEVER auto-promoted to ACTUAL: the only "approve" here routes to the verifier CAP-emit / human send flow
// (an onApprove callback), it does not itself emit. Headlines render via React escaping — XSS-safe (T-394a).
import type { ReactNode } from 'react';
import { FileWarning } from 'lucide-react';
import { Button, EmptyState, OriginalLanguageChip, Panel, ProvenancePopover } from '../ui/index.js';
import { useT } from '../../_lib/i18n.js';
import type { ForecastEvidence, SourceRef } from '../../_lib/types.js';

export interface DraftAlertItem {
  readonly id: string;
  readonly state: string; // always 'DRAFT' at this stage
  readonly headline: string;
  readonly incidentId?: string | undefined;
  readonly provenance?: readonly SourceRef[] | undefined;
  /**
   * WP A8 / finding F-301 — the evidence an ANTICIPATORY DRAFT rests on, exactly as `GET /alerts` served it.
   * Absent for an observed-rule DRAFT, and the block below then renders nothing at all: no placeholder, no
   * zero, no dash (Art. XVI — an unavailable figure is labelled unavailable, never filled in).
   */
  readonly forecast?: ForecastEvidence | undefined;
}

export interface DraftAlertReviewProps {
  alerts: readonly DraftAlertItem[];
  /** Routes a DRAFT to the human approval / CAP-emit flow — this panel never emits itself. */
  onApprove?: ((id: string) => void) | undefined;
  /** Message of a FAILED approval (2026-08-25) — previously silent, the button read as stuck (Art. XVI). */
  approveError?: string | undefined;
  className?: string | undefined;
}

/** A closed engine/source token rendered verbatim — never translated (F-62), same idiom as the EAP panel. */
function Token({ value }: { value: string }): ReactNode {
  return <span className="font-mono text-xs text-fg">{value}</span>;
}

/**
 * WHY this DRAFT exists and HOW FAR AHEAD (WP A8 / F-301). THIS BLOCK COMPUTES NOTHING: every figure is a
 * field the server already served on the row — the lead time and expected crossing from the threshold
 * engine, the class + raw value + method from the shared C1 likelihood classifier. There is no arithmetic
 * and no comparison here, and no part of it asks an AI anything, so it renders identically with AI off.
 *
 * The method and uncertainty strings are the payload's OWN labels, rendered verbatim rather than
 * paraphrased — the predictions law wants what BEACON did and what it does not claim, in its own words.
 *
 * The uncertainty sits OUTSIDE the `<dl>` deliberately: a `<p>` as a direct child of a definition list is a
 * SERIOUS axe violation (`definition-list`), the same trap the anticipatory panel documents.
 */
function ForecastEvidenceBlock({ forecast }: { forecast: ForecastEvidence }): ReactNode {
  const t = useT('draftAlerts');
  return (
    <div
      className="flex flex-col gap-1 border-s-2 border-line ps-2"
      data-testid="draft-alert-forecast"
    >
      <dl className="flex flex-col gap-1 text-xs" aria-label={t('forecastHeading')}>
        <div className="flex flex-col">
          <dt className="text-fg-muted">{t('forecastCategory')}</dt>
          <dd className="text-fg">
            <Token value={forecast.forecastCategory} />
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-fg-muted">{t('forecastLeadTimeLabel')}</dt>
          <dd className="tabular-nums text-fg" data-testid="draft-alert-lead-time">
            {t('forecastLeadTime', { hours: forecast.leadTimeHours })}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-fg-muted">{t('forecastCrossing')}</dt>
          <dd className="text-fg">
            <Token value={forecast.expectedCrossingAt} /> ·{' '}
            <Token value={forecast.forecastIssuedAt} />
          </dd>
        </div>
        {forecast.likelihoodClass === undefined ? null : (
          <div className="flex flex-col">
            <dt className="text-fg-muted">{t('forecastLikelihood')}</dt>
            {/* The class NEVER travels without the source value that produced it and the classifier's own
                method string, verbatim (FU-11) — never a UI paraphrase of what the classifier did. */}
            <dd className="text-fg" data-testid="draft-alert-likelihood">
              <Token value={forecast.likelihoodClass} /> ·{' '}
              <Token value={forecast.likelihoodSourceField ?? ''} />{' '}
              <Token value={String(forecast.likelihoodRawValue ?? '')} /> —{' '}
              {forecast.likelihoodMethod}
            </dd>
          </div>
        )}
      </dl>
      <p className="text-xs text-fg-muted">
        {forecast.method}. {forecast.uncertainty}
        <OriginalLanguageChip />
      </p>
    </div>
  );
}

export function DraftAlertReview({
  alerts,
  onApprove,
  approveError,
  className,
}: DraftAlertReviewProps): ReactNode {
  const t = useT('draftAlerts');
  return (
    <Panel title={t('title')} className={className} data-testid="draft-alert-review">
      {approveError !== undefined ? (
        <p role="alert" data-testid="draft-approve-error" className="mb-2 text-xs text-alert">
          {t('approveFailed')} {approveError}
          <OriginalLanguageChip />
        </p>
      ) : null}
      {alerts.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          icon={FileWarning}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="flex-1 text-sm font-medium text-fg">
                  {a.headline}
                  {/* Engine tokens (severity/category/incident id) — English by design, labelled. */}
                  <OriginalLanguageChip />
                </p>
                <span className="shrink-0 rounded border border-line px-2 py-0.5 text-xs font-semibold text-fg-muted">
                  {a.state}
                </span>
              </div>
              {a.forecast === undefined ? null : <ForecastEvidenceBlock forecast={a.forecast} />}
              <div className="flex items-center justify-between gap-2">
                {a.provenance && a.provenance.length > 0 ? (
                  <ProvenancePopover provenance={a.provenance} label={t('provenance')} />
                ) : (
                  <span className="text-xs text-fg-muted">{t('noProvenance')}</span>
                )}
                {onApprove ? (
                  <Button size="sm" variant="outline" onClick={() => onApprove(a.id)}>
                    {t('reviewApprove')}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
