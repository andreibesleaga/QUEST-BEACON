// BEACON — VisuallyHidden (E8·T-345a). Visually hides content while keeping it in the accessibility tree
// (screen-reader-only labels). Uses Tailwind's `sr-only` utility — no token colour, no extra dependency.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../_lib/cn.js';

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement>;

export function VisuallyHidden({ className, children, ...rest }: VisuallyHiddenProps): ReactNode {
  return (
    <span className={cn('sr-only', className)} {...rest}>
      {children}
    </span>
  );
}
