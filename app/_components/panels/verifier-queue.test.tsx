// @vitest-environment happy-dom
// BEACON — VerifierQueue tests (E8·T-378…T-381). The report fixture is BUILT FROM REAL GET /reports OUTPUT
// (handleHttp as VERIFIER), so the queue shape can never drift from the wire. Approve fires the VERIFIED
// mutation (optimistic row); reject marks REJECTED with no outbound action; approve-with-CAP surfaces the
// emitted DRAFT alert; a non-verifier sees no action buttons.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useVerifyReport } = vi.hoisted(() => ({ useVerifyReport: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useVerifyReport }));
const { useUiStore } = vi.hoisted(() => ({ useUiStore: vi.fn() }));
vi.mock('../../_lib/store.js', () => ({ useUiStore }));

import { VerifierQueue, isLiveViewFresh, liveImageRef } from './verifier-queue.js';
import { GIBS_DEFAULT_LAYER, parseGibsRef } from '@/adapters/ai/vision/imagery/gibs.js';
import { realGet, FIXED_CLOCK } from '../../_lib/real-http.js';
import { reportsOf } from '../../_lib/mappers.js';
import type { ReportSummary, ReportsData } from '../../_lib/types.js';

// The REAL verifier queue the offline core serves to a VERIFIER (two seeded TRIAGED reports).
let reports: readonly ReportSummary[];
const mutate = vi.fn();

beforeAll(async () => {
  const { env } = await realGet<ReportsData>('/api/v1/reports', 'VERIFIER');
  reports = reportsOf(env);
});

beforeEach(() => {
  mutate.mockReset();
  useVerifyReport.mockReturnValue({ mutate, data: undefined });
  useUiStore.mockImplementation((sel: (s: { actorRole: string }) => unknown) => sel({ actorRole: 'VERIFIER' }));
});

