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
  /**
   * Heading level for the title. Defaults to `h2`, which is right for every nested panel.
   *
   * The APPLICATION SHELL passes `h1` (accessibility audit, 2026-09-11): the document previously had 15
   * headings and NOT ONE `h1`, so a screen-reader user pressing `1` to orient landed nowhere, and the
   * product name sat on screen at the wrong level. axe never caught it because `page-has-heading-one` is
   * tagged best-practice and the gate's tag set asks only for the WCAG bands.
   *
   * A prop rather than a heuristic: which panel is the page's top-level heading is a fact about the page,
   * not something a shared component can infer — and guessing it would produce a document whose outline
   * changes depending on render order.
   */
  headingLevel?: 'h1' | 'h2' | undefined;
}

export function Panel({
  title,
  actions,
  className,
  children,
  headingLevel,
  ...rest
}: PanelProps): ReactNode {
  const Heading = headingLevel ?? 'h2';
  return (
    <section
      aria-label={title}
      className={cn('flex flex-col rounded-lg border border-line bg-surface text-fg', className)}
      {...rest}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        {/* Same classes at either level, so the outline is fixed without moving a pixel. */}
        <Heading className="text-sm font-semibold text-fg">{title}</Heading>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  );
}
