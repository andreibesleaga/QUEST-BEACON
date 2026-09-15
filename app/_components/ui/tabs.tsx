'use client';
// BEACON — Tabs primitive (E8·T-345a; UIUX §4 tablet panel tabs). Token-styled wrapper over
// @radix-ui/react-tabs: `tablist`/`tab`/`tabpanel` roles, arrow-key roving selection, focus mgmt for free.
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../_lib/cn.js';

export const Tabs = TabsPrimitive.Root;

type ListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List>;
export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, ListProps>(
  function TabsList({ className, ...rest }, ref): ReactNode {
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg border border-line bg-surface p-1',
          className,
        )}
        {...rest}
      />
    );
  },
);

type TriggerProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>;
export const TabsTrigger = forwardRef<ElementRef<typeof TabsPrimitive.Trigger>, TriggerProps>(
  function TabsTrigger({ className, ...rest }, ref): ReactNode {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          'inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-fg-muted transition-colors duration-150 ease-out',
          'hover:text-fg data-[state=active]:bg-surface-2 data-[state=active]:text-fg',
          className,
        )}
        {...rest}
      />
    );
  },
);

type ContentProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;
export const TabsContent = forwardRef<ElementRef<typeof TabsPrimitive.Content>, ContentProps>(
  function TabsContent({ className, ...rest }, ref): ReactNode {
    // `data-[state=inactive]:hidden` (2026-08-25): Radix sets the `hidden` attribute from `!present`,
    // and with `forceMount` present is ALWAYS true — so a force-mounted inactive panel would render
    // stacked below the active one (caught by the phone/tablet visual baselines: +814px page height).
    // Hiding on data-state keeps the forceMount contract: mounted (state preserved), display:none.
    return (
      <TabsPrimitive.Content
        ref={ref}
        className={cn('pt-3 outline-none data-[state=inactive]:hidden', className)}
        {...rest}
      />
    );
  },
);
