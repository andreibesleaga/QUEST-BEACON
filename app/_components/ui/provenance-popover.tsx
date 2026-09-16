'use client';
// BEACON — ProvenancePopover (E8·T-357; U1/FR-2). Keyboard-openable popover listing each source's
// id + mode + fetched-at — makes the mandatory provenance[] envelope legible on any datum. Deterministic:
// pass a fixed `now` in tests.
import type { ReactNode } from 'react';
import { FileSearch } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './popover.js';
import { ModeBadge, type SourceMode } from './mode-badge.js';
import { RELATIVE_TIME_MESSAGE_KEY, relativeTimeParts } from './relative-time.js';
import { useT } from '../../_lib/i18n.js';

export interface ProvenanceEntry {
  sourceId: string;
  mode: SourceMode;
  fetchedAt: Date | string | number;
}

export interface ProvenancePopoverProps {
  provenance: readonly ProvenanceEntry[];
  /** Trigger label / accessible name. */
  label?: string | undefined;
  /** Fixed clock for deterministic relative times. */
  now?: number | Date | undefined;
}

export function ProvenancePopover({ provenance, label, now }: ProvenancePopoverProps): ReactNode {
  const t = useT('ui');
  const nowMs = now === undefined ? Date.now() : now instanceof Date ? now.getTime() : now;
  const triggerLabel = label ?? t('provenance.trigger');
  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('provenance.triggerAria', { label: triggerLabel, count: provenance.length })}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-fg-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-fg"
      >
        <FileSearch aria-hidden="true" className="size-3.5" strokeWidth={2} />
        <span>{triggerLabel}</span>
      </PopoverTrigger>
      <PopoverContent>
        <h3 className="mb-2 text-sm font-semibold text-fg">{t('provenance.heading')}</h3>
        {provenance.length === 0 ? (
          <p className="text-xs text-fg-muted">{t('provenance.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {provenance.map((entry, i) => {
              // The numeric part is passed pre-formatted: an age is a raw count, not a grouped number.
              const age = relativeTimeParts(entry.fetchedAt, nowMs);
              return (
                <li key={`${entry.sourceId}-${i}`} className="flex flex-col gap-1">
                  <span className="font-mono text-xs text-fg">{entry.sourceId}</span>
                  <span className="flex items-center gap-2">
                    <ModeBadge mode={entry.mode} />
                    <time className="text-xs text-fg-muted tabular-nums">
                      {t(RELATIVE_TIME_MESSAGE_KEY[age.unit], { value: String(age.value) })}
                    </time>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
