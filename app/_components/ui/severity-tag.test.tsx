// @vitest-environment happy-dom
// BEACON — SeverityTag tests (E8·T-346). One-meaning-per-colour/shape: each severity renders a DISTINCT
// icon AND distinct text — asserted by accessible text (never colour), so it survives greyscale.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SeverityTag, SEVERITY_ORDER, SEVERITY_META } from './severity-tag.js';

describe('SeverityTag', () => {
  it.each(SEVERITY_ORDER)('renders icon + text label for %s', (severity) => {
    const { container } = render(<SeverityTag severity={severity} />);
    expect(screen.getByText(SEVERITY_META[severity].label)).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('uses a distinct icon component per severity', () => {
    const icons = new Set(SEVERITY_ORDER.map((s) => SEVERITY_META[s].icon));
    expect(icons.size).toBe(SEVERITY_ORDER.length);
  });

  it('uses a distinct colour token per severity', () => {
    const colours = new Set(SEVERITY_ORDER.map((s) => SEVERITY_META[s].className));
    expect(colours.size).toBe(SEVERITY_ORDER.length);
  });
});
