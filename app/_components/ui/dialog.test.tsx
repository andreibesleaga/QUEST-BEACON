// @vitest-environment happy-dom
// BEACON — Dialog tests (E8·T-345a). The Radix dialog is labelled (aria-labelledby → title) and moves
// focus into the dialog on open (focus trap entry). ESC closes it (recoverable, non-trapping exit).
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from './dialog.js';

function Example(): React.ReactNode {
  return (
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogTitle>Confirm evacuation</DialogTitle>
        <DialogDescription>Task the nearest resource.</DialogDescription>
        <button type="button">Inside action</button>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('is labelled by its title and moves focus into the dialog when opened', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm evacuation' });
    expect(dialog).toBeInTheDocument();
    // Focus trap entry: focus is inside the dialog content.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('closes on Escape (no keyboard trap)', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog', { name: 'Confirm evacuation' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
