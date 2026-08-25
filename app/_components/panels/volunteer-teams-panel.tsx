'use client';
// BEACON — Volunteer teams panel (S3·U1; FR-D6-1, ADR-035 §4, Art. XIV/XVI). The first surface over the
// tested-but-inert volunteer-team aggregate module: renders the TEAM units GET /volunteer-teams serves — a
// callsign, a headcount TALLY, capability tags and a duty state. There is no roster and no member anywhere
// on the wire type (Layer A: `VolunteerTeamFields` cannot carry a person-identifying key), so this panel
// structurally cannot render one. Availability tokens are a closed engine vocabulary rendered verbatim
// (F-62: never translated). Display-gated by the browser mirror of FEATURE_D6_VOLUNTEER_TEAMS (off ⇒ null,
// query never fires); the server flag stays authoritative. All degraded states are labelled (Art. XVI).
import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
import { EmptyState, ErrorState, Panel, ProvenancePopover, Skeleton } from '../ui/index.js';
import { useVolunteerTeams } from '../../_lib/hooks.js';
import { useT } from '../../_lib/i18n.js';
import type { VolunteerTeamView } from '../../_lib/types.js';

/** Build-time display gate — `!== 'off'` so an unset mirror keeps the server default (see supplies-panel). */
export const VOLUNTEER_TEAMS_PANEL_ENABLED = process.env.NEXT_PUBLIC_FEATURE_D6_VOLUNTEER_TEAMS !== 'off';

export interface VolunteerTeamsPanelProps {
  /** Override the build-time display gate (tests + a composition root that threads the flag itself). */
  enabled?: boolean | undefined;
  className?: string | undefined;
}

/** One team-unit row — callsign, aggregate headcount, capability tags, duty state (all verbatim). */
function TeamRow({ team }: { team: VolunteerTeamView }): ReactNode {
  const t = useT('volunteerTeamsPanel');
  return (
    <li
      className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-2 text-sm"
      data-testid={`team-${team.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 font-mono text-xs font-semibold text-fg">{team.callsign ?? team.id}</span>
        {/* Duty-state token verbatim (closed engine vocabulary) — text, never colour-only (WCAG 1.4.1). */}
        {team.availability !== undefined ? (
          <span
            className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
            data-testid={`team-availability-${team.id}`}
          >
            {team.availability}
          </span>
        ) : null}
        {team.headcount !== undefined ? (
          <span className="tabular-nums text-xs text-fg-muted">{t('headcount', { count: team.headcount })}</span>
        ) : null}
      </div>
      {team.skills !== undefined && team.skills.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('skills')}>
          {team.skills.map((skill) => (
            <span key={skill} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted">
              {skill}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** Connected volunteer-teams panel — fetches via useVolunteerTeams and renders every rung labelled. */
export function VolunteerTeamsPanel({ enabled, className }: VolunteerTeamsPanelProps): ReactNode {
  const t = useT('volunteerTeamsPanel');
  const on = enabled ?? VOLUNTEER_TEAMS_PANEL_ENABLED;
  const query = useVolunteerTeams(on);
  if (!on) return null;

  let body: ReactNode;
  let actions: ReactNode = null;
  if (query.isPending) {
    body = <Skeleton className="h-24 w-full" />;
  } else if (query.isError) {
    body = <ErrorState title={t('unavailable')} description={query.error.message} onRetry={() => void query.refetch()} />;
  } else {
    const env = query.data;
    // The wire is a claim, not a proof (the F-406 lesson): a 200 with an unexpected data shape must land
    // on the LABELLED error rung, never throw mid-render (Art. XVI — found 2026-08-08 when the COP page
    // test's fallback envelope crashed the whole page tree through an unguarded read in a sibling panel).
    const teams: readonly VolunteerTeamView[] | undefined = env.data?.teams;
    actions = <ProvenancePopover provenance={env.provenance} label={t('provenance')} />;
    body =
      teams === undefined ? (
        <ErrorState title={t('unavailable')} onRetry={() => void query.refetch()} />
      ) : teams.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} icon={Users} />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {teams.map((team) => (
              <TeamRow key={team.id} team={team} />
            ))}
          </ul>
          {env.freshness !== undefined ? (
            <p className="mt-2 text-xs text-fg-muted" data-testid="volunteer-teams-freshness">
              {t('asOf', { when: env.freshness })}
            </p>
          ) : null}
        </>
      );
  }
  return (
    <Panel title={t('title')} actions={actions} className={className} data-testid="volunteer-teams-panel">
      {body}
    </Panel>
  );
}
