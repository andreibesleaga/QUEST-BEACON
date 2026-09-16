'use client';
// BEACON — Tooltip primitive (E8·T-345a; UIUX §2). Token-styled wrapper over @radix-ui/react-tooltip:
// hover + KEYBOARD-FOCUS triggered, `tooltip` role, dismissible — hover info is never pointer-only (WCAG).
// Re-exports Provider so the app can mount one at the root.
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../_lib/cn.js';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

type ContentProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>;

export const TooltipContent = forwardRef<ElementRef<typeof TooltipPrimitive.Content>, ContentProps>(
  function TooltipContent({ className, sideOffset = 6, ...rest }, ref): ReactNode {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn(
            'z-50 max-w-xs rounded border border-line bg-surface-2 px-2 py-1 text-xs text-fg shadow-md',
            className,
          )}
          {...rest}
        />
      </TooltipPrimitive.Portal>
    );
  },
);
