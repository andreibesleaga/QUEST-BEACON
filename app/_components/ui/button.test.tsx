// @vitest-environment happy-dom
// BEACON — Button / IconButton primitive tests (E8·T-345a). Keyboard-activatable + accessible name.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Flame } from 'lucide-react';
import { Button, IconButton } from './button.js';

describe('Button', () => {
  it('exposes an accessible name from its text content', () => {
    render(<Button>Create alert</Button>);
    expect(screen.getByRole('button', { name: 'Create alert' })).toBeInTheDocument();
  });

  it('is keyboard-activatable via Enter and Space', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    btn.focus();
    expect(btn).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('defaults to type="button" (never an accidental form submit)', () => {
    render(<Button>Safe</Button>);
    expect(screen.getByRole('button', { name: 'Safe' })).toHaveAttribute('type', 'button');
  });
});

describe('IconButton', () => {
  it('has an accessible name from the required label and renders an icon', () => {
    const { container } = render(<IconButton icon={Flame} label="Show fire layer" />);
    expect(screen.getByRole('button', { name: 'Show fire layer' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
