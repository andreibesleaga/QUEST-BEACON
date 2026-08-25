// @vitest-environment happy-dom
// BEACON — named-account sign-in control tests. Deterministic: the login API is mocked; the REAL zustand
// store is used and reset per test so the assertions cover the actual state the rest of the COP reads
// (authToken drives roleHeaders; actorRole drives every RBAC-gated panel).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('../_lib/api.js', () => ({ login }));

import { LoginControl } from './login-control.js';
import { useUiStore } from '../_lib/store.js';

beforeEach(() => {
  login.mockReset();
  useUiStore.setState({ authToken: undefined, actorRole: 'PUBLIC' });
});

async function signIn(user: ReturnType<typeof userEvent.setup>, id: string, pw: string): Promise<void> {
  await user.type(screen.getByTestId('login-user'), id);
  await user.type(screen.getByTestId('login-password'), pw);
  await user.click(screen.getByTestId('login-submit'));
}

describe('LoginControl', () => {
  it('renders nothing when the build gate is off (baseline toolbars stay byte-identical)', () => {
    const { container } = render(<LoginControl enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('signs in: stores the token, adopts the SERVER-assigned role, and names the account', async () => {
    login.mockResolvedValue({ token: 'jwt-1', role: 'EM', userId: 'em@beacon.demo' });
    const user = userEvent.setup();
    render(<LoginControl enabled />);
    await signIn(user, 'em@beacon.demo', 'pw');

    await waitFor(() => expect(screen.getByTestId('signed-in')).toHaveTextContent('em@beacon.demo'));
    expect(useUiStore.getState().authToken).toBe('jwt-1');
    // The role came from the RESPONSE — the form never sent one to ask for.
    expect(useUiStore.getState().actorRole).toBe('EM');
    expect(login).toHaveBeenCalledWith('em@beacon.demo', 'pw');
  });

  it('shows ONE failure message for any rejection and clears the typed password', async () => {
    login.mockResolvedValue(undefined); // 401 and 404 both surface as undefined — deliberately alike
    const user = userEvent.setup();
    render(<LoginControl enabled />);
    await signIn(user, 'em@beacon.demo', 'wrong');

    await waitFor(() => expect(screen.getByTestId('login-error')).toBeInTheDocument());
    expect(useUiStore.getState().authToken).toBeUndefined();
    expect(useUiStore.getState().actorRole).toBe('PUBLIC');
    // The credential must not linger in the field (or component state) after the attempt.
    expect(screen.getByTestId('login-password')).toHaveValue('');
  });

  it('coerces an out-of-vocabulary server role to PUBLIC — a malformed response never elevates the UI', async () => {
    login.mockResolvedValue({ token: 'jwt-x', role: 'SUPERADMIN', userId: 'weird@beacon.demo' });
    const user = userEvent.setup();
    render(<LoginControl enabled />);
    await signIn(user, 'weird@beacon.demo', 'pw');

    await waitFor(() => expect(screen.getByTestId('signed-in')).toBeInTheDocument());
    // Signed in (the token is real and the SERVER still decides every request), but the store's role
    // stays least-privilege rather than carrying an unknown string into RBAC-gated components.
    expect(useUiStore.getState().actorRole).toBe('PUBLIC');
  });

  it('submits on Enter from the password field', async () => {
    login.mockResolvedValue({ token: 'jwt-2', role: 'VERIFIER', userId: 'verifier@beacon.demo' });
    const user = userEvent.setup();
    render(<LoginControl enabled />);
    await user.type(screen.getByTestId('login-user'), 'verifier@beacon.demo');
    await user.type(screen.getByTestId('login-password'), 'pw{Enter}');
    await waitFor(() => expect(useUiStore.getState().actorRole).toBe('VERIFIER'));
  });

  it('does not call the API with a blank user or password', async () => {
    const user = userEvent.setup();
    render(<LoginControl enabled />);
    await user.click(screen.getByTestId('login-submit'));
    expect(login).not.toHaveBeenCalled();
  });

  it('sign-out drops the token AND falls back to least privilege, never a stale elevated role', async () => {
    login.mockResolvedValue({ token: 'jwt-3', role: 'EM', userId: 'em@beacon.demo' });
    const user = userEvent.setup();
    render(<LoginControl enabled />);
    await signIn(user, 'em@beacon.demo', 'pw');
    await waitFor(() => expect(screen.getByTestId('token-logout')).toBeInTheDocument());

    await user.click(screen.getByTestId('token-logout'));
    expect(useUiStore.getState().authToken).toBeUndefined();
    expect(useUiStore.getState().actorRole).toBe('PUBLIC');
  });
});
