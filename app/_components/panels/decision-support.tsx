'use client';
// BEACON — Decision support (E8·T-388; FR-13/U3/EV3/Art.XII). Makes the deterministic → AI → human keystone
// VISIBLE: the deterministic figures are shown BESIDE the cited AI narration, and a human-approve control is
// the only path forward. Figures come from the engine (never the LLM); the narration is grounded by citations.
import type { ReactNode } from 'react';
import { BadgeShell, Button, OriginalLanguageChip } from '../ui/index.js';
import { Calculator, CircleCheck } from 'lucide-react';
import { useT } from '../../_lib/i18n.js';
import type { CitationView } from '../../_lib/types.js';

export interface DecisionFigure {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string | undefined;
}

export interface DecisionSupportProps {
  /** Deterministic engine figures (Turf/SQL) — the source of truth beside the narration. */
  figures: readonly DecisionFigure[];
  /** Cited AI narration explaining the figures (never inventing them). */
  narration?: string | undefined;
  citations?: readonly CitationView[] | undefined;
  approved?: boolean | undefined;
  onApprove?: (() => void) | undefined;
  /**
   * Message of a FAILED approval (2026-08-25). Until now a rejected POST /alerts/:id/approve was
   * completely silent — the button just "did nothing" (e.g. when the one seeded DRAFT was already
   * promoted by an earlier session, every further click 4xx'd invisibly and read as a stuck control).
   * Art. XVI: a dead-end must be labelled.
   */
  approveError?: string | undefined;
  /**
   * WHY approval is unavailable when `onApprove` is undefined ("no draft alert awaiting approval",
   * "sign in as VERIFIER/EM"). Art. XVI: a disabled keystone control must SAY why — until 2026-08-05 the
   * page never passed `onApprove` at all and this button read as broken HITL instead of enforced HITL.
   */
  unavailableReason?: string | undefined;
  className?: string | undefined;
}

export function DecisionSupport({
  figures,
  narration,
  citations,
  approved,
  onApprove,
  approveError,
  unavailableReason,
  className,
}: DecisionSupportProps): ReactNode {
  const t = useT('decision');
  return (
    <section aria-label={t('sectionLabel')} className={className}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            <Calculator aria-hidden="true" className="size-3.5" strokeWidth={2} /> {t('figures')}
          </h3>
          <dl className="flex flex-col gap-2" aria-label={t('figures')}>
            {figures.map((f) => (
              <div key={f.label} className="flex items-center justify-between gap-2 text-sm">
                <dt className="text-fg-muted">
                  {f.label}
                  {/* Engine-derived figure label — English by construction, labelled (Art. XII). */}
                  <OriginalLanguageChip />
                </dt>
                <dd className="tabular-nums font-medium text-fg">
                  {f.value}
                  {f.unit ? <span className="ms-1 text-fg-muted">{f.unit}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('narration')}
          </h3>
          {narration ? (
            <p className="max-w-prose text-sm leading-relaxed text-fg">{narration}</p>
          ) : (
            <p className="text-sm text-fg-muted">{t('noNarration')}</p>
          )}
          {citations && citations.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label={t('citations')}>
              {citations.map((c, i) => (
                <li
                  key={`${c.sourceId}-${i}`}
                  className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg-muted"
                >
                  {c.sourceId}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
        {approved ? (
          <BadgeShell icon={CircleCheck} className="text-ok">
            <span>{t('approved')}</span>
          </BadgeShell>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={onApprove}
            disabled={onApprove === undefined}
          >
            {t('approve')}
          </Button>
        )}
        <span className="text-xs text-fg-muted">
          {t('humanApprovalRequired')}
          {onApprove === undefined && !approved && unavailableReason !== undefined ? (
            <span data-testid="approve-unavailable-reason"> {unavailableReason}</span>
          ) : null}
        </span>
      </div>
      {approveError !== undefined && !approved ? (
        <p role="alert" data-testid="approve-error" className="mt-2 text-xs text-alert">
          {t('approveFailed')} {approveError}
          <OriginalLanguageChip />
        </p>
      ) : null}
    </section>
  );
}
