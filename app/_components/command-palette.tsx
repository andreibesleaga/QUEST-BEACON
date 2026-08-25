'use client';
// BEACON — Command palette (E8·T-389a; UIUX§2-3/F13/D-35). ⌘K/Ctrl-K opens a cmdk palette to jump
// region/incident/panel, toggle map layers (Zustand store), and run the act-menu actions — every action is
// reachable by keyboard (the WCAG 2.2 §2.5.7 non-pointer path). A `?` key opens a keyboard-shortcuts overlay
// (Dialog). Act actions remain DRAFT/HITL-gated downstream (Art. XIII).
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Command } from 'cmdk';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/index.js';
import { useUiStore } from '../_lib/store.js';
import { useT } from '../_lib/i18n.js';
import { LAYER_IDS } from '../_lib/types.js';
import type { LayerId } from '../_lib/types.js';

export interface NamedRef {
  readonly id: string;
  readonly label: string;
}

export interface CommandPaletteProps {
  regions?: readonly NamedRef[] | undefined;
  incidents?: readonly NamedRef[] | undefined;
  panels?: readonly NamedRef[] | undefined;
  onJumpPanel?: ((panelId: string) => void) | undefined;
  onTaskResource?: (() => void) | undefined;
  onDrawRoute?: (() => void) | undefined;
  onCreateAlert?: (() => void) | undefined;
}

function useGlobalHotkeys(togglePalette: () => void, openShortcuts: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        togglePalette();
      } else if (e.key === '?') {
        e.preventDefault();
        openShortcuts();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [togglePalette, openShortcuts]);
}

export function CommandPalette({
  regions,
  incidents,
  panels,
  onJumpPanel,
  onTaskResource,
  onDrawRoute,
  onCreateAlert,
}: CommandPaletteProps): ReactNode {
  const t = useT('commandPalette');
  // The three act actions are the SAME actions the act menu exposes — read them from that namespace so the
  // two surfaces can never drift apart in any locale.
  const tAct = useT('actMenu');
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const setRegion = useUiStore((s) => s.setRegion);
  const selectIncident = useUiStore((s) => s.selectIncident);
  const toggleLayer = useUiStore((s) => s.toggleLayer);

  const togglePalette = useCallback(() => setOpen((v) => !v), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useGlobalHotkeys(togglePalette, openShortcuts);

  // Key tokens ('Esc', '⌘K') are keyboard names, not prose — only the action description is translated.
  const shortcuts: readonly { keys: string; action: string }[] = [
    { keys: '⌘K / Ctrl-K', action: t('shortcut.openPalette') },
    { keys: '?', action: t('shortcut.openShortcuts') },
    { keys: '↑ / ↓', action: t('shortcut.move') },
    { keys: 'Enter', action: t('shortcut.run') },
    { keys: 'Esc', action: t('shortcut.close') },
  ];

  const run = useCallback((fn: (() => void) | undefined) => {
    return () => {
      fn?.();
      setOpen(false);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        data-testid="command-palette-trigger"
        aria-label={t('openLabel')}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={togglePalette}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-fg-muted hover:text-fg"
      >
        <span>{t('triggerText')}</span>
        <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs">⌘K</kbd>
      </button>
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label={t('dialogLabel')}
        className="fixed left-1/2 top-24 z-50 w-[min(92vw,32rem)] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface text-fg shadow-lg"
      >
        <Command.Input
          placeholder={t('placeholder')}
          className="w-full border-b border-line bg-surface px-4 py-3 text-sm text-fg outline-none placeholder:text-fg-muted"
        />
        <Command.List className="max-h-80 overflow-auto p-2">
          <Command.Empty className="p-3 text-sm text-fg-muted">{t('empty')}</Command.Empty>

          {regions && regions.length > 0 ? (
            <Command.Group heading={t('groupRegions')} className="text-xs text-fg-muted">
              {regions.map((r) => (
                <Command.Item
                  key={r.id}
                  value={`region ${r.label}`}
                  onSelect={run(() => setRegion(r.id))}
                  className="flex min-h-11 cursor-pointer items-center rounded px-3 text-sm text-fg data-[selected=true]:bg-surface-2"
                >
                  {r.label}
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}

          {incidents && incidents.length > 0 ? (
            <Command.Group heading={t('groupIncidents')} className="text-xs text-fg-muted">
              {incidents.map((inc) => (
                <Command.Item
                  key={inc.id}
                  value={`incident ${inc.label}`}
                  onSelect={run(() => selectIncident(inc.id))}
                  className="flex min-h-11 cursor-pointer items-center rounded px-3 text-sm text-fg data-[selected=true]:bg-surface-2"
                >
                  {inc.label}
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}

          {panels && panels.length > 0 ? (
            <Command.Group heading={t('groupPanels')} className="text-xs text-fg-muted">
              {panels.map((p) => (
                <Command.Item
                  key={p.id}
                  value={`panel ${p.label}`}
                  onSelect={run(() => onJumpPanel?.(p.id))}
                  className="flex min-h-11 cursor-pointer items-center rounded px-3 text-sm text-fg data-[selected=true]:bg-surface-2"
                >
                  {p.label}
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}

          <Command.Group heading={t('groupLayers')} className="text-xs text-fg-muted">
            {LAYER_IDS.map((layer: LayerId) => (
              <Command.Item
                key={layer}
                value={`toggle layer ${layer}`}
                onSelect={run(() => toggleLayer(layer))}
                className="flex min-h-11 cursor-pointer items-center rounded px-3 text-sm text-fg data-[selected=true]:bg-surface-2"
              >
                {t('toggleLayer', { layer })}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading={t('groupAct')} className="text-xs text-fg-muted">
            <Command.Item
              value="act task resource"
              onSelect={run(onTaskResource)}
              className="flex min-h-11 cursor-pointer items-center rounded px-3 text-sm text-fg data-[selected=true]:bg-surface-2"
            >
              {tAct('taskResource')}
            </Command.Item>
            <Command.Item
              value="act draw evac route"
              onSelect={run(onDrawRoute)}
              className="flex min-h-11 cursor-pointer items-center rounded px-3 text-sm text-fg data-[selected=true]:bg-surface-2"
            >
              {tAct('drawRoute')}
            </Command.Item>
            <Command.Item
              value="act create draft alert"
              onSelect={run(onCreateAlert)}
              className="flex min-h-11 cursor-pointer items-center rounded px-3 text-sm text-fg data-[selected=true]:bg-surface-2"
            >
              {tAct('createAlert')}
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command.Dialog>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent aria-label={t('shortcutsTitle')}>
          <DialogTitle className="text-base font-semibold text-fg">{t('shortcutsTitle')}</DialogTitle>
          <DialogDescription className="text-sm text-fg-muted">
            {t('shortcutsDescription')}
          </DialogDescription>
          <dl className="flex flex-col gap-2">
            {shortcuts.map((s) => (
              <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
                <dt>
                  <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">
                    {s.keys}
                  </kbd>
                </dt>
                <dd className="text-fg-muted">{s.action}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
