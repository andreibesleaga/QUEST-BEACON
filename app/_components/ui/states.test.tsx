// @vitest-environment happy-dom
// BEACON — Skeleton / EmptyState / ErrorState tests (E8·T-350b). Designed, labelled loading/empty/error.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Skeleton } from './skeleton.js';
import { EmptyState } from './empty-state.js';
import { ErrorState } from './error-state.js';

describe('Skeleton', () => {
  it('exposes an accessible loading label', () => {
    render(<Skeleton className="h-4 w-32" label="Loading SitRep" />);
    expect(screen.getByRole('status', { name: 'Loading SitRep' })).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders a designed, labelled empty state (title + description + icon)', () => {
    const { container } = render(
      <EmptyState title="No active incidents" description="Nothing in this region yet." />,
    );
    expect(screen.getByText('No active incidents')).toBeInTheDocument();
    expect(screen.getByText('Nothing in this region yet.')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('renders role="alert" with a retry button that fires the handler', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState description="Source unreachable" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByText('Source unreachable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when no handler is given', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
