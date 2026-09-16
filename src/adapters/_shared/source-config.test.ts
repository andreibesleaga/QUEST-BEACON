// BEACON — Config resolver tests (E4·T-142; ADR-012/FR-10). Mode/url/key resolve from SOURCE_<PREFIX>_*
// env; an invalid mode or a LIVE mode missing its key fails fast (CONFIG) — nothing is hardcoded.
import { describe, it, expect } from 'vitest';
import { resolveSourceConfig } from './source-config.js';

describe('resolveSourceConfig', () => {
  it('resolves mode + url + timeout + key from env', () => {
    const res = resolveSourceConfig({
      prefix: 'FIRMS',
      env: {
        SOURCE_FIRMS_MODE: 'live',
        SOURCE_FIRMS_URL: 'https://example/api',
        SOURCE_FIRMS_TIMEOUT_MS: '5000',
        SOURCE_FIRMS_INTERVAL_SEC: '300',
        FIRMS_MAP_KEY: 'abc123',
      },
      keyEnv: 'FIRMS_MAP_KEY',
      requireKeyForLive: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({
      mode: 'LIVE',
      url: 'https://example/api',
      timeoutMs: 5000,
      intervalSec: 300,
      apiKey: 'abc123',
    });
  });

  it('falls back to the default mode when unset', () => {
    const res = resolveSourceConfig({ prefix: 'FIRMS', env: {}, defaultMode: 'MOCK' });
    expect(res.ok && res.value.mode).toBe('MOCK');
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = resolveSourceConfig({ prefix: 'FIRMS', env: { SOURCE_FIRMS_MODE: 'banana' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('fails fast (CONFIG) when LIVE mode is missing its required key', () => {
    const res = resolveSourceConfig({
      prefix: 'FIRMS',
      env: { SOURCE_FIRMS_MODE: 'LIVE' },
      keyEnv: 'FIRMS_MAP_KEY',
      requireKeyForLive: true,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('does not require a key for CACHED/MOCK modes', () => {
    const res = resolveSourceConfig({
      prefix: 'FIRMS',
      env: { SOURCE_FIRMS_MODE: 'CACHED' },
      keyEnv: 'FIRMS_MAP_KEY',
      requireKeyForLive: true,
    });
    expect(res.ok).toBe(true);
  });
});
