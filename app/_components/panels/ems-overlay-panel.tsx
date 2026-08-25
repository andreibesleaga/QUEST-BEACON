'use client';
// BEACON — Copernicus EMS overlay panel (S3·U2; FR-D4-5, FEV-24, ADR-027/028 link-only doctrine, Art. XVI).
// The first surface over the tested-but-inert ems-overlay module. "EMS" = Copernicus Emergency Management
// Service (rapid mapping), NOT Emergency Medical Services — see the module header before adding anything
// patient- or transport-shaped here. Three properties, all inherited from the module rather than promised:
//   • ATTRIBUTED + DATED (FEV-24): each product renders its `productionLabel` verbatim — provider, product
//     id and production date are domain invariants, so an unlabelled layer cannot exist;
//   • LINK-ONLY: `viewUrl` opens the producer's own page (target=_blank rel=noopener noreferrer) — BEACON
//     never fetches, rehosts or re-derives the product;
//   • a product produced AFTER the evaluation instant is listed under "Not shown" with its reason, never
//     silently mis-aged (Art. XVI: labelled degradation).
// Display-gated by the browser mirror of FEATURE_D4_EMS_OVERLAY (off ⇒ null, query never fires).
import type { ReactNode } from 'react';
import { ExternalLink, Satellite } from 'lucide-react';
import { EmptyState, ErrorState, OriginalLanguageChip, Panel, ProvenancePopover, Skeleton } from '../ui/index.js';
import { useEmsOverlay } from '../../_lib/hooks.js';
import { useT } from '../../_lib/i18n.js';
import type { EmsOverlayData } from '../../_lib/types.js';

/** Build-time display gate — `!== 'off'` so an unset mirror keeps the server default (see supplies-panel). */
export const EMS_OVERLAY_PANEL_ENABLED = process.env.NEXT_PUBLIC_FEATURE_D4_EMS_OVERLAY !== 'off';

export interface EmsOverlayPanelProps {
  /** Override the build-time display gate (tests + a composition root that threads the flag itself). */
  enabled?: boolean | undefined;
  className?: string | undefined;
}

type Overlay = EmsOverlayData['overlay'];

/** One published product — its mandatory production label, verbatim, and the link-out to the producer. */
function ProductRow({ product }: { product: Overlay['products'][number] }): ReactNode {
  const t = useT('emsOverlayPanel');
  return (
    <li
      className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-2 text-sm"
      data-testid={`ems-product-${product.productId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-fg">{product.productId}</span>
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
          {product.productType}
        </span>
        <span className="text-xs text-fg-muted">{product.areaOfInterest}</span>
      </div>
      {/* The FEV-24 label, assembled by the module from the product's own fields — rendered verbatim. */}
      <p className="text-xs text-fg-muted" data-testid={`ems-label-${product.productId}`}>
        {product.productionLabel}
        <OriginalLanguageChip />
      </p>
      <a
        href={product.viewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-fg underline"
        data-testid={`ems-link-${product.productId}`}
      >
        {t('open')}
        <ExternalLink aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
      </a>
    </li>
  );
}

/** The products the module refused to render, each with its reason token — labelled, never silent. */
function RejectedList({ rejected }: { rejected: Overlay['rejected'] }): ReactNode {
  const t = useT('emsOverlayPanel');
  if (rejected.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="ems-rejected">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{t('notShown')}</h3>
      <ul className="flex flex-col gap-1">
        {rejected.map((r) => (
          <li key={r.productId} className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="font-mono">{r.productId}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">{r.reason}</span>
            <span className="tabular-nums">{r.producedAt}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Connected EMS overlay panel — fetches via useEmsOverlay and renders every rung labelled. */
export function EmsOverlayPanel({ enabled, className }: EmsOverlayPanelProps): ReactNode {
  const t = useT('emsOverlayPanel');
  const on = enabled ?? EMS_OVERLAY_PANEL_ENABLED;
  const query = useEmsOverlay(on);
  if (!on) return null;

  let body: ReactNode;
  let actions: ReactNode = null;
  if (query.isPending) {
    body = <Skeleton className="h-32 w-full" />;
  } else if (query.isError) {
    body = <ErrorState title={t('unavailable')} description={query.error.message} onRetry={() => void query.refetch()} />;
  } else {
    const env = query.data;
    // The wire is a claim, not a proof (the F-406 lesson): a 200 with an unexpected data shape must land
    // on the LABELLED error rung, never throw mid-render (Art. XVI — found 2026-08-08 when the COP page
    // test's fallback envelope crashed the whole page tree through an unguarded read in a sibling panel).
    const overlay: EmsOverlayData['overlay'] | undefined = env.data?.overlay;
    actions = <ProvenancePopover provenance={env.provenance} label={t('provenance')} />;
    body =
      overlay === undefined ? (
        <ErrorState title={t('unavailable')} onRetry={() => void query.refetch()} />
      ) : overlay.products.length === 0 && overlay.rejected.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} icon={Satellite} />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {overlay.products.map((product) => (
              <ProductRow key={product.productId} product={product} />
            ))}
          </ul>
          <RejectedList rejected={overlay.rejected} />
          {/* Every render site shows the distinct provider — licence credits (module contract). */}
          {overlay.attribution.length > 0 ? (
            <p className="flex flex-col gap-0.5 text-[11px] text-fg-muted" data-testid="ems-attribution">
              <span className="font-semibold uppercase tracking-wide">{t('attribution')}</span>
              {overlay.attribution.map((credit) => (
                <span key={credit}>{credit}</span>
              ))}
            </p>
          ) : null}
          {/* The module's own consume-only caveat, verbatim (ADR-027/028). */}
          <p className="text-xs italic text-fg-muted" data-testid="ems-caveat">
            {overlay.caveat}
            <OriginalLanguageChip />
          </p>
          <p className="text-xs text-fg-muted" data-testid="ems-as-of">
            {t('asOf', { when: overlay.asOf })}
          </p>
        </div>
      );
  }
  return (
    <Panel title={t('title')} actions={actions} className={className} data-testid="ems-overlay-panel">
      {body}
    </Panel>
  );
}
