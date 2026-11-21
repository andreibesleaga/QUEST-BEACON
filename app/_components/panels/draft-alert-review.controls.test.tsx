// @vitest-environment happy-dom
// BEACON — the approve control is offered for an outstanding DRAFT only (2026-11-21; Art. XIII, Art. XVI).
//
// GET /alerts keeps an approved alert in the list with state ACTUAL: the reviewer sees the outcome of the
// decision. Before this test the panel offered "Review & approve…" on that row as well — a control that
// could only produce the server's 409 (found on the live deployment, signed in as emergency manager).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftAlertReview, type DraftAlertItem } from './draft-alert-review.js';

const APPROVED: DraftAlertItem = {
  id: 'alert-approved-1',
  state: 'ACTUAL',
  headline: 'MODERATE Fire — us-ca-incident-approved',
};
const OUTSTANDING: DraftAlertItem = {
  id: 'alert-draft-2',
  state: 'DRAFT',
  headline: 'SEVERE Met — ro-incident-outstanding',
};

function rowOf(headline: RegExp): HTMLElement {
  const row = screen.getByText(headline).closest('li');
  if (row === null) throw new Error(`no list row for ${String(headline)}`);
  return row;
}

describe('DraftAlertReview — approve control', () => {
  it('offers approval on the DRAFT row and NOT on the row already approved (ACTUAL)', () => {
    render(<DraftAlertReview alerts={[APPROVED, OUTSTANDING]} onApprove={() => undefined} />);
    expect(within(rowOf(/us-ca-incident-approved/)).queryByRole('button')).toBeNull();
    expect(within(rowOf(/us-ca-incident-approved/)).getByText('ACTUAL')).toBeInTheDocument();
    expect(
      within(rowOf(/ro-incident-outstanding/)).getByRole('button', { name: /review.*approve/i }),
    ).toBeInTheDocument();
  });

  it('approves the row whose control was pressed, by its id', async () => {
    const onApprove = vi.fn();
    render(<DraftAlertReview alerts={[APPROVED, OUTSTANDING]} onApprove={onApprove} />);
    await userEvent.click(screen.getByRole('button', { name: /review.*approve/i }));
    expect(onApprove).toHaveBeenCalledExactlyOnceWith('alert-draft-2');
  });

  it('offers no control at all without an approve handler (a role that cannot approve)', () => {
    render(<DraftAlertReview alerts={[OUTSTANDING]} />);
    expect(screen.queryByRole('button', { name: /review.*approve/i })).toBeNull();
  });
});
