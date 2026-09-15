// @vitest-environment happy-dom
// BEACON — EM-only DB-admin link tests (V2·A7, ADR-040). Deterministic: `/me` is answered by a stubbed
// fetch, and the REAL zustand store supplies the session (the token is what decides whether the COP asks
// at all), so these cover the actual state the shipped toolbar reads.
//
// WHAT THESE PROTECT. The link is a rendering of a value the SERVER decided to send. So the assertions are
// deliberately about the two halves of that: (a) nothing is rendered unless the payload carries the URL —
// there is no client-side role check to get wrong or to bypass; (b) no `/me` request is made at all
// without a session, so an anonymous visitor's request pattern is exactly what it was before A7.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeQueryClient } from '../_lib/query-client.js';
import { useUiStore } from '../_lib/store.js';
import { DbAdminLink } from './db-admin-link.js';

const DB_ADMIN_URL = 'https://directus.example.invalid/';

let calls: string[] = [];

/** `/me` is a PLAIN-JSON probe, not an envelope route — the stub answers exactly what the server sends. */
function stubMe(body: Record<string, unknown>): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

function renderLink(): void {
  const qc = makeQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<DbAdminLink />, { wrapper: Wrapper });
}

beforeEach(() => {
  calls = [];
  useUiStore.setState({ actorRole: 'PUBLIC', authToken: undefined });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DbAdminLink (A7 — EM-only DB-admin link)', () => {
  it('renders the link when the authenticated session payload carries dbAdminUrl', async () => {
    useUiStore.setState({ actorRole: 'EM', authToken: 'jwt-em' });
    stubMe({ role: 'EM', sub: 'em@beacon.demo', dbAdminUrl: DB_ADMIN_URL });
    renderLink();

    const link = await screen.findByTestId('db-admin-link');
    expect(link).toHaveAttribute('href', DB_ADMIN_URL);
    // A new tab must not be able to reach back through window.opener into a signed-in EM's COP.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders NOTHING when the payload omits dbAdminUrl — the server, not the component, is the gate', async () => {
    // A VERIFIER with a perfectly valid session: the field simply never arrives.
    useUiStore.setState({ actorRole: 'VERIFIER', authToken: 'jwt-verifier' });
    stubMe({ role: 'VERIFIER', sub: 'verifier@beacon.demo' });
    renderLink();

    await waitFor(() => expect(calls.some((u) => u.includes('/me'))).toBe(true));
    expect(screen.queryByTestId('db-admin-link')).toBeNull();
  });

  // CHANGED 2026-09-11, deliberately. This used to assert that an anonymous visitor issues NO `/me` request
  // at all, because `useMe` was gated on holding a bearer. That gate was removed: it narrowed a TRUE server
  // answer into a false one — an operator whose session the SERVER had already resolved as EM (the local
  // demo role path) was shown no link, because the client disagreed with the authority and won.
  //
  // What must still hold is the part that actually protects anything: a non-EM principal gets NO LINK. The
  // request itself is not sensitive — `/me` carries no RBAC and answers `{role:'PUBLIC'}` to anyone — so
  // the cost of the correction is one small request, and the benefit is that the server is the only decider.
  it('renders nothing for an anonymous visitor, though it does now ask', async () => {
    stubMe({ role: 'PUBLIC' });
    renderLink();

    await waitFor(() => expect(calls.some((u) => u.includes('/me'))).toBe(true));
    expect(screen.queryByTestId('db-admin-link')).toBeNull();
  });

  it('shows the link when the SERVER says EM, even without a bearer — the demo role path is honoured', async () => {
    // The exact case the owner reported: acting as EM through the local role switcher, the server resolves
    // the principal and sends `dbAdminUrl`, so the link must appear. Previously it did not.
    useUiStore.setState({ actorRole: 'EM', authToken: undefined });
    stubMe({ role: 'EM', dbAdminUrl: 'https://directus.example.test/' });
    renderLink();

    const link = await screen.findByTestId('db-admin-link');
    expect(link).toHaveAttribute('href', 'https://directus.example.test/');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders nothing when the session read fails (degrade + stay silent, never a dead control)', async () => {
    useUiStore.setState({ actorRole: 'EM', authToken: 'jwt-em' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    renderLink();

    await waitFor(() => expect(screen.queryByTestId('db-admin-link')).toBeNull());
  });
});
