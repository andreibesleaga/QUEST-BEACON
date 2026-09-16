'use client';
// BEACON — Damage & needs panel (S3·U2; FR-D4-4, FEV-23, ADR-036 §7, Art. XIII/XIV/XVI). The first surface
// over the tested-but-inert damage-assessment module — and the module's structural verified/unverified
// split travels to the screen INTACT:
//   • one card per triage bucket, in the server's own key order (`byTriageStatus` is keyed by the pipeline's
//     PUBLIC_REPORT_STATUSES — the panel never re-declares that vocabulary);
//   • NO grand total anywhere: a single number silently mixing VERIFIED with UNVERIFIED is exactly the
//     laundering Art. XIII forbids, and the module deliberately never produces one — neither does this JSX;
//   • every non-VERIFIED figure carries the module's own `unverifiedLabel` verbatim, and the module's
//     `caveat` renders under the cards, verbatim.
// All figures are COUNTS off the envelope (Art. XII; aggregate-only — no injury figure, no person,
// Art. XIV; the FR-D6-5 tally is a different lane's surface and is deliberately not rendered here).
// Display-gated by the browser mirror of FEATURE_D4_DAMAGE_REPORTS (off ⇒ null, query never fires).
import type { ReactNode } from 'react';
import { ClipboardList } from 'lucide-react';
import {
  EmptyState,
  ErrorState,
  OriginalLanguageChip,
  Panel,
  ProvenancePopover,
  Skeleton,
} from '../ui/index.js';
import { useDamageReports } from '../../_lib/hooks.js';
import { useT } from '../../_lib/i18n.js';
import type { DamageReportsData } from '../../_lib/types.js';

/** Build-time display gate — `!== 'off'` so an unset mirror keeps the server default (see supplies-panel). */
export const DAMAGE_REPORTS_PANEL_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_D4_DAMAGE_REPORTS !== 'off';

export interface DamageReportsPanelProps {
  /** Override the build-time display gate (tests + a composition root that threads the flag itself). */
  enabled?: boolean | undefined;
  className?: string | undefined;
}

type Assessment = DamageReportsData['assessment'];
type Bucket = Assessment['byTriageStatus'][keyof Assessment['byTriageStatus']];

/** The non-zero unmet-need counts of one bucket, as verbatim `KIND n` tokens (never summed across buckets). */
function NeedTokens({ bucket }: { bucket: Bucket }): ReactNode {
  const t = useT('damageReportsPanel');
  const present = Object.entries(bucket.byNeed).filter(([, count]) => count > 0);
  if (present.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-1 text-[11px] text-fg-muted">
      {t('needs')}
      {present.map(([kind, count]) => (
        <span key={kind} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono tabular-nums">
          {kind} {count}
        </span>
      ))}
    </p>
  );
}

/** One triage bucket card. `status` is the pipeline token, verbatim; non-VERIFIED carries the server label. */
function BucketCard({
  status,
  bucket,
  unverifiedLabel,
}: {
  status: string;
  bucket: Bucket;
  /** The module's own label for every non-VERIFIED figure — rendered verbatim, absent on VERIFIED. */
  unverifiedLabel?: string | undefined;
}): ReactNode {
  const t = useT('damageReportsPanel');
  return (
    <li
      className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-2 text-sm"
      data-testid={`damage-bucket-${status}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-fg">{status}</span>
        <span className="tabular-nums text-xs text-fg-muted">
          {t('entries')} <span className="font-semibold text-fg">{bucket.entries}</span>
        </span>
        <span className="tabular-nums text-xs text-fg-muted">
          {t('sites')} <span className="font-semibold text-fg">{bucket.siteCount}</span>
        </span>
        {bucket.worstSeverity !== undefined ? (
          <span className="text-xs text-fg-muted">
            {t('worstSeverity')} <span className="font-mono text-fg">{bucket.worstSeverity}</span>
          </span>
        ) : null}
      </div>
      <NeedTokens bucket={bucket} />
      {unverifiedLabel !== undefined ? (
        <p
          className="text-[11px] italic text-unverified"
          data-testid={`damage-unverified-${status}`}
        >
          {unverifiedLabel}
          {/* The module's own label, verbatim — English by construction, labelled (Art. XII/XVI). */}
          <OriginalLanguageChip />
        </p>
      ) : null}
    </li>
  );
}

/** True when every bucket is empty — the designed empty state, never a board of zeros with no explanation. */
function isEmpty(assessment: Assessment): boolean {
  return Object.values(assessment.byTriageStatus).every((bucket) => bucket.entries === 0);
}

/** Connected damage & needs panel — fetches via useDamageReports and renders every rung labelled. */
export function DamageReportsPanel({ enabled, className }: DamageReportsPanelProps): ReactNode {
  const t = useT('damageReportsPanel');
  const on = enabled ?? DAMAGE_REPORTS_PANEL_ENABLED;
  const query = useDamageReports(on);
  if (!on) return null;

  let body: ReactNode;
  let actions: ReactNode = null;
  if (query.isPending) {
    body = <Skeleton className="h-32 w-full" />;
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
    // The wire is a claim, not a proof (the F-406 lesson): a 200 with an unexpected data shape must land
    // on the LABELLED error rung, never throw mid-render (Art. XVI — found 2026-08-08 when the COP page
    // test's fallback envelope crashed the whole page tree through an unguarded read in a sibling panel).
    const assessment: DamageReportsData['assessment'] | undefined = env.data?.assessment;
    actions = <ProvenancePopover provenance={env.provenance} label={t('provenance')} />;
    body =
      assessment === undefined ? (
        <ErrorState title={t('unavailable')} onRetry={() => void query.refetch()} />
      ) : isEmpty(assessment) ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          icon={ClipboardList}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {/* The server's own bucket order (the pipeline vocabulary) — never re-sorted, never summed. */}
            {Object.entries(assessment.byTriageStatus).map(([status, bucket]) => (
              <BucketCard
                key={status}
                status={status}
                bucket={bucket}
                unverifiedLabel={status === 'VERIFIED' ? undefined : assessment.unverifiedLabel}
              />
            ))}
          </ul>
          {/* The module's own caveat, verbatim — counts of reports, not a survey (Art. XIII). */}
          <p className="text-xs italic text-fg-muted" data-testid="damage-caveat">
            {assessment.caveat}
            <OriginalLanguageChip />
          </p>
          {env.freshness !== undefined ? (
            <p className="text-xs text-fg-muted" data-testid="damage-freshness">
              {t('asOf', { when: env.freshness })}
            </p>
          ) : null}
        </div>
      );
  }
  return (
    <Panel
      title={t('title')}
      actions={actions}
      className={className}
      data-testid="damage-reports-panel"
    >
      {body}
    </Panel>
  );
}
