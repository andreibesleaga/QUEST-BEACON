// @vitest-environment happy-dom
// BEACON — ErrorBoundary tests (E8·T-348a). A thrown render error shows a labelled, recoverable fallback —
// never a blank panel.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ErrorBoundary } from './error-boundary.js';

function Boom(): ReactNode {
  throw new Error('layer render failed');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error to console.error; silence it for a clean test run.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a labelled fallback (role="alert") when a child throws', () => {
    render(
      <ErrorBoundary label="Fire layer">
        <Boom />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Fire layer failed to render');
    expect(alert).toHaveTextContent('layer render failed');
  });

  it('renders healthy children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('supports a custom fallback render prop', () => {
    render(
      <ErrorBoundary fallback={(error) => <div>caught: {error.message}</div>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('caught: layer render failed')).toBeInTheDocument();
  });
});