describe('VerifierQueue (over real GET /reports output)', () => {
  it('lists every real report row', () => {
    render(<VerifierQueue reports={reports} regionId="us-ca" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(reports.length);
  });

  // The real claim must be on screen: a verifier deciding without reading it is the whole reason the
  // persisted `text` field exists. Guards against a regression back to a placeholder.
  it('renders the reporter CLAIM for each row — the evidence the decision rests on', () => {
    render(<VerifierQueue reports={reports} regionId="us-ca" />);
    for (const r of reports) {
      expect(screen.getByTestId(`report-text-${r.id}`)).toHaveTextContent(/\S/);
    }
  });

  // A queue that keeps decided work forever is not a queue. A row already terminal on ARRIVAL (i.e. not
  // decided in this session) must not be listed at all.
  it('hides reports that arrive already VERIFIED/REJECTED — the queue shows outstanding work only', () => {
    const decided = reports.map((r, i) => ({ ...r, status: i === 0 ? 'REJECTED' : 'VERIFIED' }));
    render(<VerifierQueue reports={decided} regionId="us-ca" />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText(/No unverified reports awaiting triage/i)).toBeInTheDocument();
  });

  // …but the row the operator JUST decided stays visible, so the decision is seen to land rather than
  // the row vanishing mid-click.
  it('keeps the just-decided row on screen with its status badge', async () => {
    const user = userEvent.setup();
    render(<VerifierQueue reports={reports} regionId="us-ca" />);
    const row = screen.getAllByRole('listitem')[0]!;
    const id = reports[0]!.id;
    await user.click(within(row).getByRole('button', { name: /Reject/ }));
    expect(screen.getByTestId(`status-${id}`)).toHaveTextContent('REJECTED');
  });

  it('approve fires the VERIFIED mutation and optimistically stamps the row', async () => {
    const user = userEvent.setup();
    render(<VerifierQueue reports={reports} regionId="us-ca" />);
    const row = screen.getAllByRole('listitem')[0]!;
    const id = reports[0]!.id;

    await user.click(within(row).getByRole('button', { name: /Approve$/ }));

    expect(mutate).toHaveBeenCalledWith({ id, body: { decision: 'VERIFIED' } }, expect.objectContaining({ onError: expect.any(Function) }));
    expect(screen.getByTestId(`status-${id}`)).toHaveTextContent('VERIFIED');
  });

  it('reject (misinformation) marks the report REJECTED (no CAP, no outbound)', async () => {
    const user = userEvent.setup();
    render(<VerifierQueue reports={reports} />);
    const row = screen.getAllByRole('listitem')[0]!;
    const id = reports[0]!.id;

    await user.click(within(row).getByTestId('reject-report-btn'));

    expect(mutate).toHaveBeenCalledWith({ id, body: { decision: 'REJECTED' } }, expect.objectContaining({ onError: expect.any(Function) }));
    expect(screen.getByTestId(`status-${id}`)).toHaveTextContent('REJECTED');
  });

  it('renders the deterministic confidence value + its component bars (Art. XII)', () => {
    render(<VerifierQueue reports={reports} regionId="us-ca" />);
    const id = reports[0]!.id;
    // The seeded rep-demo-1 carries confidence 0.62 with all four blend components.
    expect(screen.getByTestId(`confidence-value-${id}`)).toHaveTextContent('62%');
    expect(screen.getByTestId(`component-geocode-${id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`component-authority-${id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`component-classifier-${id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`component-corroboration-${id}`)).toBeInTheDocument();
    // The reject affordance is the misinformation control wired to the REJECTED transition.
    expect(within(screen.getAllByRole('listitem')[0]!).getByTestId('reject-report-btn')).toBeInTheDocument();
  });

  it('omits the confidence block entirely when a report has no confidence data', () => {
    const bare: ReportSummary = { id: 'rep-bare', status: 'TRIAGED' };
    render(<VerifierQueue reports={[bare]} />);
    expect(screen.queryByTestId('confidence-rep-bare')).not.toBeInTheDocument();
  });

  // F-407: this fixture used to carry `state: 'DRAFT'` — a key the `Alert` entity does not have — and the
  // component wrote `emitted.state ?? 'DRAFT'`, so the banner printed "DRAFT" no matter what the server
  // said and this assertion passed against a field that was never read. The fixture now uses the real CAP
  // lifecycle marker, `capStatus`, so the assertion tests the actual wire vocabulary. (`api.write-seam
  // .e2e.test.ts` proves the same value arrives from the REAL server rather than from a mock.)
  it('approve-with-CAP passes emitCap and surfaces the emitted DRAFT alert', async () => {
    const user = userEvent.setup();
    useVerifyReport.mockReturnValue({
      mutate,
      data: { meta: { emittedAlert: { id: 'a1', capStatus: 'DRAFT', headline: 'Evacuate Zone A' } } },
    });
    render(<VerifierQueue reports={reports} />);
    const row = screen.getAllByRole('listitem')[0]!;

    await user.click(within(row).getByRole('button', { name: /Approve \+ CAP/ }));

    expect(mutate).toHaveBeenCalledWith({ id: reports[0]!.id, body: { decision: 'VERIFIED', emitCap: true } }, expect.objectContaining({ onError: expect.any(Function) }));
    const banner = screen.getByTestId('emitted-draft-alert');
    expect(banner).toHaveTextContent('DRAFT');
    expect(banner).toHaveTextContent('Evacuate Zone A');
  });

  it('hides action buttons for a non-verifier role', () => {
    useUiStore.mockImplementation((sel: (s: { actorRole: string }) => unknown) => sel({ actorRole: 'PUBLIC' }));
    render(<VerifierQueue reports={reports} />);
    expect(screen.queryByRole('button', { name: /Approve$/ })).not.toBeInTheDocument();
  });

  it('renders the advisory vision-finding chip on the decided row when the response meta carries one (W4c)', async () => {
    const user = userEvent.setup();
    useVerifyReport.mockReturnValue({
      mutate,
      data: { meta: { visionFinding: { label: 'burn-area', confidence: 0.81, notes: 'Consistent with NIR scar.' } } },
    });
    render(<VerifierQueue reports={reports} />);
    const row = screen.getAllByRole('listitem')[0]!;
    const id = reports[0]!.id;

    await user.click(within(row).getByRole('button', { name: /Approve$/ }));

    const chip = screen.getByTestId(`vision-finding-${id}`);
    expect(chip).toBeInTheDocument();
    expect(screen.getByTestId(`vision-finding-label-${id}`)).toHaveTextContent('Vision (advisory): burn-area');
    expect(screen.getByTestId(`vision-finding-confidence-${id}`)).toHaveTextContent('81%');
    expect(screen.getByTestId(`vision-finding-caption-${id}`)).toHaveTextContent(
      /never auto-decides/i,
    );
  });

  it('renders no vision-finding chip when the response meta carries none (present-only)', async () => {
    const user = userEvent.setup();
    useVerifyReport.mockReturnValue({ mutate, data: { meta: { decision: 'VERIFIED' } } });
    render(<VerifierQueue reports={reports} />);
    const row = screen.getAllByRole('listitem')[0]!;
    const id = reports[0]!.id;

    await user.click(within(row).getByRole('button', { name: /Approve$/ }));

    expect(screen.queryByTestId(`vision-finding-${id}`)).not.toBeInTheDocument();
  });

  it('renders no vision-finding chip before any decision is made', () => {
    render(<VerifierQueue reports={reports} />);
    expect(screen.queryByTestId(`vision-finding-${reports[0]!.id}`)).not.toBeInTheDocument();
  });
});

// CW4 — citizen live-view chip (Live Views v1.2, ADR-029). Distinct "Live Feed — Unofficial" chip, link-only
// (target=_blank rel=noopener noreferrer), TTL auto-fade to a muted non-clickable "expired" state.
describe('VerifierQueue — citizen live-view chip (FEATURE_CITIZEN_STREAM)', () => {
  const withLink: ReportSummary = {
    id: 'rep-live',
    status: 'TRIAGED',
    text: 'streaming the fire front',
    liveViewUrl: 'https://twitch.tv/firewatch',
  };
  // Fixed evaluation instant (no wall clock): 3h after FIXED_CLOCK (= a projected receipt time), so a
  // submittedAt at/before FIXED_CLOCK is deterministically past the ~2h TTL and renders "expired".
  const NOW = Date.parse('2026-07-06T01:00:00.000Z');

  it('renders a distinct clickable "Live Feed — Unofficial" chip for a fresh link (no receipt time ⇒ fresh)', () => {
    render(<VerifierQueue reports={[withLink]} />);
    const chip = screen.getByTestId('live-view-rep-live');
    expect(chip).toHaveTextContent('Live Feed — Unofficial');
    const link = screen.getByTestId('live-view-link-rep-live');
    expect(link).toHaveAttribute('href', 'https://twitch.tv/firewatch');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders a muted, non-clickable "expired live link" once past the ~2h TTL', () => {
    const stale: ReportSummary = { ...withLink, submittedAt: '2000-01-01T00:00:00.000Z' };
    render(<VerifierQueue reports={[stale]} now={NOW} />);
    expect(screen.getByTestId('live-view-expired-rep-live')).toHaveTextContent('expired live link');
    expect(screen.queryByTestId('live-view-link-rep-live')).not.toBeInTheDocument();
  });

  it('fades to "expired" once a real projected receipt time (submittedAt) is past the ~2h TTL', () => {
    // CW5a: intake now stamps receivedAt (= FIXED_CLOCK) and GET /reports projects it onto submittedAt, so the
    // chip TTL runs against a REAL receipt instant instead of the always-fresh no-timestamp path. FIXED_CLOCK
    // is a safely-past instant (>2h before now), so the projected link deterministically renders expired.
    const projected: ReportSummary = { ...withLink, submittedAt: FIXED_CLOCK };
    render(<VerifierQueue reports={[projected]} now={NOW} />);
    expect(screen.getByTestId('live-view-expired-rep-live')).toHaveTextContent('expired live link');
    expect(screen.queryByTestId('live-view-link-rep-live')).not.toBeInTheDocument();
  });

  it('renders no live-view chip for a report without a link (present-only, byte-identical when off)', () => {
    const bare: ReportSummary = { id: 'rep-nolink', status: 'TRIAGED' };
    render(<VerifierQueue reports={[bare]} />);
    expect(screen.queryByTestId('live-view-rep-nolink')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-view-expired-rep-nolink')).not.toBeInTheDocument();
  });
});

describe('isLiveViewFresh (pure, fixed-clock)', () => {
  const NOW = Date.parse('2026-07-05T12:00:00.000Z');
  it('is fresh within the 2h window', () => {
    expect(isLiveViewFresh('2026-07-05T10:30:00.000Z', NOW)).toBe(true);
  });
  it('is stale past the 2h window', () => {
    expect(isLiveViewFresh('2026-07-05T09:00:00.000Z', NOW)).toBe(false);
  });
  it('treats an absent or unparseable timestamp as fresh (fail-open)', () => {
    expect(isLiveViewFresh(undefined, NOW)).toBe(true);
    expect(isLiveViewFresh('not-a-date', NOW)).toBe(true);
  });
});

// WP-D (2026-08-05): the vision-assist chain was complete server-side but had NO UI trigger — the chip
// was curl-only. The toggle is build-gated (visionEnabled) so default builds stay byte-identical.
describe('VerifierQueue — advisory vision-check toggle', () => {
  it('is absent by default (no visionEnabled ⇒ no toggle, baselines unchanged)', () => {
    render(<VerifierQueue reports={reports} />);
    expect(screen.queryByTestId(`vision-toggle-${reports[0]!.id}`)).not.toBeInTheDocument();
  });

  it('when enabled and ticked, the decision carries the recorded-fixture visionAssist payload', async () => {
    const user = userEvent.setup();
    render(<VerifierQueue reports={reports} visionEnabled />);
    await user.click(screen.getByTestId(`vision-toggle-${reports[0]!.id}`));
    await user.click(screen.getAllByTestId('verify-report-btn')[0]!);
    expect(mutate).toHaveBeenCalledWith(
      {
        id: reports[0]!.id,
        body: {
          decision: 'VERIFIED',
          visionAssist: {
            // S2·Lane V: the handle now names a tile that EXISTS (fixtures/vision/) — it previously named a
            // Sentinel-2 crop that was never on disk, which only "worked" because MockVision reads no pixels.
            imageRef: 'fixture:gibs-modis721-burn-area-us-ca-001',
            task: 'burn-area',
            imageConsented: true,
            piiScreened: true,
          },
        },
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('when enabled but NOT ticked, the body carries no visionAssist (opt-in, never implicit)', async () => {
    const user = userEvent.setup();
    render(<VerifierQueue reports={reports} visionEnabled />);
    await user.click(screen.getAllByTestId('verify-report-btn')[0]!);
    expect(mutate).toHaveBeenCalledWith(
      { id: reports[0]!.id, body: { decision: 'VERIFIED' } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });
});

// S2·Lane V — the LIVE-imagery variant. Second build-time flag (NEXT_PUBLIC_FEATURE_VISION_LIVE), nested
// inside the existing one, DEFAULT OFF: the gate profile pins both off, so no visual baseline can move.
describe('VerifierQueue — live-imagery vision trigger', () => {
  // 2026-07-05 is the project's fixed clock; `now` is injected so the built handle is deterministic.
  const NOW = Date.parse(FIXED_CLOCK);
  const located = (r: ReportSummary): ReportSummary => ({ ...r, geomPrecise: { type: 'Point', coordinates: [-121.6, 39.7] } });

  it('is absent by default — visionLiveEnabled unset ⇒ no live toggle (baselines unchanged)', async () => {
    const user = userEvent.setup();
    render(<VerifierQueue reports={reports.map(located)} visionEnabled now={NOW} />);
    await user.click(screen.getByTestId(`vision-toggle-${reports[0]!.id}`));
    expect(screen.queryByTestId(`vision-live-toggle-${reports[0]!.id}`)).not.toBeInTheDocument();
  });

  // The real VERIFIER queue DOES carry geomPrecise (RESPONDER+ gate, routes/queue.ts:101), so the
  // no-position case is constructed by removing it — which is exactly what a PUBLIC/lower-role payload
  // looks like on the wire.
  it('is absent for a report with no precise position — no place to look, no live offer', async () => {
    const user = userEvent.setup();
    const unlocated = reports.map((r) => ({ ...r, geomPrecise: undefined }));
    render(<VerifierQueue reports={unlocated} visionEnabled visionLiveEnabled now={NOW} />);
    await user.click(screen.getByTestId(`vision-toggle-${reports[0]!.id}`));
    expect(screen.queryByTestId(`vision-live-toggle-${reports[0]!.id}`)).not.toBeInTheDocument();
  });

  it('sends a gibs: handle built from the report position + the injected day when ticked', async () => {
    const user = userEvent.setup();
    render(<VerifierQueue reports={reports.map(located)} visionEnabled visionLiveEnabled now={NOW} />);
    await user.click(screen.getByTestId(`vision-toggle-${reports[0]!.id}`));
    await user.click(screen.getByTestId(`vision-live-toggle-${reports[0]!.id}`));
    await user.click(screen.getAllByTestId('verify-report-btn')[0]!);
    expect(mutate).toHaveBeenCalledWith(
      {
        id: reports[0]!.id,
        body: {
          decision: 'VERIFIED',
          visionAssist: {
            imageRef: 'gibs::-121.9,39.4,-121.3,40:2026-07-05',
            task: 'burn-area',
            imageConsented: true,
            piiScreened: true,
          },
        },
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('falls back to the recorded fixture when the live box is offered but left unticked', async () => {
    const user = userEvent.setup();
    render(<VerifierQueue reports={reports.map(located)} visionEnabled visionLiveEnabled now={NOW} />);
    await user.click(screen.getByTestId(`vision-toggle-${reports[0]!.id}`));
    await user.click(screen.getAllByTestId('verify-report-btn')[0]!);
    const body = mutate.mock.calls[0]?.[0] as { body: { visionAssist: { imageRef: string } } };
    expect(body.body.visionAssist.imageRef).toBe('fixture:gibs-modis721-burn-area-us-ca-001');
  });

  // The one assertion that keeps the browser's string format and the server's parser from drifting apart:
  // the handle this panel builds is fed to the REAL parser that will receive it.
  it('builds a handle the server-side gibs parser accepts (format pinned on both sides)', () => {
    const ref = liveImageRef([-121.6, 39.7], NOW);
    const parsed = parseGibsRef(ref, GIBS_DEFAULT_LAYER);
    expect(parsed.layer).toBe(GIBS_DEFAULT_LAYER); // empty segment ⇒ the SERVER picks the product
    expect(parsed.date).toBe('2026-07-05');
    expect(parsed.bbox).toBe('-121.9,39.4,-121.3,40');
  });

  it('ignores a non-Point / malformed geometry rather than guessing a coordinate', async () => {
    const user = userEvent.setup();
    const bad = reports.map((r) => ({ ...r, geomPrecise: { type: 'Polygon', coordinates: [[[0, 0]]] } }));
    render(<VerifierQueue reports={bad} visionEnabled visionLiveEnabled now={NOW} />);
    await user.click(screen.getByTestId(`vision-toggle-${reports[0]!.id}`));
    expect(screen.queryByTestId(`vision-live-toggle-${reports[0]!.id}`)).not.toBeInTheDocument();
  });
});
