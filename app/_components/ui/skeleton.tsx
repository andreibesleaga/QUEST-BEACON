'use client';
// BEACON — Skeleton loading placeholder (E8·T-350b; UIUX §2). Shimmer via the `motion` lib, and the
// shimmer is DISABLED under prefers-reduced-motion (falls back to a static token surface). Never a spinner.
import { useReducedMotion, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../../_lib/cn.js';
import { useT } from '../../_lib/i18n.js';

export interface SkeletonProps {
  className?: string | undefined;
  /** Accessible loading label announced to screen readers. */
  label?: string | undefined;
}

export function Skeleton({ className, label }: SkeletonProps): ReactNode {
  const t = useT('ui');
  const loadingLabel = label ?? t('skeleton.loading');
  const reduce = useReducedMotion();
  // Conditionally include the shimmer props so nothing animates under reduced-motion.
  const anim = reduce
    ? {}
    : {
        animate: { opacity: [0.55, 1, 0.55] },
        transition: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' as const },
      };
  return (
    <motion.div
      role="status"
      aria-busy="true"
      aria-label={loadingLabel}
      className={cn('overflow-hidden rounded bg-surface-2', className)}
      {...anim}
    >
      <span className="sr-only">{loadingLabel}</span>
    </motion.div>
  );
}
