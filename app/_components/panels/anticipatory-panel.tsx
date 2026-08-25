'use client';
// BEACON — COP Anticipatory Action panel (D7; ADR-034 §1…§6, FR-AA-1…FR-AA-4, Art. XII/XIII/XVI).
//
// The first surface over lane D2's trigger-evaluation engine, which was fully tested and completely
// unreachable from the running app (the F-81/F-152 "a feature with no on-camera moment" class).
//
// ART. XII — THE PANEL COMPUTES NOTHING. Every figure below is a field of the engine's own output:
// `membersOverThreshold`/`memberTotal`/`threshold` come from `TriggerEvaluation.evidence`, the gate numbers
// from the protocol's `EapTrigger` (via the domain's `stageTrigger`), the likelihood class and its method
// string from `TriggerEvaluation.likelihood`, the lead time from the forecast file's own statement, and
// whether a stage fired from `TriggerState.firedStages`. There is no arithmetic and no comparison in this
// file. The LLM contributes nothing to this path — it renders identically with AI off, because no part of
// it ever asks an AI anything.
//
// LABELLING (the project's standing rule for predictions, plus F-34's honesty requirement). Each cycle
// shows the METHOD (the classifier's own `method` string, verbatim), the INPUTS (the k-of-N member count,
// the threshold, the unit, the forecast version and its issue instant) and the UNCERTAINTY (the member
// share IS the spread statement, carried with `ENSEMBLE_MEMBER_COUNT_LABEL`, which says in the evidence
// itself that it is model spread and NOT a chance of occurrence). The source tier renders verbatim as
// `FIXTURE`/`CACHED` — `TriggerSourceTier` has no `LIVE` member, so this panel cannot claim live data.
//
// ART. XIII — THERE IS NO ACTION HERE, DELIBERATELY. The panel exposes no button, no form and no mutation:
// it renders suggestions, the roles that must approve them, and the governance records the cycle would
// append. That is not an oversight to be filled in later — an "approve" control on a surface fed by a
// recorded fixture would be theatre, and the constitutional requirement is that no panel offer a one-click
// path to a public emission. The engine backing it holds no port and is type-asserted to produce nothing
// assignable to `EmittableAlert`, so the guarantee is structural rather than a property of this markup.
//
// COLOUR IS NEVER THE ONLY CARRIER (WCAG 1.4.1): fired/not-fired differ by ICON SHAPE and by TEXT as well
// as by token colour, using the same `BadgeShell` contract every other BEACON badge uses.
//
// GATING. `NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL` (default off, inheriting `FEATURE_ANTICIPATORY_PANEL`
// through the EnvSchema transform) — the same build-time seam as `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL` and
// `NEXT_PUBLIC_FEATURE_CITIZEN_STREAM`. Off ⇒ this component and the tab that hosts it render nothing at
// all, so the COP's visual baselines are untouched (F-194: zero regenerations remain).
import { useMemo, type ReactNode } from 'react';
import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  FlaskConical,
  Gavel,
  ListChecks,
  OctagonX,
  ScrollText,
  Siren,
} from 'lucide-react';
import { BadgeShell, EmptyState } from '../ui/index.js';
import { useT } from '../../_lib/i18n.js';
import {
  buildAnticipatoryView,
  type AnticipatoryCycleView,
  type AnticipatoryStageRow,
  type AnticipatoryView,
} from '../../_lib/anticipatory.js';

/**
 * Build-time display gate. Inlined by Next from the browser mirror of `FEATURE_ANTICIPATORY_PANEL`; an
 * unset mirror INHERITS the server flag in `EnvSchema`'s transform (F-240), so an operator turns this
 * feature off with ONE variable and never with two that must agree. Exported so the COP page gates the tab
 * TRIGGER from the same constant — one gate, read twice, rather than two flags that could disagree.
 */
export const ANTICIPATORY_PANEL_ENABLED = process.env.NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL === 'on';

export interface AnticipatoryPanelProps {
  /** Active COP region; selects the shipped protocol whose scope names it (never another region's). */
  regionId: string;
  /** Test/story override for the engine output. Omitted in the app: the panel builds it from the engine. */
  view?: AnticipatoryView | undefined;
  /** Display-gate override for tests. Omitted in the app: the build-time flag above decides. */
  enabled?: boolean | undefined;
  className?: string | undefined;
}

/** A token rendered verbatim — a closed engine vocabulary, never translated (F-62). */
function Token({ value }: { value: string }): ReactNode {
  return <span className="font-mono text-xs text-fg">{value}</span>;
}

