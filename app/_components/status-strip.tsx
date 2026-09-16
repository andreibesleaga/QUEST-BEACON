'use client';
// BEACON — top-bar status strip (owner request 2026-09-11). The at-a-glance line an operator reads before
// anything else: how much is happening, what is waiting on them, and — crucially — HOW OLD THE ANSWER IS.
//
// THREE RULES SHAPE THIS COMPONENT, and each is load-bearing:
//
// 1. **Art. XII — every number here is deterministic.** Each count is the length of a list the server
//    already sent, over the wire, with `provenance[]` and `freshness` on its envelope. Nothing is derived,
//    estimated, or narrated. A figure in the top bar is the most authoritative-looking place a figure can
//    sit, so it is the last place an inferred number belongs.
//
// 2. **The wall clock and the data's age are DIFFERENT FACTS and are shown as different things.** The
//    server composes its live picture once per process, so a count can be minutes or hours old while the
//    clock ticks on. A single timestamp beside a count would read as "this is the situation now" — which
//    would be exactly the kind of quiet, plausible falsehood this project exists to prevent. So the clock
//    is labelled as the clock, the data carries its own "as of", and when the data is old the strip says
//    so rather than letting the ticking clock imply freshness it does not have.
//
// 3. **Role-aware, and the queues are a SEPARATE COMPONENT for a reason.** The pending-alert and
//    unverified-report reads are VERIFIER+ on the server. Mounting their hooks for a PUBLIC visitor would
//    issue a request whose only possible answer is 403 — the exact pattern `hooks.ts` already refuses for
//    the dock panels. Keeping them in a child that is not rendered below VERIFIER means the hooks never
//    run, rather than running and being ignored.
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useAlerts, useIncidents, useReports, useStatus } from '../_lib/hooks.js';
import { useT } from '../_lib/i18n.js';
import type { ActorRole } from '../_lib/types.js';
import { cn } from '../_lib/cn.js';

/** One label + figure pair. Uppercase micro-label, tabular figure — the strip's only visual unit. */
function Stat({
  label,
  value,
  tone = 'default',
  testId,
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'alert' | 'ok';
  testId: string;
}): ReactElement {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap" data-testid={testId}>
      <span className="text-[0.625rem] font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          tone === 'alert' && 'text-alert',
          tone === 'ok' && 'text-fg-muted',
        )}
      >
        {value}
      </span>
    </span>
  );
}

/** A thin separator that is decorative only — hidden from assistive tech, which reads the stats as a list. */
function Divider(): ReactElement {
  return <span aria-hidden="true" className="h-3 w-px shrink-0 bg-line" />;
}

/**
 * The wall clock. Mount-gated on purpose: rendering a live time during SSR produces markup the client
 * immediately disagrees with, and a hydration mismatch on the very first paint of a crisis screen is not a
 * trade worth making for one second of earlier clock. Until mounted it renders a stable placeholder, so
 * the server and client agree and the row never reflows.
 */
function Clock({ label }: { label: string }): ReactElement {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const text = now === null ? '--:--:--' : now.toISOString().slice(11, 19);
  return (
    <span
      className="flex items-baseline gap-1.5 whitespace-nowrap"
      data-testid="status-strip-clock"
    >
      <span className="text-[0.625rem] font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {/* `aria-live="off"` EXPLICITLY, belt-and-braces. The clock now sits outside the strip's live region,
          but a future edit could nest it back inside one, and a per-second announcement is severe enough
          (it starves every other announcement on the page) to be worth stating at the element itself
          rather than relying on where an ancestor happens to be. */}
      <time
        aria-live="off"
        className="text-sm font-semibold tabular-nums text-fg-muted"
        dateTime={now?.toISOString() ?? undefined}
      >
        {text}
        <span className="ms-0.5 text-[0.625rem] font-normal">Z</span>
      </time>
    </span>
  );
}

/** How old the served picture is, in whole minutes — the honest counterweight to the ticking clock. */
function dataAgeMinutes(freshness: string | undefined, nowMs: number): number | null {
  if (freshness === undefined) return null;
  const t = Date.parse(freshness);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 60_000)) : null;
}

/** Beyond this the served picture is called out rather than left to look current beside a ticking clock. */
const STALE_AFTER_MIN = 30;

