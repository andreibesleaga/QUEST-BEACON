// BEACON — Card / Panel surface primitives (E8·T-345a; UIUX §1). Flat layered surfaces: 1px token border
// + surface fill + rounded-lg. `Panel` adds a labelled region + header slot for the docked COP panels
// (SitRep / logistics). Pure presentational — RSC-safe.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../_lib/cn.js';

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, children, ...rest }: CardProps): ReactNode {
  return (
    <div className={cn('rounded-lg border border-line bg-surface text-fg', className)} {...rest}>
      {children}
    </div>
  );
}

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Visible panel title — also the accessible name of the <section> region. */
  title: string;
  /** Optional trailing header content (badges / controls). */
  actions?: ReactNode | undefined;
}

export function Panel({ title, actions, className, children, ...rest }: PanelProps): ReactNode {
  return (
    <section
      aria-label={title}
      className={cn('flex flex-col rounded-lg border border-line bg-surface text-fg', className)}
      {...rest}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  );
}
