// BEACON — EmptyState (E8·T-350b; UIUX §4 / Art. XVI). A DESIGNED, labelled empty state — never a blank
// panel. Optional icon + title + description + action slot. Pure presentational (the action is supplied
// by the caller's client boundary).
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../_lib/cn.js';

export interface EmptyStateProps {
  title: string;
  description?: string | undefined;
  icon?: LucideIcon | undefined;
  /** Optional call-to-action (e.g. a Button) rendered below the copy. */
  action?: ReactNode | undefined;
  className?: string | undefined;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps): ReactNode {
  const Icon = icon ?? Inbox;
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center justify-center gap-2 p-8 text-center', className)}
    >
      <Icon aria-hidden="true" className="size-8 text-fg-muted" strokeWidth={1.5} />
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-prose text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