/**
 * A count's display value and tone, or NULL when the figure is not known.
 *
 * This returned an em dash until 2026-09-12. The rule behind it was right — "unknown must never render as
 * 0" — but the remedy was wrong, and the live deployment showed why: with the API returning 500 the strip
 * rendered `Active — Sources — Data age —`, a tidy row of labels with nothing behind any of them. Owner's
 * verdict, and it is the correct one: *if these infos are not reliable do not add them into the top bar,
 * keep only if they reflect the truth.*
 *
 * A dash is not neutral. In the most authoritative-looking strip on the screen it reads as a value —
 * plausibly zero, plausibly "nothing happening" — which is the same quiet falsehood rule 2 above exists to
 * prevent, one row higher. An absent figure is now genuinely absent: the caller drops the stat, and if no
 * figure is known at all the strip says so in words instead of drawing furniture around nothing.
 */
function countCell(n: number | undefined): { value: number | string; tone: 'alert' | 'ok' } | null {
  if (n === undefined) return null;
  return { value: n, tone: n > 0 ? 'alert' : 'ok' };
}

/** The data-age cell. Beyond the staleness threshold it is called out; unknown is NULL, never "0 min". */
function ageCell(
  ageMin: number | null,
  fmt: (m: number) => string,
): { value: string; tone: 'alert' | 'ok' } | null {
  if (ageMin === null) return null;
  return { value: fmt(ageMin), tone: ageMin > STALE_AFTER_MIN ? 'alert' : 'ok' };
}

/** Only VERIFIER and EM have queues on the server; everyone else must not even ask (see rule 3 above). */
function hasQueues(role: ActorRole): boolean {
  return role === 'VERIFIER' || role === 'EM';
}

/**
 * The operator queues — VERIFIER and above only. See rule 3 in the file header for why this is its own
 * component rather than a conditional branch inside the strip.
 */
function OperatorQueues({ regionId }: { regionId: string | undefined }): ReactElement | null {
  const t = useT('statusStrip');
  const alerts = useAlerts(regionId);
  const reports = useReports(regionId);

  // A queue whose count has not arrived is shown as an em dash, never as 0. "Nothing is waiting for you"
  // and "I do not know yet whether anything is waiting for you" are different claims, and on an approval
  // queue the difference is a decision an operator might otherwise not make.
  const pending = alerts.data?.data.alerts.filter((a) => a.state === 'DRAFT').length;
  const unverified = reports.data?.data.reports.filter((r) => r.status === 'UNVERIFIED').length;

  const p = countCell(pending);
  const u = countCell(unverified);
  if (p === null && u === null) return null; // neither queue known — show nothing rather than two dashes
  return (
    <>
      <Divider />
      {p !== null ? (
        <Stat label={t('pending')} value={p.value} tone={p.tone} testId="status-strip-pending" />
      ) : null}
      {u !== null ? (
        <Stat
          label={t('unverified')}
          value={u.value}
          tone={u.tone}
          testId="status-strip-unverified"
        />
      ) : null}
    </>
  );
}

/**
 * The strip when none of the REGION figures could be read. It says so, once, in words.
 *
 * The operator learns the real fact — the picture behind this strip could not be read — which is strictly
 * more information than three em dashes, and unlike them it cannot be mistaken for a quiet region. The
 * clock stays: it is the one reading that is still true, and it is labelled as the clock.
 *
 * THE QUEUES STILL RENDER (review, PR #12). They come from different endpoints, so an EM can perfectly
 * well have "3 alerts pending" while the region read is failing — and the first version of this branch
 * returned before mounting them, silently discarding the counts an operator most needs. The role gate is
 * preserved exactly: `OperatorQueues` is still a child that is not rendered below VERIFIER, so a PUBLIC
 * visitor still issues no request whose only possible answer is 403.
 */
function StripUnavailable({
  regionId,
  actorRole,
}: {
  regionId: string | undefined;
  actorRole: ActorRole;
}): ReactElement {
  const t = useT('statusStrip');
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:ms-auto"
      data-testid="status-strip"
    >
      <span
        role="status"
        aria-live="polite"
        className="whitespace-nowrap text-[0.625rem] font-medium uppercase tracking-wider text-alert"
        data-testid="status-strip-unavailable"
      >
        {t('unavailable')}
      </span>
      {hasQueues(actorRole) ? <OperatorQueues regionId={regionId} /> : null}
      <Divider />
      <Clock label={t('clock')} />
    </div>
  );
}

