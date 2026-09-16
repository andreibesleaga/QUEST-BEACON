'use client';
// BEACON — ErrorState (E8·T-350b; UIUX §4 / Art. XVI "never a dead-end"). A labelled, recoverable error
// render with an optional retry action. Uses the reserved-for-alerts semantics via a warn-toned icon + text.
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button.js';
import { cn } from '../../_lib/cn.js';
import { useT } from '../../_lib/i18n.js';

export interface ErrorStateProps {
  title?: string | undefined;
  description?: string | undefined;
  /** Retry handler — renders a "Try again" button when provided. */
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
  className?: string | undefined;
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps): ReactNode {
  // Defaults resolved in the body (not in the parameter list) so the catalog lookup runs inside the render.
  const t = useT('ui');
  const heading = title ?? t('errorState.title');
  const retry = retryLabel ?? t('errorState.retry');
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-2 p-8 text-center', className)}
    >
      <TriangleAlert aria-hidden="true" className="size-8 text-alert" strokeWidth={1.5} />
      <p className="text-sm font-semibold text-fg">{heading}</p>
      {description ? <p className="max-w-prose text-sm text-fg-muted">{description}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          {retry}
        </Button>
      ) : null}
    </div>
  );
}
