'use client';
// BEACON — Logistics board (E8·T-384…T-386; FR-8/EV9/ST1; W2d flagship-4). Resource list (status + org
// scope, RBAC by role), a tasking control whose lifecycle transition is server-gated (only-from-VERIFIED) —
// a 403/409 is surfaced as a LABELLED error, never swallowed — a shelter capacity-vs-demand widget whose
// ratio is NON-colour-coded (numeric label + shape, T-346/one-meaning-per-shape), and the pre-positioning-
// from-predictions ADVISORY suggestions panel (GET /pre-positioning): the engine ranks candidates near the
// projected hazard extent, a human decides whether to actually task/relocate — never auto-tasked here
// (Art. XII/XIII).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { CircleCheck, Compass, Home, Info, OctagonAlert, Truck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  BadgeShell,
  Button,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
} from '../ui/index.js';
import { useResources, useTaskResource, usePrePositioning } from '../../_lib/hooks.js';
import { useT } from '../../_lib/i18n.js';
import { useUiStore } from '../../_lib/store.js';
import type {
  PrePositioningSuggestionSummary,
  ResourceSummary,
  ResourceTaskView,
} from '../../_lib/types.js';
// F-24: the tasking control's lifecycle MUST be the domain's state machine, not a UI re-declaration —
// re-declaring invited drift (the board previously said ASSIGNED/EN_ROUTE/ON_SCENE while the domain says
// TASKED/ENROUTE/ONSCENE, so a "tasked" resource here would never satisfy `canTransitionResourceTask`).
// Importing the exported const makes drift a `tsc`/runtime impossibility rather than something a test merely
// detects after the fact: there is no second array left to fall out of sync.
import { RESOURCE_TASK_STATUSES } from '@/domain/resource-task.js';
import type { ResourceTaskStatus } from '@/domain/resource-task.js';
import type { ResourceKind } from '@/domain/resource.js';

/**
 * FR-D6-1 (ADR-035 §4): the resource-kind icon map. Per finding F14 `kind` is switched on NOWHERE else in
 * the app, so this is the whole of the UI work a new kind needs.
 *
 * TWO THINGS ARE DELIBERATE HERE.
 *
 * 1. The type is `Record<ResourceKind, …>`, keyed by the DOMAIN union — so adding a kind to `RESOURCE_KINDS`
 *    and forgetting the icon is a `tsc --noEmit` ERROR naming the missing key, not a silent fallback. That is
 *    the F-24 lesson applied forward: the map is derived from the contract instead of drifting beside it.
 *
 * 2. Every PRE-EXISTING kind maps to `Truck`, which is exactly the icon `ResourceRow` hardcoded before this
 *    change. That is not laziness — the project's Playwright visual-baseline budget is spent (F-194), so this
 *    change is required to be a pixel-level no-op for every kind that can appear in an existing screenshot.
 *    Only the NEW kind gets a distinct glyph, and no `TEAM` resource is seeded anywhere (`src/main/feature-
 *    seed.ts` is untouched), so `Users` cannot render in any baseline. Choosing per-kind icons for CREW/
 *    ENGINE/AIRCRAFT/MEDICAL/SUPPLY is a real design improvement and is left to a lane that has the budget
 *    to re-shoot the baseline.
 */
const RESOURCE_KIND_ICON: Readonly<Record<ResourceKind, LucideIcon>> = {
  CREW: Truck,
  ENGINE: Truck,
  AIRCRAFT: Truck,
  MEDICAL: Truck,
  SUPPLY: Truck,
  TEAM: Users,
};

/** The icon for a wire-supplied kind token. The wire type is an OPEN string (the client must not own a copy
 *  of a server vocabulary — F-190), so an unrecognised token degrades to the previous default rather than
 *  rendering nothing (Art. XVI: never a dead end). */
export function resourceKindIcon(kind: string | undefined): LucideIcon {
  return RESOURCE_KIND_ICON[kind as ResourceKind] ?? Truck;
}

const TASKABLE_ROLES = new Set(['RESPONDER', 'VERIFIER', 'EM']);
const TRANSITIONS = RESOURCE_TASK_STATUSES;

