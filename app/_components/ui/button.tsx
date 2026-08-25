'use client';
// BEACON — Button + IconButton primitives (E8·T-345a; UIUX §1-2). cva variants over semantic tokens;
// ≥44px touch targets (exceeds WCAG 2.5.8's 24px). Native <button> = correct role/keyboard for free;
// focus-visible ring comes from the global token rule. No raw hex — token utilities only.
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../_lib/cn.js';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium select-none ' +
    'transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:opacity-90',
        ghost: 'bg-transparent text-fg hover:bg-surface-2',
        danger: 'bg-alert text-primary-fg hover:opacity-90',
        outline: 'border border-line bg-surface text-fg hover:bg-surface-2',
      },
      size: {
        // min-h/min-w 44px = field-usable touch target (UIUX §2).
        sm: 'min-h-11 px-3 text-sm',
        md: 'min-h-11 px-4 text-sm',
        lg: 'min-h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type, children, ...rest },
  ref,
): ReactNode {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** lucide icon rendered aria-hidden — `label` is the accessible name (icon-only button, WCAG 4.1.2). */
  icon: LucideIcon;
  /** Required accessible name — an icon alone has none. */
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, type, icon: Icon, label, ...rest },
  ref,
): ReactNode {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      className={cn(buttonVariants({ variant, size }), 'aspect-square px-0 min-w-11', className)}
      {...rest}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
    </button>
  );
});
