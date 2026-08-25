'use client';
// BEACON — Shelter status panel (S3·U1; FR-D4-3, FEV-22, ADR-036 §7, Art. XIV/XVI). The first surface over
// the tested-but-inert shelter-status board module. Everything numeric — per-shelter available/utilization,
// the totals, and especially `availableOpen` (spare space at OPEN shelters only, the number that answers
// "where can people go right now?") — is the MODULE's own output, rendered verbatim (Art. XII; the one
// display transform is ratio→percent, the verifier-queue `pct` precedent). The board's `provenanceClaim` is
// rendered verbatim too: it is the sentence that can only say "live" when the mode IS LIVE (F-35), so this
// panel cannot present the hand-seeded demo shelters as an operational feed. Display-gated by the browser
// mirror of FEATURE_D4_SHELTER_STATUS (off ⇒ null, query never fires); server flag stays authoritative.
import type { ReactNode } from 'react';
import { Home } from 'lucide-react';
import { EmptyState, ErrorState, OriginalLanguageChip, Panel, ProvenancePopover, Skeleton } from '../ui/index.js';
import { useShelterStatus } from '../../_lib/hooks.js';
import { useT } from '../../_lib/i18n.js';
import type { ShelterStatusData } from '../../_lib/types.js';

/** Build-time display gate — `!== 'off'` so an unset mirror keeps the server default (see supplies-panel). */
export const SHELTER_STATUS_PANEL_ENABLED = process.env.NEXT_PUBLIC_FEATURE_D4_SHELTER_STATUS !== 'off';

export interface ShelterStatusPanelProps {
  /** Override the build-time display gate (tests + a composition root that threads the flag itself). */
  enabled?: boolean | undefined;
  className?: string | undefined;
}

/** Round a [0,1] engine ratio to a whole percentage for display (never recomputed — Art. XII rendering only). */
function pct(value: number): number {
  return Math.round(value * 100);
}

/** The board totals as labelled figures; `availableOpen` is the operationally meaningful number. */
function TotalsRow({ totals }: { totals: ShelterStatusData['board']['totals'] }): ReactNode {
  const t = useT('shelterStatusPanel');
  const cells: readonly (readonly [string, string | number])[] = [
    [t('shelters'), totals.shelters],
    [t('capacity'), totals.capacity],
    [t('occupancy'), totals.occupancy],
    [t('availableOpen'), totals.availableOpen],
    [t('utilization'), `${pct(totals.utilization)}%`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3" data-testid="shelter-totals">
      {cells.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <dt className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</dt>
          <dd className="tabular-nums font-semibold text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One shelter row — status token verbatim (domain vocabulary), figures straight off the board. */
function ShelterRow({ row }: { row: ShelterStatusData['board']['rows'][number] }): ReactNode {
  const t = useT('shelterStatusPanel');
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2 text-sm"
      data-testid={`shelter-row-${row.shelterId}`}
    >
      <span className="flex-1 font-mono text-xs text-fg">{row.shelterId}</span>
      <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
        {row.status}
      </span>
      <span className="tabular-nums text-xs text-fg">
        {row.occupancy}/{row.capacity}
      </span>
      <span className="tabular-nums text-xs text-fg-muted">
        {t('available')} {row.available}
      </span>
    </li>
  );
}

/** Connected shelter-status panel — fetches via useShelterStatus and renders every rung labelled. */
export function ShelterStatusPanel({ enabled, className }: ShelterStatusPanelProps): ReactNode {
  const t = useT('shelterStatusPanel');
  const on = enabled ?? SHELTER_STATUS_PANEL_ENABLED;
  const query = useShelterStatus(on);
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
    const board: ShelterStatusData['board'] | undefined = env.data?.board;
    actions = <ProvenancePopover provenance={env.provenance} label={t('provenance')} />;
    body =
      board === undefined ? (
        <ErrorState title={t('unavailable')} onRetry={() => void query.refetch()} />
      ) : board.rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} icon={Home} />
      ) : (
        <div className="flex flex-col gap-3">
          <TotalsRow totals={board.totals} />
          <ul className="flex flex-col gap-2">
            {board.rows.map((row) => (
              <ShelterRow key={row.shelterId} row={row} />
            ))}
          </ul>
          {/* The module's own provenance sentence, verbatim — it says MOCK/CACHED/LIVE honestly (F-35). */}
          <p className="text-xs italic text-fg-muted" data-testid="shelter-provenance-claim">
            {board.provenanceClaim}
            {/* Engine-built provenance sentence — English by construction, labelled (Art. XII/XVI). */}
            <OriginalLanguageChip />
          </p>
        </div>
      );
  }
  return (
    <Panel title={t('title')} actions={actions} className={className} data-testid="shelter-status-panel">
      {body}
    </Panel>
  );
}
