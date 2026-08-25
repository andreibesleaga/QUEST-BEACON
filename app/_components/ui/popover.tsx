'use client';
// BEACON — Popover primitive (E8·T-345a/T-357). Token-styled wrapper over @radix-ui/react-popover:
// keyboard-openable, focus management, ESC/outside-click close, `dialog` semantics — used by the
// ProvenancePopover (T-357). No raw hex.
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../_lib/cn.js';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

type ContentProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>;

export const PopoverContent = forwardRef<ElementRef<typeof PopoverPrimitive.Content>, ContentProps>(
  function PopoverContent({ className, sideOffset = 6, align = 'start', ...rest }, ref): ReactNode {
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          className={cn(
            // max-h from Radix's measured available viewport space + overflow-y (2026-08-25): a long content
            // list (e.g. a many-source provenance panel) scrolls INSIDE the popover instead of running
            // off-screen unreachably. The fixed fallback caps it when the CSS var is not yet measured.
            'z-50 w-72 max-w-[92vw] rounded-lg border border-line bg-surface p-4 text-fg shadow-lg outline-none',
            'max-h-[min(var(--radix-popover-content-available-height,70vh),70vh)] overflow-y-auto',
            className,
          )}
          {...rest}
        />
      </PopoverPrimitive.Portal>
    );
  },
);
