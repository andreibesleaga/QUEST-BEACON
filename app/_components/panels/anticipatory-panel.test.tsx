// @vitest-environment happy-dom
// BEACON — AnticipatoryPanel tests (D7; ADR-034 §1…§6, Art. XII/XIII/XVI, WCAG 1.4.1).
//
// Three states are covered because all three ship: DISABLED (the default, and the reason the COP's visual
// baselines are untouched), EMPTY-BUT-LABELLED (every "nothing here" states WHY), and POPULATED (every
// figure on screen is one the engine produced).
//
// Note (F-76): coverage `include` is scoped to `src/**`, so nothing here is measured by the 99% floor.
// These assertions exist because this surface makes constitutional claims that must not rot.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ANTICIPATORY_PANEL_ENABLED, AnticipatoryPanel } from './anticipatory-panel.js';
import { buildAnticipatoryView, type AnticipatoryView } from '../../_lib/anticipatory.js';

/**
 * ICU renders `{n, number}` with the active locale's grouping (6500 → "6,500"). Assertions format the
 * ENGINE's value through the same formatter rather than restating a literal, so they pin the engine's
 * number and not a transcription of it.
 */
const en = (value: number): string => new Intl.NumberFormat('en').format(value);

/** The real engine output for the shipped Danube protocol — never a hand-built stand-in. */
const REAL_VIEW = buildAnticipatoryView('ro');
if (REAL_VIEW.kind !== 'EVALUATED') throw new Error('the shipped ro replay must evaluate');

