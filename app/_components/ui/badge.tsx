// BEACON — presentational badge shell (E8·T-346/T-355/T-356). Every BEACON status badge is icon + text
// (never color-alone, T-346): this shell always renders a lucide icon (aria-hidden — the text is the label)
// beside its children. Colour is supplied by a token utility on `className`; the icon inherits currentColor.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../_lib/cn.js';

export interface BadgeShellProps {
  /** Shape carrier — pairs with text so meaning survives without colour (WCAG 1.4.1). */
  icon: LucideIcon;
  /** Token colour utility (e.g. `text-ok`, `text-unverified`) + any layout overrides. */
  className?: string | undefined;
  children: ReactNode;
}

export function BadgeShell({ icon: Icon, className, children }: BadgeShellProps): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border border-line bg-surface px-2 py-0.5',
        'text-xs font-medium tabular-nums align-middle whitespace-nowrap',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
      {children}
    </span>
  );
}
