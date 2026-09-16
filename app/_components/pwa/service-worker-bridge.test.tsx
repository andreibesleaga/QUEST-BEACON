// @vitest-environment happy-dom
// BEACON — the offline / saved-copy banner (ADR-047): hidden while the picture is the network's own
// answer; shown, with the saved time, when the browser is offline or the worker fell back to a copy.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { OfflineBanner, ServiceWorkerBridge, oldestCachedAt } from './service-worker-bridge.js';
import * as registration from '../../_lib/pwa/registration.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OfflineBanner', () => {
  it('renders nothing while online and served from the network', () => {
    render(<OfflineBanner offline={false} cachedAt={undefined} />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('names the saved time when offline with a stamped copy', () => {
    render(<OfflineBanner offline={true} cachedAt="2026-09-15T07:05:00Z" />);
    const banner = screen.getByTestId('offline-banner');
    expect(banner.getAttribute('data-offline')).toBe('true');
    expect(banner.textContent).toMatch(/^Offline — showing the picture saved at 07:05/);
    expect(banner.getAttribute('role')).toBe('status');
  });

  it('says the copy is unstamped rather than inventing a time', () => {
    render(<OfflineBanner offline={true} cachedAt={null} />);
    expect(screen.getByTestId('offline-banner').textContent).toBe(
      'Offline — showing the last picture this device saved',
    );
  });

  it('offline with nothing served from the cache says so — it never claims a saved picture', () => {
    render(<OfflineBanner offline={true} cachedAt={undefined} />);
    expect(screen.getByTestId('offline-banner').textContent).toBe(
      'Offline — no saved picture yet on this device',
    );
  });

  it('distinguishes "server unreachable" (online, served from cache) from offline', () => {
    render(<OfflineBanner offline={false} cachedAt="2026-09-15T07:05:00Z" />);
    const banner = screen.getByTestId('offline-banner');
    expect(banner.getAttribute('data-offline')).toBe('false');
    expect(banner.textContent).toMatch(/^Server unreachable — showing the picture saved at 07:05/);
    cleanup();
    render(<OfflineBanner offline={false} cachedAt={null} />);
    expect(screen.getByTestId('offline-banner').textContent).toBe(
      'Server unreachable — showing the last picture this device saved',
    );
  });
});

describe('oldestCachedAt', () => {
  it('is undefined with nothing cached, the oldest stamp otherwise, null when only unstamped copies', () => {
    expect(oldestCachedAt(new Map())).toBeUndefined();
    expect(oldestCachedAt(new Map([['/a', null]]))).toBeNull();
    expect(
      oldestCachedAt(
        new Map([
          ['/a', '2026-09-15T07:10:00Z'],
          ['/b', null],
          ['/c', '2026-09-15T07:05:00Z'],
        ]),
      ),
    ).toBe('2026-09-15T07:05:00Z');
  });
});

interface FakeContainer {
  controller: object | null;
  addEventListener(type: string, fn: (e: MessageEvent) => void): void;
  removeEventListener(type: string): void;
}

function fakeContainer(controller: object | null): {
  container: FakeContainer;
  listeners: Map<string, (e: MessageEvent) => void>;
} {
  const listeners = new Map<string, (e: MessageEvent) => void>();
  const container: FakeContainer = {
    controller,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  return { container, listeners };
}

const message = (data: unknown): MessageEvent => ({ data }) as MessageEvent;

describe('ServiceWorkerBridge', () => {
  it('applies the flag on mount and follows the online/offline events and worker messages per URL', () => {
    const apply = vi.spyOn(registration, 'applyRegistration').mockResolvedValue('cleared');
    const { container, listeners } = fakeContainer({});
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    const { unmount } = render(<ServiceWorkerBridge />);
    expect(apply).toHaveBeenCalledWith(container, window.caches, false);
    expect(screen.queryByTestId('offline-banner')).toBeNull();

    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByTestId('offline-banner').textContent).toBe(
      'Offline — no saved picture yet on this device',
    );

    act(() =>
      listeners.get('message')?.(
        message({
          type: 'beacon:served-from-cache',
          url: '/api/v1/status',
          cachedAt: '2026-09-15T07:05:00Z',
        }),
      ),
    );
    expect(screen.getByTestId('offline-banner').textContent).toMatch(/saved at 07:05/);

    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.getByTestId('offline-banner').getAttribute('data-offline')).toBe('false');

    // A second query answered from an OLDER copy: the banner names the oldest part on screen.
    act(() =>
      listeners.get('message')?.(
        message({
          type: 'beacon:served-from-cache',
          url: '/api/v1/regions/ro/map',
          cachedAt: '2026-09-15T06:50:00Z',
        }),
      ),
    );
    expect(screen.getByTestId('offline-banner').textContent).toMatch(/saved at 06:50/);

    // One URL answered live clears ONLY that URL: the other saved copy is still on screen.
    act(() =>
      listeners.get('message')?.(
        message({ type: 'beacon:served-from-network', url: '/api/v1/regions/ro/map' }),
      ),
    );
    expect(screen.getByTestId('offline-banner').textContent).toMatch(/saved at 07:05/);

    act(() =>
      listeners.get('message')?.(
        message({ type: 'beacon:served-from-network', url: '/api/v1/status' }),
      ),
    );
    expect(screen.queryByTestId('offline-banner')).toBeNull();

    act(() => listeners.get('message')?.(message('garbage')));
    expect(screen.queryByTestId('offline-banner')).toBeNull();

    unmount();
    expect(listeners.has('message')).toBe(false);
    expect(listeners.has('controllerchange')).toBe(false);
  });

  it('renders nothing without a controlling worker, even offline (the pre-PWA page)', () => {
    vi.spyOn(registration, 'applyRegistration').mockResolvedValue('unsupported');
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    render(<ServiceWorkerBridge />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    cleanup();

    const { container } = fakeContainer(null);
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    render(<ServiceWorkerBridge />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('starts in the offline state when the browser already is and a worker controls the page', () => {
    vi.spyOn(registration, 'applyRegistration').mockResolvedValue('registered');
    const { container, listeners } = fakeContainer(null);
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    render(<ServiceWorkerBridge />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    // The worker claims the page (clients.claim()) → controllerchange → the banner may now speak.
    container.controller = {};
    act(() => listeners.get('controllerchange')?.(message(undefined)));
    expect(screen.getByTestId('offline-banner').getAttribute('data-offline')).toBe('true');
  });
});