describe('AnticipatoryPanel — the display gate (F-194: zero visual-baseline budget)', () => {
  it('defaults OFF: with NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL unset the constant is false', () => {
    // Pinned explicitly rather than inferred from the render below, so a future default flip is a failing
    // test rather than a silently regenerated baseline (the lesson F-193 recorded: never lean on a default).
    expect(ANTICIPATORY_PANEL_ENABLED).toBe(false);
  });

  it('renders NOTHING at all when the gate is off — not an empty box, not a heading', () => {
    const { container } = render(<AnticipatoryPanel regionId="ro" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('anticipatory-panel')).not.toBeInTheDocument();
  });

  it('renders nothing when the gate is off EVEN with data available (the gate wins)', () => {
    const { container } = render(
      <AnticipatoryPanel regionId="ro" view={REAL_VIEW} enabled={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AnticipatoryPanel — empty states are LABELLED, never blank (Art. XVI)', () => {
  const unavailable = (view: AnticipatoryView): void => {
    render(<AnticipatoryPanel regionId="x" view={view} enabled />);
  };

  it('says WHY when no protocol scopes the region', () => {
    unavailable({ kind: 'UNAVAILABLE', regionId: 'atlantis', reason: 'NO_PROTOCOL_FOR_REGION' });
    expect(screen.getByTestId('anticipatory-panel')).toBeInTheDocument();
    expect(screen.getByText(/No early action protocol for this region/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/config\/eap/);
  });

  it('says WHY when the protocol ships but no recorded forecast does', () => {
    unavailable({ kind: 'UNAVAILABLE', regionId: 'us-ca', reason: 'NO_RECORDED_FORECAST' });
    expect(screen.getByText(/No recorded forecast for this protocol/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/no wired live ensemble source/i);
  });

  it('surfaces the ENGINE`s own refusal message rather than inventing an explanation', () => {
    unavailable({
      kind: 'UNAVAILABLE',
      regionId: 'ro',
      reason: 'ENGINE_REFUSED',
      detail: 'Invalid ensemble member file: members must be a non-empty array',
    });
    expect(screen.getByRole('status')).toHaveTextContent(/members must be a non-empty array/);
  });
});

describe('AnticipatoryPanel — populated: every figure comes from the engine (Art. XII)', () => {
  const renderReal = (): void => {
    render(<AnticipatoryPanel regionId="ro" view={REAL_VIEW} enabled />);
  };

  it('renders one card per replayed evaluation cycle, in engine order', () => {
    renderReal();
    expect(screen.getAllByTestId('anticipatory-cycle')).toHaveLength(REAL_VIEW.cycles.length);
  });

  it('shows the member count EXACTLY as the evidence states it (k of N over the threshold)', () => {
    renderReal();
    const evidence = REAL_VIEW.cycles[0]?.evaluation.evidence;
    if (evidence?.kind !== 'ENSEMBLE_MEMBER_COUNT')
      throw new Error('fixture must be member-count evidence');
    const row = screen.getAllByTestId('anticipatory-members')[0];
    expect(row).toHaveTextContent(en(evidence.membersOverThreshold));
    expect(row).toHaveTextContent(en(evidence.memberTotal));
    expect(row).toHaveTextContent(en(evidence.threshold));
    expect(row).toHaveTextContent(evidence.unit);
  });

  it('shows the lead time the SOURCE stated, labelled as such (never a modelled travel time)', () => {
    renderReal();
    const evidence = REAL_VIEW.cycles[0]?.evaluation.evidence;
    const row = screen.getAllByTestId('anticipatory-lead-time')[0];
    expect(row).toHaveTextContent(en(evidence?.leadTimeHours ?? -1));
    expect(row).toHaveTextContent(/as stated by the source/i);
  });

  it('labels METHOD, INPUTS and UNCERTAINTY for the predictive figure (standing prediction rule)', () => {
    renderReal();
    const likelihood = REAL_VIEW.cycles[0]?.evaluation.likelihood;
    if (likelihood === undefined) throw new Error('fixture must classify');
    // The classifier`s own method string, verbatim — not a UI paraphrase.
    expect(
      screen.getAllByText(
        new RegExp(likelihood.method.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      ).length,
    ).toBeGreaterThan(0);
    // The honesty label travels WITH the share: model spread, not a chance of occurrence.
    expect(
      screen.getAllByText(/NOT a calibrated probability and NOT a chance of occurrence/i).length,
    ).toBeGreaterThan(0);
  });

  it('labels the source tier FIXTURE and says the replay is not live data (F-34, Art. XVI)', () => {
    renderReal();
    expect(screen.getByText('FIXTURE')).toBeInTheDocument();
    expect(screen.getByTestId('anticipatory-replay-note')).toHaveTextContent(/Not live data/i);
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });

  it('renders the protocol`s own ILLUSTRATIVE status and provenance statement verbatim', () => {
    renderReal();
    expect(screen.getByText('ILLUSTRATIVE')).toBeInTheDocument();
    expect(screen.getByText(REAL_VIEW.eap.provenance)).toBeInTheDocument();
  });
});

describe('AnticipatoryPanel — a fired trigger is visibly distinguishable from one that has not', () => {
  it('marks the not-yet-fired rung with its OWN text and icon, not colour alone (WCAG 1.4.1)', () => {
    render(<AnticipatoryPanel regionId="ro" view={REAL_VIEW} enabled />);
    const firstCycle = screen.getAllByTestId('anticipatory-cycle')[0];
    // Cycle 1: READINESS has fired, ACTIVATION has not — both words must be present as TEXT.
    expect(firstCycle).toHaveTextContent('Fired');
    expect(firstCycle).toHaveTextContent('Not fired');
    // Every stage badge carries an aria-hidden lucide icon (shape) beside its text (BadgeShell contract).
    const stages = screen.getAllByTestId('anticipatory-stage');
    expect(stages.length).toBe(REAL_VIEW.cycles.length * 2);
    for (const stage of stages)
      expect(stage.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows each rung`s pre-agreed gate beside its state, so "not fired" says what it is waiting for', () => {
    render(<AnticipatoryPanel regionId="ro" view={REAL_VIEW} enabled />);
    const activation = REAL_VIEW.eap.triggers.activation;
    expect(screen.getAllByTestId('anticipatory-stage')[1]).toHaveTextContent(
      en(activation.threshold),
    );
    expect(screen.getAllByTestId('anticipatory-stage')[1]).toHaveTextContent(
      activation.minLikelihoodClass,
    );
  });
});

describe('AnticipatoryPanel — Art. XIII: suggestions only, no path to a public emission', () => {
  it('exposes NO interactive control at all (no button, no link, no form field)', () => {
    render(<AnticipatoryPanel regionId="ro" view={REAL_VIEW} enabled />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('marks pre-agreed actions as SUGGESTED and names the human who must approve', () => {
    render(<AnticipatoryPanel regionId="ro" view={REAL_VIEW} enabled />);
    expect(screen.getAllByTestId('anticipatory-action')).toHaveLength(REAL_VIEW.eap.actions.length);
    expect(screen.getAllByText('Suggested').length).toBeGreaterThan(0);
    const approval = screen.getByTestId('anticipatory-approval');
    expect(approval).toHaveTextContent(/Awaiting human approval by/i);
    expect(approval).toHaveTextContent(REAL_VIEW.eap.approval.authorizerRole);
  });

  it('states, on the panel itself, that nothing here dispatches or emits', () => {
    render(<AnticipatoryPanel regionId="ro" view={REAL_VIEW} enabled />);
    expect(
      screen.getByText(/Nothing on this panel dispatches a resource or emits a public alert/i),
    ).toBeInTheDocument();
  });

  it('shows the STOP mechanism — an activation that cannot be stopped is the dangerous one', () => {
    render(<AnticipatoryPanel regionId="ro" view={REAL_VIEW} enabled />);
    expect(
      screen.getByText(new RegExp(en(REAL_VIEW.eap.stop.maxDurationHours))),
    ).toBeInTheDocument();
  });
});