/** One rung of the ladder: its pre-agreed gate, and whether the ENGINE recorded it as fired. */
function StageRow({ row }: { row: AnticipatoryStageRow }): ReactNode {
  const t = useT('anticipatory');
  const { trigger } = row;
  return (
    <li className="flex flex-col gap-1 border-s-2 border-line ps-2" data-testid="anticipatory-stage">
      <div className="flex flex-wrap items-center gap-2">
        <Token value={row.stage} />
        {/* Shape (filled check vs dashed ring) + TEXT + colour — colour is never the only carrier. */}
        {row.fired ? (
          <BadgeShell icon={CircleCheck} className="text-ok">
            <span>{t('fired')}</span>
          </BadgeShell>
        ) : (
          <BadgeShell icon={CircleDashed} className="text-fg-muted">
            <span>{t('notFired')}</span>
          </BadgeShell>
        )}
      </div>
      <p className="text-xs text-fg-muted">
        {t('stageGate', {
          fraction: trigger.minMembersFraction,
          threshold: trigger.threshold,
          unit: trigger.unit,
          klass: trigger.minLikelihoodClass,
          hours: trigger.leadTimeHours,
        })}
      </p>
    </li>
  );
}

/** One evaluation cycle: what the engine decided, on what evidence, against which ladder. */
function CycleCard({ cycle, index, total }: { cycle: AnticipatoryCycleView; index: number; total: number }): ReactNode {
  const t = useT('anticipatory');
  const { evaluation } = cycle;
  const evidence = evaluation.evidence;
  return (
    <li className="flex flex-col gap-2 rounded border border-line bg-surface-2 p-2" data-testid="anticipatory-cycle">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {t('cycleHeading', { index: index + 1, total })}
        </h4>
        <Token value={`${evaluation.from} → ${evaluation.to}`} />
        <Token value={evaluation.reason} />
      </div>

      {evidence === undefined ? null : (
        <>
        <dl className="flex flex-col gap-1 text-xs" aria-label={t('methodHeading')}>
          {evidence.kind === 'ENSEMBLE_MEMBER_COUNT' ? (
            <div className="flex flex-col">
              <dt className="text-fg-muted">{t('inputs')}</dt>
              <dd className="tabular-nums text-fg" data-testid="anticipatory-members">
                {t('members', {
                  over: evidence.membersOverThreshold,
                  total: evidence.memberTotal,
                  threshold: evidence.threshold,
                  unit: evidence.unit,
                })}
              </dd>
            </div>
          ) : (
            <div className="flex flex-col">
              <dt className="text-fg-muted">{t('inputs')}</dt>
              <dd className="tabular-nums text-fg">{evidence.probability}</dd>
            </div>
          )}
          <div className="flex flex-col">
            <dt className="text-fg-muted">{t('leadTimeLabel')}</dt>
            <dd className="tabular-nums text-fg" data-testid="anticipatory-lead-time">
              {t('leadTime', { hours: evidence.leadTimeHours })}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-fg-muted">{t('vintage')}</dt>
            <dd className="text-fg">
              <Token value={evidence.forecastVersion} /> · <Token value={evidence.issuedAt} />
            </dd>
          </div>
          {evaluation.likelihood === undefined ? null : (
            <div className="flex flex-col">
              <dt className="text-fg-muted">{t('methodLabel')}</dt>
              {/* The classifier's OWN method string, verbatim — never a UI paraphrase of what it did. */}
              <dd className="text-fg">
                <Token value={evaluation.likelihood.likelihoodClass} /> — {evaluation.likelihood.method}
              </dd>
            </div>
          )}
        </dl>
        {/* The evidence's own honesty label: what the share is, what it is not, and that BEACON holds no
            live ensemble feed. It comes from a domain constant, so a fixture cannot relabel itself.
            OUTSIDE the <dl> deliberately: a `<p>` as a direct child of a definition list is a SERIOUS axe
            violation (`definition-list` / `only-dlitems`) — caught by this lane's own axe spec running in a
            real browser, which is exactly the kind of defect that reasoning about markup does not find. */}
        <p className="text-xs text-fg-muted">{evidence.label}</p>
        </>
      )}

      <ol className="flex flex-col gap-2" aria-label={t('ladderHeading')}>
        {cycle.stages.map((row) => (
          <StageRow key={row.stage} row={row} />
        ))}
      </ol>

      <p className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
        <ScrollText aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
        {t('ledgerHeading')}
        {cycle.ledger.map((entry, i) => (
          <Token key={`${entry.action}-${i}`} value={entry.action} />
        ))}
      </p>
    </li>
  );
}

