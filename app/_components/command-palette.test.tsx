// @vitest-environment happy-dom
// BEACON — CommandPalette tests (E8·T-389a). ⌘K opens the palette and it lists the act + layer + jump
// actions; it stays closed until the hotkey fires.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { useUiStore } = vi.hoisted(() => ({ useUiStore: vi.fn() }));
vi.mock('../_lib/store.js', () => ({ useUiStore }));

import { CommandPalette } from './command-palette.js';

beforeEach(() => {
  useUiStore.mockImplementation((sel: (s: Record<string, unknown>) => unknown) =>
    sel({ setRegion: vi.fn(), selectIncident: vi.fn(), toggleLayer: vi.fn() }),
  );
});

describe('CommandPalette', () => {
  it('is closed until ⌘K is pressed, then lists actions', async () => {
    render(
      <CommandPalette
        regions={[{ id: 'socal', label: 'Southern California' }]}
        onTaskResource={vi.fn()}
      />,
    );
    expect(screen.queryByText('Task resource')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    expect(await screen.findByText('Task resource')).toBeInTheDocument();
    expect(screen.getByText('Southern California')).toBeInTheDocument();
    expect(screen.getByText('Create DRAFT alert')).toBeInTheDocument();
    expect(screen.getByText(/Toggle fire layer/)).toBeInTheDocument();
  });

  it('names its trigger with the visible word first (WCAG 2.5.3 Label in Name)', () => {
    render(<CommandPalette />);
    const trigger = screen.getByTestId('command-palette-trigger');
    const visible = trigger.querySelector('span')?.textContent ?? '';
    expect(visible.length).toBeGreaterThan(0);
    const shortcut = trigger.querySelector('kbd')?.textContent ?? '';
    // What a voice-control user reads on the button — the word, then the shortcut — must be how the
    // accessible name begins, word for word and in that order.
    expect(trigger.getAttribute('aria-label')?.startsWith(`${visible} ${shortcut} — `)).toBe(true);
    expect(trigger.getAttribute('aria-keyshortcuts')).toBe('Meta+K Control+K');
  });

  it('opens the keyboard-shortcuts overlay on "?"', async () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: '?' });
    expect(await screen.findByText('Keyboard shortcuts')).toBeInTheDocument();
  });
});
