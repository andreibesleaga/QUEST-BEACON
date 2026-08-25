// @vitest-environment happy-dom
// BEACON — DraftAlertReview + DecisionSupport tests (E8·T-387/T-388).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DecisionSupport } from './decision-support.js';
import { DraftAlertReview } from './draft-alert-review.js';

describe('DecisionSupport', () => {
  it('shows deterministic figures beside narration and a human-approve control', async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(
      <DecisionSupport
        figures={[{ label: 'Exposed nodes', value: 42 }]}
        narration="Exposure is concentrated on the eastern grid."
        citations={[{ field: 'exposure', sourceId: 'overpass' }]}
        onApprove={onApprove}
      />,
    );
    expect(screen.getByText('Exposed nodes')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/eastern grid/)).toBeInTheDocument();
    expect(screen.getByText('overpass')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve decision' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('renders the approved state without an approve button', () => {
    render(<DecisionSupport figures={[]} approved />);
    expect(screen.getByText('Approved by human')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve decision' })).not.toBeInTheDocument();
  });

  it('a FAILED approval is labelled, never silent (2026-08-25) — the button stays for a retry', () => {
    render(<DecisionSupport figures={[]} onApprove={vi.fn()} approveError="alert is not in DRAFT state" />);
    const err = screen.getByTestId('approve-error');
    expect(err).toHaveTextContent('Approval failed');
    expect(err).toHaveTextContent('alert is not in DRAFT state');
    expect(screen.getByRole('button', { name: 'Approve decision' })).toBeEnabled();
  });

  it('a stale error from a PREVIOUS attempt never contradicts the approved state', () => {
    render(<DecisionSupport figures={[]} approved approveError="left over from an earlier click" />);
    expect(screen.getByText('Approved by human')).toBeInTheDocument();
    expect(screen.queryByTestId('approve-error')).not.toBeInTheDocument();
  });
});

describe('DraftAlertReview', () => {
  it('lists DRAFT alerts with provenance and routes approve to the human flow', async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(
      <DraftAlertReview
        alerts={[
          {
            id: 'a1',
            state: 'DRAFT',
            headline: 'Flash-flood threshold crossed',
            provenance: [{ sourceId: 'nwps', mode: 'LIVE', fetchedAt: '2026-07-07T12:00:00Z' }],
          },
        ]}
        onApprove={onApprove}
      />,
    );
    expect(screen.getByText('Flash-flood threshold crossed')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Review & approve/ }));
    expect(onApprove).toHaveBeenCalledWith('a1');
  });
});

// WP-C2 (2026-08-05): when approval is unavailable the control must SAY WHY (Art. XVI) — the page used
// to omit onApprove entirely, leaving the HITL keystone button permanently disabled with no explanation.
describe('DecisionSupport — unavailable-approval reason', () => {
  it('renders the reason beside the disabled button when onApprove is absent', () => {
    render(
      <DecisionSupport figures={[]} unavailableReason="Nothing to approve right now." />,
    );
    expect(screen.getByTestId('approve-unavailable-reason')).toHaveTextContent(
      'Nothing to approve right now.',
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('surfaces a failed approval above the queue instead of a silently dead button (2026-08-25)', () => {
    render(
      <DraftAlertReview
        alerts={[{ id: 'a1', headline: 'Gauge crossing', state: 'DRAFT' }]}
        onApprove={vi.fn()}
        approveError="already ACTUAL"
      />,
    );
    const err = screen.getByTestId('draft-approve-error');
    expect(err).toHaveTextContent('Approval failed');
    expect(err).toHaveTextContent('already ACTUAL');
  });

  it('renders NO reason when approval is wired (button enabled) or already approved', () => {
    const { rerender } = render(
      <DecisionSupport figures={[]} onApprove={() => undefined} unavailableReason="never shown" />,
    );
    expect(screen.queryByTestId('approve-unavailable-reason')).not.toBeInTheDocument();
    rerender(<DecisionSupport figures={[]} approved unavailableReason="never shown" />);
    expect(screen.queryByTestId('approve-unavailable-reason')).not.toBeInTheDocument();
  });
});