// `messages/*.json` `logistics.transition.*` catalog keys (owned by a sibling lane, out of scope here) still
// use the OLD label vocabulary (ASSIGNED/EN_ROUTE/ON_SCENE) as the literal display text in every locale — see
// `logistics.transition` in `messages/en.json`. Deliberately decoupled from the wire value: the `<option
// value>` posted to the API is always the correct domain token (fixing the actual state-machine disagreement,
// F-24); this map is display-only, so the fix needs no 14-catalog edit and ships nothing visually different
// (a visual-baseline no-op, verified empirically — F-47). Renaming the catalog keys to the domain vocabulary
// is a follow-up left to whichever lane next owns `messages/*.json` (recorded as a finding).
type TransitionLabelKey = 'PROPOSED' | 'ASSIGNED' | 'EN_ROUTE' | 'ON_SCENE' | 'CLEARED';
const TRANSITION_LABEL_KEY: Readonly<Record<ResourceTaskStatus, TransitionLabelKey>> = {
  PROPOSED: 'PROPOSED',
  TASKED: 'ASSIGNED',
  ENROUTE: 'EN_ROUTE',
  ONSCENE: 'ON_SCENE',
  CLEARED: 'CLEARED',
};

/**
 * The three fields the capacity widget actually reads. Structural on purpose: the routing flow holds full
 * `Shelter` entities (assignable as-is), while the COP page holds map-projection `ShelterFeature`s whose
 * `demand` IS the domain `occupancy` (`map-projection.ts:316` — the projection renames, it does not model a
 * separate figure). Demanding the full entity here would force the page to fabricate `geom`/`status` values
 * it does not have — inventing data to satisfy a type is the same defect as inventing it to fill a UI.
 */
export interface ShelterCapacityRow {
  readonly id: string;
  readonly capacity: number;
  readonly occupancy: number;
}

export interface ShelterCapacityWidgetProps {
  shelters: readonly ShelterCapacityRow[];
}

