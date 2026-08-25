// @vitest-environment happy-dom
// BEACON — SitRepView tests (E8·T-371…T-374). The fixtures are BUILT FROM REAL HANDLER OUTPUT (handleHttp),
// not hand-authored shapes — so a wire↔type drift fails here, not in the browser. Each field renders WITH its
// citation; an uncited field is a VISIBLE error (F2); the deterministic-only rung hides only the LLM summary
// but KEEPS trend + per-field citations + priorities (bug 3 / Art. XII / UW3).
//
// The connected `SitRepPanel` External Views tests below (E11 "Live Views" · CW3b) mock `../../_lib/hooks.js`
// + `../../_lib/store.js` (same pattern as routing-panel.test.tsx) so they run without a QueryClientProvider.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SitRepPanel, SitRepView } from './sitrep-panel.js';
import { realGet, DEMO_REGION_ID } from '../../_lib/real-http.js';
import { incidentsOf, sitRepOf, type SitRepView as SitRepViewData } from '../../_lib/mappers.js';
import type { IncidentsData, SitRepData } from '../../_lib/types.js';
import { IntlProvider, type Messages } from '../../_lib/i18n.js';
import enMessages from '../../../messages/en.json';

// The REAL SitRep the offline core serves (deterministic-only rung — AI off offline).
let real: SitRepViewData;

beforeAll(async () => {
  const inc = await realGet<IncidentsData>(`/api/v1/regions/${DEMO_REGION_ID}/incidents`);
  const id = incidentsOf(inc.env)[0]!.id;
  const sit = await realGet<SitRepData>(`/api/v1/incidents/${id}/sitrep`);
  real = sitRepOf(sit.env);
});

/** A copy of the real SitRep with one guaranteed priority row (asserts rank/label render verbatim). */
function withPriority(): SitRepData {
  return { ...real.data, priorities: [{ rank: 1, label: 'substation-7', detail: 'blended risk score 0.87' }] };
}

