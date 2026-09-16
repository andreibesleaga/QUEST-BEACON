// @vitest-environment happy-dom
// BEACON — ProvenancePopover tests (E8·T-357). Keyboard-openable; lists source + mode + fetchedAt.
// Deterministic relative time via a fixed `now`.
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProvenancePopover, type ProvenanceEntry } from './provenance-popover.js';

const NOW = new Date('2026-07-07T12:00:00Z').getTime();
const PROVENANCE: ProvenanceEntry[] = [
  { sourceId: 'firms', mode: 'LIVE', fetchedAt: NOW - 30_000 },
  { sourceId: 'nwps', mode: 'CACHED', fetchedAt: NOW - 3_600_000 },
];

describe('ProvenancePopover', () => {
  it('opens from the keyboard and lists each source + mode + relative time', async () => {
    const user = userEvent.setup();
    render(<ProvenancePopover provenance={PROVENANCE} now={NOW} />);

    const trigger = screen.getByRole('button', { name: /Provenance — 2 sources/ });
    trigger.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('firms')).toBeInTheDocument());
    expect(screen.getByText('nwps')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Cached')).toBeInTheDocument();
    expect(screen.getByText('30s ago')).toBeInTheDocument();
    expect(screen.getByText('1h ago')).toBeInTheDocument();
  });

  it('a long source list scrolls INSIDE the popover instead of overflowing off-screen (2026-08-25)', async () => {
    const many: ProvenanceEntry[] = Array.from({ length: 40 }, (_, i) => ({
      sourceId: `source-${i}`,
      mode: 'MOCK',
      fetchedAt: NOW - 60_000,
    }));
    const user = userEvent.setup();
    render(<ProvenancePopover provenance={many} now={NOW} />);

    const trigger = screen.getByRole('button', { name: /Provenance — 40 sources/ });
    trigger.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('source-0')).toBeInTheDocument());
    // every entry is in the DOM…
    expect(screen.getByText('source-39')).toBeInTheDocument();
    // …and the content element is height-capped + scrollable, so the tail is reachable on any screen
    const content = screen.getByText('source-0').closest('[class*="overflow-y-auto"]');
    expect(content).not.toBeNull();
    expect(content?.className).toMatch(/max-h-\[/);
  });
});