export interface StatusStripProps {
  readonly regionId: string | undefined;
  readonly actorRole: ActorRole;
  /** Fixed clock for deterministic tests; defaults to now. */
  readonly now?: number;
}

/**
 * The strip itself. Wraps onto its own line below ~640px rather than compressing — a squeezed row of
 * figures is harder to read at a glance than a wrapped one, and this is a glance surface.
 */
/** One optional stat: rendered with its own leading divider, or nothing at all when the figure is unknown. */
function OptionalStat({
  cell,
  label,
  testId,
  tone,
}: {
  cell: { value: number | string; tone: 'alert' | 'ok' } | null;
  label: string;
  testId: string;
  tone?: 'default' | 'alert' | 'ok';
}): ReactElement | null {
  if (cell === null) return null;
  return (
    <>
      <Divider />
      <Stat label={label} value={cell.value} tone={tone ?? cell.tone} testId={testId} />
    </>
  );
}

/**
 * The three figures the strip shows, each NULL when it is not known.
 *
 * Split out of the component so the render stays under the complexity gate, and because the honesty rule
 * lives here: a figure is either read from an envelope the server actually sent, or it is null. There is
 * no third state that renders as something.
 */
function useStripFigures(
  regionId: string | undefined,
  nowMs: number,
): {
  act: { value: number | string; tone: 'alert' | 'ok' } | null;
  src: { value: string; tone: 'alert' | 'ok' } | null;
  age: { value: string; tone: 'alert' | 'ok' } | null;
  degraded: number;
} {
  const t = useT('statusStrip');
  const incidents = useIncidents(regionId);
  const status = useStatus(regionId);

  const incidentList = incidents.data?.data.incidents;
  const sources = status.data?.data.sources ?? [];
  const live = sources.filter((s) => s.mode === 'LIVE').length;

  return {
    act: countCell(
      incidentList === undefined
        ? undefined
        : incidentList.filter((i) => i.status === 'ACTIVE').length,
    ),
    src:
      sources.length === 0
        ? null
        : { value: t('liveOfTotal', { live, total: sources.length }), tone: 'ok' },
    // Freshness is the OLDEST contributing datum on the envelope — the most conservative claim available,
    // which is the right one to put next to a clock.
    age: ageCell(dataAgeMinutes(incidents.data?.freshness, nowMs), (m) =>
      t('minutesAgo', { minutes: m }),
    ),
    degraded: sources.length - live,
  };
}

export function StatusStrip({ regionId, actorRole, now }: StatusStripProps): ReactElement {
  const t = useT('statusStrip');
  const { act, src, age, degraded } = useStripFigures(regionId, now ?? Date.now());

  // NOTHING IS KNOWN. Say that, once, instead of drawing a row of labels with dashes under them.
  if (act === null && src === null && age === null)
    return <StripUnavailable regionId={regionId} actorRole={actorRole} />;

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:ms-auto"
      data-testid="status-strip"
    >
      {/* The live region covers the COUNTS ONLY, and the clock sits OUTSIDE it.
          This was a real defect on first write (a11y audit, 2026-09-11): the wrapper carried
          `role="status" aria-live="polite"` around the whole strip, with a comment asserting the clock
          "announces nothing". That was wrong — `aria-live` is INHERITED by the entire subtree, and the
          default `aria-relevant="additions text"` includes text replacement. So a screen reader announced
          the ticking second every second, and queued every other announcement on the page behind it. The
          fix is structural rather than a suppression: scope the region to what actually changes meaningfully. */}
      <div
        role="status"
        aria-live="polite"
        aria-label={t('regionLabel')}
        className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
        data-testid="status-strip-counts"
      >
        {act !== null ? (
          <Stat
            label={t('active')}
            value={act.value}
            tone={act.tone}
            testId="status-strip-active"
          />
        ) : null}
        {hasQueues(actorRole) ? <OperatorQueues regionId={regionId} /> : null}
        <OptionalStat
          cell={src}
          label={t('sources')}
          testId="status-strip-sources"
          tone={degraded > 0 ? 'default' : 'ok'}
        />
        {/* Minutes, not a timestamp: "14 min" answers the question an operator actually has, and it cannot
            be misread as the current time the way a bare HH:MM sitting next to a clock can. */}
        <OptionalStat cell={age} label={t('dataAsOf')} testId="status-strip-age" />
      </div>
      <Divider />
      <Clock label={t('clock')} />
    </div>
  );
}
