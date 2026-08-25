// @vitest-environment happy-dom
// BEACON — FE-0 foundation smoke (E8·T-348/T-349). Proves the frontend test chain works end-to-end:
// esbuild automatic JSX + happy-dom + Testing Library + jest-dom matchers + the cn() token helper.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { cn } from './_lib/cn.js';

function Hello({ name }: { name: string }): ReactNode {
  return <p className={cn('text-fg', 'font-sans')}>Hello {name}</p>;
}

describe('FE-0 foundation', () => {
  it('cn() resolves conflicting Tailwind utilities (tailwind-merge)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-fg', false, 'font-sans')).toContain('text-fg');
  });

  it('renders a token-styled component in happy-dom via Testing Library', () => {
    render(<Hello name="BEACON" />);
    expect(screen.getByText('Hello BEACON')).toBeInTheDocument();
  });
});
