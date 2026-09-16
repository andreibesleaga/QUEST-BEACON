// @vitest-environment happy-dom
// BEACON — UnverifiedBadge + ModeBadge tests (E8·T-356/T-355). Every badge = icon AND text (not colour-only).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnverifiedBadge } from './unverified-badge.js';
import { ModeBadge, MODE_ORDER, MODE_META } from './mode-badge.js';

describe('UnverifiedBadge', () => {
  it('renders the literal "Unverified" text plus an icon (label present without colour)', () => {
    const { container } = render(<UnverifiedBadge />);
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders an optional confidence percentage', () => {
    render(<UnverifiedBadge confidence={0.42} />);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });
});

describe('ModeBadge', () => {
  it.each(MODE_ORDER)('renders icon + text for %s', (mode) => {
    const { container } = render(<ModeBadge mode={mode} />);
    expect(screen.getByText(MODE_META[mode].label)).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