describe('SitRepView (over real handler output)', () => {
  it('renders each grounded field with its citation source (no uncited-field errors, F2)', () => {
    render(<SitRepView data={real.data} citations={real.citations} />);
    expect(screen.queryByTestId('uncited-field')).not.toBeInTheDocument();
    expect(screen.getAllByText(real.citations[0]!.sourceId).length).toBeGreaterThan(0);
  });

  it('flags every field as a visible error when its citation is missing (F2)', () => {
    render(<SitRepView data={real.data} citations={[]} />);
    const alerts = screen.getAllByTestId('uncited-field');
    expect(alerts.length).toBe(real.data.fields.length);
    expect(alerts[0]).toHaveAttribute('role', 'alert');
    expect(alerts[0]).toHaveTextContent(/Uncited/);
  });

  it('renders priority rows straight from data.priorities (never computed here, Art. XII)', () => {
    render(<SitRepView data={withPriority()} citations={real.citations} />);
    const list = screen.getByRole('list', { name: 'Ranked priorities' });
    expect(list).toHaveTextContent('substation-7');
    expect(list).toHaveTextContent('blended risk score 0.87');
  });

  it('deterministic-only KEEPS trend + per-field citations + priorities, hides only the LLM summary (bug 3)', () => {
    expect(real.data.aiMode).toBe('deterministic-only'); // the offline default rung
    render(<SitRepView data={withPriority()} citations={real.citations} />);
    expect(screen.getByText('deterministic-only')).toBeInTheDocument();
    expect(screen.queryByTestId('sitrep-summary')).not.toBeInTheDocument(); // LLM narration hidden
    if (real.data.trend !== undefined) {
      expect(screen.getByText(/Trend:/)).toBeInTheDocument(); // trend RETAINED even deterministic-only
    }
    expect(screen.queryByTestId('uncited-field')).not.toBeInTheDocument(); // citations RETAINED
    expect(screen.getByRole('list', { name: 'Ranked priorities' })).toHaveTextContent('substation-7');
  });

  // ── Art. VI: AI-authored content is LABELLED as AI-authored (finding F-341) ──
  // The panel used to badge only the ABSENCE of AI ("deterministic-only"); the model-written summary — the
  // one string on this screen a human did not write, and the one exported to external agencies as
  // `summary.executiveSummary` — carried no label at all. Art. VI requires the opposite.

  it('labels the model-authored summary as AI-generated (Art. VI, F-341)', () => {
    const data: SitRepData = { ...real.data, aiMode: 'cloud', summary: 'The gauge is still rising.' };
    render(<SitRepView data={data} citations={real.citations} />);
    expect(screen.getByTestId('sitrep-summary')).toHaveTextContent('The gauge is still rising.');
    expect(screen.getByText('AI-generated')).toBeInTheDocument();
  });

  it('shows the AI label on the local rung too — any model-authored rung is labelled', () => {
    const data: SitRepData = { ...real.data, aiMode: 'local', summary: 'Evacuation orders remain in force.' };
    render(<SitRepView data={data} citations={real.citations} />);
    expect(screen.getByText('AI-generated')).toBeInTheDocument();
  });

  it('shows NO AI label when there is no AI narration (the badge tracks the prose, not the panel)', () => {
    // deterministic-only renders no summary at all, so an AI label there would be a lie in the other
    // direction. The two badges are mutually exclusive by construction.
    render(<SitRepView data={real.data} citations={real.citations} />);
    expect(screen.queryByText('AI-generated')).not.toBeInTheDocument();
    expect(screen.getByText('deterministic-only')).toBeInTheDocument();
  });

  // ── Ranked Outlook (C2.3; ADR-033 §5, SPEC-FINAL-VERSION-DELTA §5) ──
  // The Outlook is sourced from THIS response, not from MapProjectionData: the map wire carries only
  // map-plottable predictions, so a map-sourced panel would drop the geometry-less ESCALATION /
  // IMPACT_OVER_TIME kinds the Outlook exists to show (finding F-77).

  it('the REAL sitrep wire carries a ranked outlook[] of GEOMETRY-LESS predictions (SPEC §5, F-77)', () => {
    // End-to-end proof of the F-77 ruling: every row here is a kind that `projectMap` drops for having no
    // geometry, so a map-sourced panel would have shown an EMPTY Outlook while the engine had rows.
    expect(real.data.outlook?.length).toBeGreaterThan(0);
    for (const row of real.data.outlook ?? []) {
      expect(['ESCALATION', 'IMPACT_OVER_TIME']).toContain(row.kind);
      expect(row.method).not.toBe(''); // labeled (Art. XII/XIV)
    }
    expect(real.data.outlook?.map((o) => o.rank)).toEqual(
      real.data.outlook?.map((_, i) => i + 1), // engine-assigned, 1-based, in engine order
    );
  });

  it('renders the REAL outlook rows straight from the wire (client sorts nothing, Art. XII)', () => {
    render(<SitRepView data={real.data} citations={real.citations} showOutlook />);
    const rows = screen.getAllByTestId('outlook-row');
    expect(rows).toHaveLength(real.data.outlook!.length);
    expect(rows[0]).toHaveTextContent(real.data.outlook![0]!.kind);
  });

  it('renders no Outlook section for an incident with none (the page is unchanged, not empty-stated)', () => {
    render(<SitRepView data={{ ...real.data, outlook: [] }} citations={real.citations} showOutlook />);
    expect(screen.queryByTestId('outlook-panel')).not.toBeInTheDocument();
  });

  it('renders the engine-ranked Outlook, in engine order, when the SitRep carries one', () => {
    const data: SitRepData = {
      ...real.data,
      outlook: [
        {
          rank: 1,
          predictionId: 'ro-escalation-1',
          kind: 'ESCALATION',
          method: 'least-squares trend projection over gauge stage',
          uncertainty: 0.45,
          likelihoodClass: 'VERY_LIKELY',
          etaHours: 8,
        },
        {
          rank: 2,
          predictionId: 'ro-cone-1',
          kind: 'FIRE_CONE',
          method: 'wind-buffer first-order cone',
          uncertainty: 0.3,
          likelihoodClass: 'POSSIBLE',
          etaHours: 2,
        },
      ],
    };
    render(<SitRepView data={data} citations={real.citations} showOutlook />);
    const rows = screen.getAllByTestId('outlook-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('ESCALATION');
    expect(rows[0]).toHaveTextContent('VERY_LIKELY');
    expect(rows[0]).toHaveTextContent('least-squares trend projection over gauge stage');
    expect(rows[1]).toHaveTextContent('FIRE_CONE');
  });

  it('is DISPLAY-GATED off by default: the wire still carries the outlook, the COP just does not draw it', () => {
    // NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL is unset in every test/build/e2e run, so the default COP render is
    // byte-identical to before this lane — which is what keeps the single remaining visual-baseline
    // regeneration unspent. The DATA is unaffected: `real.data.outlook` is non-empty above.
    render(<SitRepView data={real.data} citations={real.citations} />);
    expect(screen.queryByTestId('outlook-panel')).not.toBeInTheDocument();
    expect(real.data.outlook?.length).toBeGreaterThan(0);
  });

  it('keeps the Outlook in the deterministic-only rung (engine output, so it never degrades away)', () => {
    const data: SitRepData = {
      ...real.data,
      aiMode: 'deterministic-only',
      outlook: [
        { rank: 1, predictionId: 'p1', kind: 'ESCALATION', method: 'least-squares trend projection', uncertainty: 0.4 },
      ],
    };
    render(<SitRepView data={data} citations={real.citations} showOutlook />);
    expect(screen.getByTestId('outlook-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('sitrep-summary')).not.toBeInTheDocument();
  });
});

// The EN-chip policy under a NON-English locale (FR-I18N; the 2026-08-04 "untranslated string reads as a
// bug" report). Every prior test here rendered provider-less, so the ambient locale was ALWAYS 'en' and
// the chip branch was structurally unreachable — the behaviour was correct by construction but unproven
// (found by the S3 SitRep sweep, 2026-08-08). English catalog as messages is deliberate: the chip keys
// fall back to English text either way; what is under test is the LOCALE branch, not the translation.
describe('SitRepView — EN chips under a non-English locale', () => {
  it('marks deterministic content with the EN chip and KEEPS the citation chips (ro)', () => {
    render(
      <IntlProvider value={{ locale: 'ro', messages: enMessages as Messages, timeZone: 'UTC' }}>
        <SitRepView data={real.data} citations={real.citations} />
      </IntlProvider>,
    );
    expect(screen.getAllByTestId('original-language-chip').length).toBeGreaterThan(0);
    // The citations are untouched by locale — cited-ness must never vary by language (Art. XI).
    expect(screen.getAllByText(real.citations[0]!.sourceId).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('uncited-field')).not.toBeInTheDocument();
  });

  it('renders zero EN chips when the locale IS English (the chip is a label, not decoration)', () => {
    render(
      <IntlProvider value={{ locale: 'en', messages: enMessages as Messages, timeZone: 'UTC' }}>
        <SitRepView data={real.data} citations={real.citations} />
      </IntlProvider>,
    );
    expect(screen.queryByTestId('original-language-chip')).not.toBeInTheDocument();
  });
});

// ── Connected SitRepPanel — External Views section (E11 "Live Views" · CW3b; FR-VIEW-1) ────────────────
// Mocks `../../_lib/hooks.js` + `../../_lib/store.js` (same pattern as routing-panel.test.tsx) so the
// connected panel renders without a QueryClientProvider. Verifies the collapsible section appears exactly
// when a representative position is derivable from the region's map data, and is absent otherwise.
const { useSitRep, useMapData } = vi.hoisted(() => ({ useSitRep: vi.fn(), useMapData: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useSitRep, useMapData }));
const { useUiStore: mockUseUiStore } = vi.hoisted(() => ({ useUiStore: vi.fn() }));
vi.mock('../../_lib/store.js', () => ({ useUiStore: mockUseUiStore }));

const SITREP_DATA: SitRepData = {
  id: 'sr1',
  incidentId: 'inc1',
  fields: [],
  priorities: [],
  aiMode: 'deterministic-only',
};

describe('SitRepPanel — External Views section (E11 · CW3b)', () => {
  beforeEach(() => {
    useSitRep.mockReturnValue({
      isPending: false,
      isError: false,
      data: { data: SITREP_DATA, provenance: [{ sourceId: 'engine', mode: 'MOCK', fetchedAt: '2026-07-17T00:00:00Z' }], citations: [] },
    });
    mockUseUiStore.mockImplementation(
      (
        sel: (s: {
          selectedIncidentId: string | undefined;
          activeRegionId: string;
          actorRole: string;
        }) => unknown,
      ) => sel({ selectedIncidentId: 'inc1', activeRegionId: 'us-ca', actorRole: 'PUBLIC' }),
    );
  });

  it('shows the External views section when the region map data yields a position', () => {
    useMapData.mockReturnValue({ exposure: [{ id: 'e1', position: [-121.62, 39.76] }] });
    render(<SitRepPanel />);
    expect(screen.getByTestId('external-views-section')).toBeInTheDocument();
    expect(screen.getByText('External views')).toBeInTheDocument();
    // The known Paradise, CA coordinate → the exact Google Maps deep-link (external-views.test.ts fixture).
    expect(screen.getByRole('link', { name: /Google Maps/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/@?api=1&map_action=map&center=39.76000%2C-121.62000&zoom=14',
    );
  });

  it('omits the External views section when the map data has no geolocated feature', () => {
    useMapData.mockReturnValue({});
    render(<SitRepPanel />);
    expect(screen.queryByTestId('external-views-section')).not.toBeInTheDocument();
  });

  // FEATURE_EXTERNAL_VIEWS reaching the browser (UNIMPLEMENTED_REGISTER row 25). Until the live-demo
  // increment the flag was inert client-side: `off` was documented, and the section rendered anyway. These
  // two pin the gate in BOTH directions, because a gate that only ever proves its default is a gate whose
  // off state is still undemonstrated — which is exactly how the flag became inert in the first place.
  it('omits the External views section when the flag is off, even with a position available', () => {
    useMapData.mockReturnValue({ exposure: [{ id: 'e1', position: [-121.62, 39.76] }] });
    render(<SitRepPanel showExternalViews={false} />);
    expect(screen.queryByTestId('external-views-section')).not.toBeInTheDocument();
  });

  it('shows the External views section when the flag is explicitly on', () => {
    useMapData.mockReturnValue({ exposure: [{ id: 'e1', position: [-121.62, 39.76] }] });
    render(<SitRepPanel showExternalViews />);
    expect(screen.getByTestId('external-views-section')).toBeInTheDocument();
  });
});
