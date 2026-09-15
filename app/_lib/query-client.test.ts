// BEACON — the query client's network mode follows the PWA flag (ADR-047): the default build keeps
// TanStack's default (`online`), the PWA build fires each fetch once while offline so the worker's
// saved copy can answer.
import { describe, expect, it } from 'vitest';
import { makeQueryClient } from './query-client.js';

describe('makeQueryClient', () => {
  it('keeps the default network mode when offline-first is off', () => {
    const client = makeQueryClient(false);
    expect(client.getDefaultOptions().queries?.networkMode).toBeUndefined();
    expect(client.getDefaultOptions().queries?.retry).toBe(1);
  });
  it('uses offlineFirst when asked', () => {
    expect(makeQueryClient(true).getDefaultOptions().queries?.networkMode).toBe('offlineFirst');
  });
  it('defaults to the build flag (off in this test build)', () => {
    expect(makeQueryClient().getDefaultOptions().queries?.networkMode).toBeUndefined();
  });
});
