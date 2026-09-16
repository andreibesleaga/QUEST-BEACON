'use client';
// BEACON — the page side of the PWA (ADR-047). Mounted once in the root layout. Two jobs, both small:
//   1. Apply NEXT_PUBLIC_PWA to this device on load (register the worker, or retire it and its caches).
//   2. Tell the operator, in their language, when the picture on screen is NOT the network's answer:
//      the browser is offline, or the worker had to fall back to a saved copy. The banner names WHEN the
//      copy was saved, because a ticking clock beside old data would imply a freshness it does not have
//      (the same rule the status strip follows). Nothing here derives data; it only relays facts.
//
// The banner exists only while a worker CONTROLS the page: without one there is no saved copy to speak
// of, so a flag-off build (or a browser without workers) renders exactly the pre-PWA page. Saved copies
// are tracked PER URL — one query answered from cache while another is answered live keeps the banner
// up, and the time shown is the OLDEST saved part on screen (the picture is only as fresh as that).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { PWA_ENABLED } from '../../_lib/pwa/flag.js';
import { applyRegistration, parseWorkerMessage } from '../../_lib/pwa/registration.js';
import { useFormat, useT } from '../../_lib/i18n.js';

interface BridgeState {
  readonly offline: boolean;
  /** A service worker controls this page (only then can a saved copy be on screen). */
  readonly controlled: boolean;
  /** URL → ISO time its served copy was saved (null = served from cache but unstamped). */
  readonly cached: ReadonlyMap<string, string | null>;
}

/**
 * The saved time to show for a set of cached responses: undefined when nothing on screen came from the
 * cache; null when a copy is unstamped and no stamped one exists; else the OLDEST stamp.
 */
export function oldestCachedAt(
  cached: ReadonlyMap<string, string | null>,
): string | null | undefined {
  if (cached.size === 0) return undefined;
  let oldest: string | null = null;
  for (const stamp of cached.values()) {
    if (stamp === null) continue;
    if (oldest === null || stamp < oldest) oldest = stamp;
  }
  return oldest;
}

export function ServiceWorkerBridge(): ReactNode {
  const [state, setState] = useState<BridgeState>({
    offline: false,
    controlled: false,
    cached: new Map(),
  });
  useEffect(() => {
    const container = navigator.serviceWorker;
    void applyRegistration(container, window.caches, PWA_ENABLED);
    const readControl = (): void =>
      setState((s) => ({ ...s, controlled: (container?.controller ?? null) !== null }));
    setState((s) => ({ ...s, offline: !navigator.onLine }));
    readControl();
    const onOnline = (): void => setState((s) => ({ ...s, offline: false }));
    const onOffline = (): void => setState((s) => ({ ...s, offline: true }));
    const onMessage = (event: MessageEvent): void => {
      const message = parseWorkerMessage(event.data);
      if (message === undefined) return;
      setState((s) => {
        const cached = new Map(s.cached);
        if (message.type === 'beacon:served-from-cache') cached.set(message.url, message.cachedAt);
        else cached.delete(message.url);
        return { ...s, cached };
      });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    container?.addEventListener('message', onMessage);
    container?.addEventListener('controllerchange', readControl);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      container?.removeEventListener('message', onMessage);
      container?.removeEventListener('controllerchange', readControl);
    };
  }, []);
  if (!state.controlled) return null;
  return <OfflineBanner offline={state.offline} cachedAt={oldestCachedAt(state.cached)} />;
}

export interface OfflineBannerProps {
  readonly offline: boolean;
  /** ISO time the served copy was saved; null = served from cache but unstamped; undefined = live. */
  readonly cachedAt: string | null | undefined;
}

/**
 * Presentational: rendered only while the picture is offline or a saved copy. Offline with nothing
 * served from the cache yet says exactly that — it never claims a saved picture that is not on screen.
 */
export function OfflineBanner({ offline, cachedAt }: OfflineBannerProps): ReactNode {
  const t = useT('pwa');
  const format = useFormat();
  if (!offline && cachedAt === undefined) return null;
  const time =
    typeof cachedAt === 'string'
      ? format.dateTime(new Date(cachedAt), {
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : undefined;
  const text = bannerText(t, offline, cachedAt, time);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      data-offline={offline ? 'true' : 'false'}
      className="flex items-center justify-center gap-2 border-b border-line bg-surface-2 px-3 py-1.5 text-center text-sm font-medium text-warn-strong"
    >
      {text}
    </div>
  );
}

function bannerText(
  t: ReturnType<typeof useT<'pwa'>>,
  offline: boolean,
  cachedAt: string | null | undefined,
  time: string | undefined,
): string {
  if (time !== undefined) return offline ? t('offline', { time }) : t('stale', { time });
  if (cachedAt === undefined) return t('offlineNoCopy');
  return offline ? t('offlineUnknown') : t('staleUnknown');
}
