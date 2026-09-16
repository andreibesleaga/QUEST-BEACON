'use client';
// BEACON — "Act" context menu (E8·T-389; U3/F14/D-30/UIUX§2). One keyboard-openable DropdownMenu exposing the
// three map-selection actions — Task resource · Draw evac route · Create DRAFT alert — each routing to its
// use-case via a callback the composition root wires to the hook. Every action is DRAFT/HITL-gated downstream
// (a DRAFT alert never auto-emits, Art. XIII). Radix gives roving-tabindex + type-ahead + Enter/Space open.
import type { ReactNode } from 'react';
import { ClipboardList, MapPinned, Siren } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/index.js';
import { useT } from '../_lib/i18n.js';

export interface ActMenuProps {
  onTaskResource: () => void;
  onDrawRoute: () => void;
  onCreateAlert: () => void;
  /** Custom trigger (e.g. a map FAB). Defaults to an "Act" button. */
  trigger?: ReactNode | undefined;
  /** Accessible name of the default trigger. */
  triggerLabel?: string | undefined;
  disabled?: boolean | undefined;
}

export function ActMenu({
  onTaskResource,
  onDrawRoute,
  onCreateAlert,
  trigger,
  triggerLabel,
  disabled,
}: ActMenuProps): ReactNode {
  const t = useT('actMenu');
  // The default trigger name comes from the catalog; a caller may still pass its own (already-translated) one.
  const triggerName = triggerLabel ?? t('trigger');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant="primary" size="sm" disabled={disabled} aria-label={triggerName}>
            {triggerName}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={t('title')}>
        <DropdownMenuLabel className="px-3 py-1 text-xs font-semibold text-fg-muted">
          {t('title')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1 h-px bg-line" />
        <DropdownMenuItem onSelect={onTaskResource}>
          <ClipboardList aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
          {t('taskResource')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDrawRoute}>
          <MapPinned aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
          {t('drawRoute')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCreateAlert}>
          <Siren aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
          {t('createAlert')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
