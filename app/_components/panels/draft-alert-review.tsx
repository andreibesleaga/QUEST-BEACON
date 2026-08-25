'use client';
// BEACON — DRAFT alert review (E8·T-387; FR-11/EV6/Art.XIII). Lists DRAFT alerts with provenance. A DRAFT is
// NEVER auto-promoted to ACTUAL: the only "approve" here routes to the verifier CAP-emit / human send flow
// (an onApprove callback), it does not itself emit. Headlines render via React escaping — XSS-safe (T-394a).
import type { ReactNode } from 'react';
import { FileWarning } from 'lucide-react';
import { Button, EmptyState, OriginalLanguageChip, Panel, ProvenancePopover } from '../ui/index.js';
import { useT } from '../../_lib/i18n.js';
import type { SourceRef } from '../../_lib/types.js';

export interface DraftAlertItem {
  readonly id: string;
  readonly state: string; // always 'DRAFT' at this stage
  readonly headline: string;
  readonly incidentId?: string | undefined;
  readonly provenance?: readonly SourceRef[] | undefined;
}

export interface DraftAlertReviewProps {
  alerts: readonly DraftAlertItem[];
  /** Routes a DRAFT to the human approval / CAP-emit flow — this panel never emits itself. */
  onApprove?: ((id: string) => void) | undefined;
  /** Message of a FAILED approval (2026-08-25) — previously silent, the button read as stuck (Art. XVI). */
  approveError?: string | undefined;
  className?: string | undefined;
}

export function DraftAlertReview({ alerts, onApprove, approveError, className }: DraftAlertReviewProps): ReactNode {
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
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} icon={FileWarning} />
      ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
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