/** Pre-agreed actions, with the ones the LATEST cycle suggested marked. Suggestions only — never a task. */
function ActionList({ view }: { view: Extract<AnticipatoryView, { kind: 'EVALUATED' }> }): ReactNode {
  const t = useT('anticipatory');
  const latest = view.cycles[view.cycles.length - 1];
  const suggested = latest?.evaluation.suggestedActionIds ?? [];
  return (
    <section aria-label={t('actionsHeading')}>
      <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <ListChecks aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} /> {t('actionsHeading')}
      </h4>
      <ul className="flex flex-col gap-1">
        {view.eap.actions.map((action) => (
          <li key={action.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="anticipatory-action">
            <Token value={action.kind} />
            <span className="flex-1 text-fg">{action.label}</span>
            {suggested.includes(action.id) ? (
              <BadgeShell icon={Siren} className="text-warn-strong">
                <span>{t('suggested')}</span>
              </BadgeShell>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Who must approve, and the standing statement that this surface cannot act (Art. XIII). */
function ApprovalBlock({ view }: { view: Extract<AnticipatoryView, { kind: 'EVALUATED' }> }): ReactNode {
  const t = useT('anticipatory');
  const latest = view.cycles[view.cycles.length - 1];
  const approval = latest?.approval;
  return (
    <section aria-label={t('approvalHeading')} className="flex flex-col gap-1 border-t border-line pt-2">
      <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <Gavel aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} /> {t('approvalHeading')}
      </h4>
      {approval?.state === 'PENDING' ? (
        <p className="text-sm text-fg" data-testid="anticipatory-approval">
          {t('pending', { roles: approval.responsibleRoles.join(', ') })}
        </p>
      ) : null}
      <p className="text-xs text-fg-muted">{t('noEmission')}</p>
      <p className="flex items-center gap-1 text-xs text-fg-muted">
        <OctagonX aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
        {t('stopMechanism', { hours: view.eap.stop.maxDurationHours, role: view.eap.stop.authorizerRole })}
      </p>
    </section>
  );
}

const UNAVAILABLE_COPY = {
  NO_PROTOCOL_FOR_REGION: ['noProtocolTitle', 'noProtocolBody'],
  NO_RECORDED_FORECAST: ['noForecastTitle', 'noForecastBody'],
  ENGINE_REFUSED: ['engineRefusedTitle', 'engineRefusedBody'],
} as const;

/** A labelled "why there is nothing here" — never a blank board (Art. XVI). */
function Unavailable({ view }: { view: Extract<AnticipatoryView, { kind: 'UNAVAILABLE' }> }): ReactNode {
  const t = useT('anticipatory');
  const [title, body] = UNAVAILABLE_COPY[view.reason];
  return (
    <section aria-label={t('sectionLabel')} data-testid="anticipatory-panel">
      <EmptyState
        icon={CalendarClock}
        title={t(title)}
        description={view.detail === undefined ? t(body) : `${t(body)} — ${view.detail}`}
      />
    </section>
  );
}

/**
 * The Anticipatory Action panel. Renders `null` when the display gate is off, which is what keeps the
 * default COP byte-identical; when on, it renders the engine's replay of the shipped recorded forecast
 * runs, or a labelled reason why there is none.
 */
export function AnticipatoryPanel({ regionId, view, enabled, className }: AnticipatoryPanelProps): ReactNode {
  const t = useT('anticipatory');
  const built = useMemo(() => view ?? buildAnticipatoryView(regionId), [view, regionId]);
  if (!(enabled ?? ANTICIPATORY_PANEL_ENABLED)) return null;
  if (built.kind === 'UNAVAILABLE') return <Unavailable view={built} />;
  return (
    <section aria-label={t('sectionLabel')} className={className} data-testid="anticipatory-panel">
      <header className="mb-2 flex flex-col gap-1">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
          {built.eap.label}
          {/* The protocol's own status. There is no ENDORSED value in the domain, so an illustrative
              protocol cannot render as an endorsed one. */}
          <Token value={built.eap.status} />
          <Token value={built.eap.hazard} />
        </h3>
        {/* The FILE's own provenance statement, verbatim: what it is and who has NOT endorsed it. */}
        <p className="text-xs text-fg-muted">{built.eap.provenance}</p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <BadgeShell icon={FlaskConical} className="text-unverified">
            {/* The tier as the engine typed it. There is no LIVE tier to render (F-34). */}
            <span>{built.cycles[0]?.evaluation.evidence?.sourceTier ?? ''}</span>
          </BadgeShell>
          <span data-testid="anticipatory-replay-note">{t('replay', { lag: built.replayLagHours })}</span>
        </p>
        {/* The forecast file's own statement of what it is and where it came from, verbatim. */}
        <p className="text-xs text-fg-muted">{built.cycles[0]?.evaluation.evidence?.sourceStatement}</p>
      </header>

      <ol className="mb-2 flex flex-col gap-2" aria-label={t('title')}>
        {built.cycles.map((cycle, i) => (
          <CycleCard key={cycle.evaluation.evaluatedAt} cycle={cycle} index={i} total={built.cycles.length} />
        ))}
      </ol>

      <ActionList view={built} />
      <ApprovalBlock view={built} />
    </section>
  );
}
