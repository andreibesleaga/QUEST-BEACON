'use client';
// BEACON — Relief supplies panel (S3·U1; FR-D6-2, ADR-035 §4, Art. XIV/XVI). The first surface over the
// tested-but-inert supplies aggregate module: renders the SUPPLY lots GET /supplies serves — an id, a stock
// count in a closed unit vocabulary, and an expiry. Aggregate-only by construction (the wire type derives
// from `SupplyFields`, which cannot carry a donor/payment/recipient key — Layer A), and the panel COMPUTES
// nothing: every figure is a field of the envelope (Art. XII). Display-gated by the browser mirror of
// FEATURE_D6_SUPPLIES (off ⇒ renders null AND the query never fires); the server flag stays authoritative
// (off ⇒ the route 404s). Loading/error/empty are all labelled — never a dead-end (Art. XVI).
import type { ReactNode } from 'react';
import { Package } from 'lucide-react';
import { EmptyState, ErrorState, Panel, ProvenancePopover, Skeleton } from '../ui/index.js';
import { useSupplies } from '../../_lib/hooks.js';
import { useT } from '../../_lib/i18n.js';
import type { SupplyLotView } from '../../_lib/types.js';

/**
 * Build-time display gate — the browser mirror of the server's FEATURE_D6_SUPPLIES. Compared against
 * `'off'` (not `'on'`) because an UNSET mirror must keep the server default (`on`) — the same reasoning as
 * sitrep-panel's EXTERNAL_VIEWS_ENABLED: `=== 'on'` would silently hide the panel in every build that never
 * set the mirror (the F-382 silent-off failure mode from the opposite direction).
 */
export const SUPPLIES_PANEL_ENABLED = process.env.NEXT_PUBLIC_FEATURE_D6_SUPPLIES !== 'off';

export interface SuppliesPanelProps {
  /** Override the build-time display gate (tests + a composition root that threads the flag itself). */
  enabled?: boolean | undefined;
  className?: string | undefined;
}

/** One supply LOT row — stock and expiry, verbatim from the envelope (unit tokens are engine vocabulary). */
function LotRow({ lot }: { lot: SupplyLotView }): ReactNode {
  const t = useT('suppliesPanel');
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2 text-sm"
      data-testid={`supply-${lot.id}`}
    >
      <span className="flex-1 font-mono text-xs text-fg">{lot.id}</span>
      {lot.quantity !== undefined && lot.unit !== undefined ? (
        <span className="tabular-nums font-semibold text-fg">
          {lot.quantity} <span className="font-mono text-xs font-normal text-fg-muted">{lot.unit}</span>
        </span>
      ) : null}
      {lot.expiresAt !== undefined ? (
        <span className="text-xs text-fg-muted" data-testid={`supply-expiry-${lot.id}`}>
          {t('expires', { when: lot.expiresAt })}
        </span>
      ) : null}
    </li>
  );
}

/** Connected relief-supplies panel — fetches via useSupplies and renders every rung labelled. */
export function SuppliesPanel({ enabled, className }: SuppliesPanelProps): ReactNode {
  const t = useT('suppliesPanel');
  const on = enabled ?? SUPPLIES_PANEL_ENABLED;
  // The display gate doubles as the query gate: with the panel off, no request is ever issued (Art. XVI).
  const query = useSupplies(on);
  if (!on) return null;

  let body: ReactNode;
  let actions: ReactNode = null;
  if (query.isPending) {
    body = <Skeleton className="h-24 w-full" />;
  } else if (query.isError) {
    // A 403 (below RESPONDER) lands here too: a labelled unavailable-state, never a silent blank (Art. XVI).
    body = <ErrorState title={t('unavailable')} description={query.error.message} onRetry={() => void query.refetch()} />;
  } else {
    const env = query.data;
    // The wire is a claim, not a proof (the F-406 lesson): a 200 with an unexpected data shape must land
    // on the LABELLED error rung, never throw mid-render (Art. XVI — found 2026-08-08 when the COP page
    // test's fallback envelope crashed the whole page tree through an unguarded read here).
    const supplies: readonly SupplyLotView[] | undefined = env.data?.supplies;
    actions = <ProvenancePopover provenance={env.provenance} label={t('provenance')} />;
    body =
      supplies === undefined ? (
        <ErrorState title={t('unavailable')} onRetry={() => void query.refetch()} />
      ) : supplies.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} icon={Package} />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {supplies.map((lot) => (
              <LotRow key={lot.id} lot={lot} />
            ))}
          </ul>
          {env.freshness !== undefined ? (
            <p className="mt-2 text-xs text-fg-muted" data-testid="supplies-freshness">
              {t('asOf', { when: env.freshness })}
            </p>
          ) : null}
        </>
      );
  }
  return (
    <Panel title={t('title')} actions={actions} className={className} data-testid="supplies-panel">
      {body}
    </Panel>
  );
}
