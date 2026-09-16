'use client';
// BEACON — DropdownMenu primitive (E8·T-345a/T-389). Token-styled wrapper over @radix-ui/react-dropdown-menu:
// roving-tabindex, type-ahead, arrow-key nav + `menu`/`menuitem` roles for free (the map "Act" menu, T-389).
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../_lib/cn.js';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuLabel = MenuPrimitive.Label;
export const DropdownMenuSeparator = MenuPrimitive.Separator;

type ContentProps = ComponentPropsWithoutRef<typeof MenuPrimitive.Content>;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof MenuPrimitive.Content>,
  ContentProps
>(function DropdownMenuContent({ className, sideOffset = 6, ...rest }, ref): ReactNode {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-44 overflow-hidden rounded-lg border border-line bg-surface p-1 text-fg shadow-lg',
          className,
        )}
        {...rest}
      />
    </MenuPrimitive.Portal>
  );
});

type ItemProps = ComponentPropsWithoutRef<typeof MenuPrimitive.Item>;

export const DropdownMenuItem = forwardRef<ElementRef<typeof MenuPrimitive.Item>, ItemProps>(
  function DropdownMenuItem({ className, ...rest }, ref): ReactNode {
    return (
      <MenuPrimitive.Item
        ref={ref}
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-2 rounded px-3 text-sm outline-none transition-colors duration-150 ease-out',
          'data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          className,
        )}
        {...rest}
      />
    );
  },
);