/** Capacity vs demand as a NUMERIC ratio + a SHAPE (never colour-only): over-capacity = octagon, else check. */
export function ShelterCapacityWidget({ shelters }: ShelterCapacityWidgetProps): ReactNode {
  const t = useT('logistics');
  if (shelters.length === 0) {
    return <p className="text-sm text-fg-muted">{t('noShelterData')}</p>;
  }
  return (
    <ul className="flex flex-col gap-2" aria-label={t('shelterCapacityVsDemand')}>
      {shelters.map((s) => {
        // F-409: this read `s.demand ?? 0` and `s.name ?? s.id` — neither field exists on the `Shelter`
        // entity the server sends, so the FR-8 "capacity vs demand" widget rendered a CONSTANT 0/capacity
        // at 0% for every shelter in the product, and the over-capacity octagon could never fire. Both were
        // invented by a hand-written client mirror (`ShelterMatch`, now derived from the domain — F-406).
        //
        // OCCUPANCY is the demand the entity actually models: how many people are in the shelter now.
        // Projected demand is not modelled anywhere in the domain, so displaying it would be inventing a
        // figure — the exact Art. XII line. The label says occupancy because that is what the number is.
        const capacity = s.capacity;
        const occupancy = s.occupancy;
        const over = occupancy > capacity;
        const ratio = capacity > 0 ? Math.round((occupancy / capacity) * 100) : 0;
        const Shape = over ? OctagonAlert : CircleCheck;
        return (
          <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-fg">
              <Shape aria-hidden="true" className="size-4 shrink-0 text-fg-muted" strokeWidth={2} />
              {s.id}
            </span>
            <span className="flex items-center gap-2 tabular-nums text-fg">
              <span data-testid={`ratio-${s.id}`}>
                {occupancy}/{capacity}
              </span>
              <span className="text-fg-muted">({ratio}%)</span>
              <span className="rounded border border-line px-1.5 text-xs text-fg-muted">
                {over ? t('overCapacity') : t('withinCapacity')}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// F-191: a resource row now also shows the SERVER-CONFIRMED lifecycle state of its task, when this session
// has one — "surface existing tasks and advance them" is the whole point of the tasking control, and a
// forward-only machine you cannot see the current state of is not operable. The badge shows only what a
// response actually returned (never an optimistic guess), so it can never claim a step the server refused.
function ResourceRow({
  resource,
  task,
}: {
  resource: ResourceSummary;
  task: ResourceTaskView | undefined;
}): ReactNode {
  const t = useT('logistics');
  const KindIcon = resourceKindIcon(resource.kind);
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface p-2 text-sm">
      <span className="flex items-center gap-2 text-fg">
        <KindIcon aria-hidden="true" className="size-4 shrink-0 text-fg-muted" strokeWidth={2} />
        {resource.kind ?? t('resource')} · {resource.id}
      </span>
      <span className="flex items-center gap-2 text-xs text-fg-muted">
        {resource.orgId ? <span className="tabular-nums">{resource.orgId}</span> : null}
        {task ? (
          <span
            data-testid={`task-status-${resource.id}`}
            className="rounded border border-line px-1.5 py-0.5 font-medium text-fg"
          >
            {t(`transition.${TRANSITION_LABEL_KEY[task.status]}`)}
          </span>
        ) : null}
        <span className="rounded border border-line px-1.5 py-0.5 font-medium text-fg">
          {resource.status}
        </span>
      </span>
    </li>
  );
}

/**
 * The ONE lifecycle status a click may legally target next, DERIVED from the domain machine rather than
 * chosen by the UI (F-191). No task yet ⇒ the machine's start state (a brand-new task must enter at
 * PROPOSED — `memory-logistics.createTask`); an existing task ⇒ exactly one forward hop
 * (`canTransitionResourceTask`); a CLEARED task ⇒ `undefined`, the lifecycle is over and the control
 * disables itself rather than offering a click that can only 409.
 */
export function nextResourceTaskStatus(current?: ResourceTaskStatus): ResourceTaskStatus | undefined {
  if (current === undefined) return TRANSITIONS[0];
  return TRANSITIONS[TRANSITIONS.indexOf(current) + 1];
}

/** The tasks THIS session has created/advanced, keyed by resourceId — only server-confirmed values. */
type TaskByResource = Readonly<Record<string, ResourceTaskView>>;

// F-140: `incidentId` is a required prop here (not optional-and-ignored, as before) — the SERVER hard-fails
// a tasking POST without one (`parseFail('incidentId required')` in feature-router.ts), and `TaskResourceBody`
// now says the same thing at the type level (see app/_lib/types.ts). LogisticsBoard already receives an
// incidentId prop; this just threads it the rest of the way to the mutation that actually needs it.
//
// F-191: the control used to POST whatever the `<select>` showed, with NO task id, so every click asked the
// server to CREATE a task at that status — and the default selection (TASKED) is illegal for a brand-new
// task, so the default click always 409'd. The fix is not to relax the domain: it is to send what the
// endpoint has always accepted. The control now tracks the task the server CONFIRMED for each resource and
// posts `{id, status: <the one legal next step>}`, so repeated clicks walk PROPOSED → TASKED → ENROUTE →
// ONSCENE → CLEARED — the lifecycle invariant enforced, not weakened, and visibly so.
function TaskControl({
  resources,
  incidentId,
  tasks,
  onTasked,
}: {
  resources: readonly ResourceSummary[];
  incidentId: string | undefined;
  /** Server-confirmed tasks by resourceId (owned by LogisticsBoard so the rows can show them too). */
  tasks: TaskByResource;
  onTasked: (resourceId: string, task: ResourceTaskView) => void;
}): ReactNode {
  const t = useT('logistics');
  const task = useTaskResource(incidentId);
  const [resourceId, setResourceId] = useState('');
  const selectClass =
    'rounded-lg border border-line bg-surface px-2 py-1 text-sm text-fg';
  const current = resourceId === '' ? undefined : tasks[resourceId];
  const transition = nextResourceTaskStatus(current?.status);
  // No incident selected yet ⇒ there is no valid request to send (the server requires incidentId); no legal
  // next step ⇒ nothing to ask for. Either way the control stays disabled rather than firing a request that
  // can only fail (Art. XVI: never a dead click).
  const canSubmit =
    resourceId !== '' && incidentId !== undefined && incidentId !== '' && transition !== undefined;

  function onTask(): void {
    if (resourceId === '' || incidentId === undefined || incidentId === '' || transition === undefined) return;
    task.mutate(
      // `id` present ⇒ ADVANCE this task; absent ⇒ CREATE one (which the domain starts at PROPOSED).
      { ...(current !== undefined ? { id: current.id } : {}), resourceId, incidentId, status: transition },
      {
        // Record ONLY what the server confirmed — the next click's legal step is computed from the
        // response, never from what the UI hoped would happen (Art. XII/XVI).
        onSuccess: (env) => {
          onTasked(resourceId, env.data.task);
        },
      },
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="task-resource">
          {t('resourceToTask')}
        </label>
        <select
          id="task-resource"
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          className={selectClass}
        >
          <option value="">{t('selectResource')}</option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="task-transition">
          {t('lifecycleTransition')}
        </label>
        {/* The full domain machine stays visible so an operator can SEE the whole lifecycle and where this
            resource sits in it (F-24: the options are the domain constant, never a UI re-declaration); but
            only the ONE legal next hop is selectable, because a forward-only machine has exactly one. The
            option VALUE is the domain token; only its visible label is translated, via TRANSITION_LABEL_KEY's
            decoupled catalog-key lookup (see comment above). */}
        <select id="task-transition" value={transition ?? ''} disabled className={selectClass}>
          {TRANSITIONS.map((tr) => (
            <option key={tr} value={tr} disabled={tr !== transition}>
              {t(`transition.${TRANSITION_LABEL_KEY[tr]}`)}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={!canSubmit || task.isPending} onClick={onTask}>
          {t('task')}
        </Button>
      </div>
      {task.isError ? (
        <p role="alert" className="text-xs text-alert" data-testid="task-error">
          {t('taskingRejected', { code: task.error.code, message: task.error.message })}
        </p>
      ) : null}
    </div>
  );
}

function PrePositioningRow({ item }: { item: PrePositioningSuggestionSummary }): ReactNode {
  const t = useT('logistics');
  const Icon = item.kind === 'SHELTER' ? Home : resourceKindIcon(item.resourceKind);
  const km = (item.distanceMeters / 1000).toFixed(1);
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface p-2 text-sm">
      <span className="flex items-center gap-2 text-fg">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-muted" strokeWidth={2} />
        {item.kind === 'RESOURCE' ? (item.resourceKind ?? t('resource')) : t('shelter')} · {item.refId}
      </span>
      <span className="flex items-center gap-2 text-xs text-fg-muted">
        {item.kind === 'SHELTER' && item.capacity !== undefined ? (
          <span className="tabular-nums">
            {item.occupancy ?? 0}/{item.capacity}
          </span>
        ) : null}
        <span className="rounded border border-line px-1.5 py-0.5 font-medium text-fg tabular-nums">
          {km} km
        </span>
      </span>
    </li>
  );
}

export interface PrePositioningPanelProps {
  /** The currently-selected incident. Absent ⇒ a labelled empty state (never fires the request). */
  incidentId?: string | undefined;
}

/**
 * Pre-positioning-from-predictions ADVISORY suggestions (W2d, PRD flagship-4). The engine ranks resources/
 * shelters near — never inside — the projected hazard extent (GET /pre-positioning); a human decides whether
 * to actually task or relocate. Every state (no incident, no projection yet, no nearby assets, error) is a
 * DESIGNED empty state — never a blank panel (Art. XVI) — and the "Advisory" badge is always visible so the
 * suggestions are never mistaken for a committed tasking (Art. XIII).
 */
export function PrePositioningPanel({ incidentId }: PrePositioningPanelProps): ReactNode {
  const t = useT('logistics');
  const query = usePrePositioning(incidentId);

  let body: ReactNode;
  if (incidentId === undefined || incidentId === '') {
    body = (
      <EmptyState
        title={t('prePositioning.noIncidentTitle')}
        description={t('prePositioning.noIncidentDescription')}
        icon={Compass}
      />
    );
  } else if (query.isPending) {
    body = <Skeleton className="h-24 w-full" />;
  } else if (query.isError) {
    body = (
      <ErrorState
        title={t('prePositioning.unavailable')}
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (!query.data.data.extentAvailable) {
    body = (
      <EmptyState
        title={t('prePositioning.noExtentTitle')}
        description={t('prePositioning.noExtentDescription')}
        icon={Compass}
      />
    );
  } else if (query.data.data.suggestions.length === 0) {
    body = (
      <EmptyState
        title={t('prePositioning.noAssetsTitle')}
        description={t('prePositioning.noAssetsDescription')}
        icon={Compass}
      />
    );
  } else {
    body = (
      <ul className="flex flex-col gap-2" aria-label={t('prePositioning.listLabel')}>
        {query.data.data.suggestions.map((s) => (
          <PrePositioningRow key={`${s.kind}-${s.refId}`} item={s} />
        ))}
      </ul>
    );
  }

  return (
    <section aria-label={t('prePositioning.heading')} className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {t('prePositioning.heading')}
        </h3>
        <BadgeShell icon={Info} className="text-fg-muted">
          {t('prePositioning.advisory')}
        </BadgeShell>
      </div>
      {body}
    </section>
  );
}

export interface LogisticsBoardProps {
  /** Optional shelter capacity feed for the capacity-vs-demand widget. */
  shelters?: readonly ShelterCapacityRow[] | undefined;
  /** The currently-selected incident, threaded to the pre-positioning suggestions panel. */
  incidentId?: string | undefined;
  className?: string | undefined;
}

export function LogisticsBoard({ shelters, incidentId, className }: LogisticsBoardProps): ReactNode {
  const t = useT('logistics');
  const actorRole = useUiStore((s) => s.actorRole);
  // `actorRole` keys the query so a demo role change REFETCHES (the RBAC gate + org narrowing are
  // server-side, F-201) — the same reason `useMapData` keys by role.
  const query = useResources(incidentId, actorRole);
  const canTask = TASKABLE_ROLES.has(actorRole);
  // Server-confirmed tasks by resourceId, owned here so BOTH the rows (which display the current lifecycle
  // state) and the tasking control (which computes the next legal step from it) read the same values.
  const [tasks, setTasks] = useState<TaskByResource>({});
  const recordTask = (resourceId: string, task: ResourceTaskView): void => {
    setTasks((prev) => ({ ...prev, [resourceId]: task }));
  };

  let body: ReactNode;
  if (incidentId === undefined || incidentId === '') {
    // F-192: the resource registry is INCIDENT-scoped server-side, so with no incident there is nothing to
    // ask for — `useResources` keeps the query disabled and this designed empty state stands in for it,
    // rather than a spinner that never resolves or a 400 that blames the server (Art. XVI). The copy is the
    // catalog's existing, exactly-correct "No incident selected" string; `messages/*.json` is owned by
    // another lane, so no new key (× 14 locales) is minted here.
    body = <EmptyState title={t('prePositioning.noIncidentTitle')} icon={Truck} />;
  } else if (query.isPending) {
    body = <Skeleton className="h-32 w-full" />;
  } else if (query.isError) {
    body = (
      <ErrorState
        title={t('resourcesUnavailable')}
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (query.data.data.resources.length === 0) {
    body = <EmptyState title={t('noResourcesTitle')} description={t('noResourcesDescription')} icon={Truck} />;
  } else {
    const resources = query.data.data.resources;
    body = (
      <>
        <ul className="flex flex-col gap-2">
          {resources.map((r) => (
            <ResourceRow key={r.id} resource={r} task={tasks[r.id]} />
          ))}
        </ul>
        {canTask ? (
          <TaskControl
            resources={resources}
            incidentId={incidentId}
            tasks={tasks}
            onTasked={recordTask}
          />
        ) : null}
      </>
    );
  }

  return (
    <Panel title={t('title')} className={className} data-testid="logistics-board">
      {body}
      {shelters ? (
        <section aria-label={t('shelterCapacity')} className="mt-4 border-t border-line pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('shelterCapacity')}
          </h3>
          <ShelterCapacityWidget shelters={shelters} />
        </section>
      ) : null}
      <PrePositioningPanel incidentId={incidentId} />
    </Panel>
  );
}
