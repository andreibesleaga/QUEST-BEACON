'use client';
// BEACON — COP Outlook panel (C2.3; ADR-033 §5, FEV-8/FR-PRED-5, Art. XII).
//
// SOURCE: the SitRep path (`GET /incidents/:id/sitrep` → `outlook[]`), which is what
// SPEC-FINAL-VERSION-DELTA §5 specifies — NOT `MapProjectionData.predictions`. ADR-033 §5's original
// sentence named the map wire; that is corrected in the ADR's dated §5 addendum, because
// `ProjectedPrediction.geometry` is required, so `projectMap` SKIPS geometry-less predictions — and
// `ESCALATION`/`IMPACT_OVER_TIME` are geometry-less BY DESIGN (ADR-033 §4.1/§4.2, finding F-77). A panel
// fed by the map wire would therefore omit exactly the two kinds the Outlook exists to show.
//
// The order is the ENGINE's (`rankOutlook`/`compareOutlookItems`): this component renders `outlook` in the
// order it arrives and never sorts, scores, or re-derives anything (Art. XII). Every row shows its method
// and uncertainty, so a likelihood class or an ETA can never appear without the labelling that makes it
// honest (FU-11/FU-12). Class/kind tokens render VERBATIM — they are closed server vocabularies, shown the
// same way the SitRep panel shows `trend` — so no translation can shift what the engine asserted (F-62).
import type { ReactNode } from 'react';
import { TrendingUp } from 'lucide-react';
import { useT } from '../../_lib/i18n.js';
import { OriginalLanguageChip } from '../ui/index.js';
import type { RankedOutlookItem } from '../../_lib/types.js';

export interface OutlookPanelProps {
  /** Engine-ranked outlook rows, in engine order (never re-sorted here). */
  outlook: readonly RankedOutlookItem[];
  className?: string | undefined;
}

/** One ranked row: rank · kind · class · lead time, over its own method/uncertainty caveat. */
function OutlookRow({ item }: { item: RankedOutlookItem }): ReactNode {
  const t = useT('outlook');
  return (
    <li className="flex flex-col gap-1 text-sm" data-testid="outlook-row">
      <div className="flex items-start gap-2">
        <span className="min-w-6 shrink-0 rounded bg-surface-2 px-1.5 text-center font-semibold tabular-nums text-fg">
          {/* rank straight from the engine — deterministic (Art. XII) */}
          {item.rank}
        </span>
        <span className="flex-1 font-mono text-xs text-fg">{item.kind}</span>
        <span className="shrink-0 font-mono text-xs text-fg">
          {item.likelihoodClass ?? t('unclassified')}
        </span>
        <span className="shrink-0 tabular-nums text-fg-muted">
          {item.etaHours === undefined ? t('noEta') : t('eta', { hours: item.etaHours })}
        </span>
      </div>
      {/* The mandatory label of a first-order projection: method + uncertainty, never optional (Art. XIV). */}
      <p className="ps-8 text-xs text-fg-muted">
        {item.method} · {t('uncertainty', { value: item.uncertainty })}
        {/* Engine-built method/uncertainty sentence — English by design (F-62), labelled as such. */}
        <OriginalLanguageChip />
      </p>
    </li>
  );
}

/**
 * The Outlook section. Renders NOTHING when there is no outlook: an incident with no forecastable signal has
 * no Outlook, and an empty "Outlook: none" block on every incident would be noise, not honesty (the absent
 * section is the same choice the storm layer made by shipping inert). Every rung shows it — the outlook is
 * deterministic, so it survives the deterministic-only fallback exactly like `priorities`.
 */
export function OutlookPanel({ outlook, className }: OutlookPanelProps): ReactNode {
  const t = useT('outlook');
  if (outlook.length === 0) return null;
  return (
    <section aria-label={t('sectionLabel')} className={className} data-testid="outlook-panel">
      <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <TrendingUp aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
        {t('title')}
      </h3>
      <ol className="flex flex-col gap-2">
        {outlook.map((item) => (
          <OutlookRow key={item.predictionId} item={item} />
        ))}
      </ol>
    </section>
  );
}
