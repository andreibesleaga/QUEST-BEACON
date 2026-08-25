'use client';
// BEACON — named-account sign-in control (POST /auth/login; the REAL auth surface, cloud-safe).
// Extracted from app/page.tsx 2026-08-04 so the credential-handling paths are unit-testable in isolation
// (page.tsx is the orchestrator and mocks the world; a login form should not need that).
//
// userId + password → POST /auth/login → the minted bearer is stored and every API call sends
// `Authorization: Bearer <token>` (roleHeaders, api.ts). The SERVER remains the sole authority — a bad/
// expired/forged token verifies to PUBLIC (rbac.ts, fail-closed) — so this control can never grant
// anything the JWT does not carry. The role shown is the one the SERVER answered with, never a wish.
import { useState, type ReactNode } from 'react';
import { Button } from './ui/index.js';
import { login } from '../_lib/api.js';
import { useUiStore } from '../_lib/store.js';
import { useT } from '../_lib/i18n.js';
import { APP_USER_ROLES, type ActorRole } from '../_lib/types.js';

/**
 * Coerce the server-returned role through the closed vocabulary. The server is the authority, but a
 * malformed/tampered response must not put an arbitrary string into the UI store (RBAC-gated components
 * key off it). Out-of-vocabulary ⇒ PUBLIC — least privilege, and the JWT still decides server-side.
 */
function toActorRole(role: string): ActorRole {
  return (APP_USER_ROLES as readonly string[]).includes(role) ? (role as ActorRole) : 'PUBLIC';
}

export interface LoginControlProps {
  /** Build-time gate (NEXT_PUBLIC_AUTH_TOKEN_LOGIN=on). Renders nothing when off, so the offline demo /
   *  gates / visual baselines stay byte-identical. A prop (not read here) so tests can exercise both. */
  enabled: boolean;
}

export function LoginControl({ enabled }: LoginControlProps): ReactNode {
  const t = useT('toolbar');
  const authToken = useUiStore((s) => s.authToken);
  const setAuthToken = useUiStore((s) => s.setAuthToken);
  const setRole = useUiStore((s) => s.setRole);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [signedInAs, setSignedInAs] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  if (!enabled) return null;

  if (authToken !== undefined) {
    return (
      <span className="flex items-center gap-1 text-xs text-fg-muted" data-testid="signed-in">
        {/* Name the ACCOUNT, not just the role: the whole point of named users is that the audit trail —
            and the operator looking at the screen — can tell WHO is acting. */}
        <span className="font-medium text-fg">{signedInAs ?? t('signedIn')}</span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="token-logout"
          onClick={() => {
            setAuthToken(undefined);
            setSignedInAs(undefined);
            setRole('PUBLIC'); // drop back to least privilege on sign-out, never a stale elevated role
          }}
        >
          {t('signOut')}
        </Button>
      </span>
    );
  }

  const submit = (): void => {
    if (userId.trim() === '' || password === '') return;
    void login(userId.trim(), password).then((session) => {
      // Always clear the password from component state, success or failure.
      setPassword('');
      if (session === undefined) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setAuthToken(session.token);
      setSignedInAs(session.userId);
      // Follow the SERVER's answer, never the user's wish: the role is whatever the account carries.
      setRole(toActorRole(session.role));
    });
  };

  return (
    <span className="flex items-center gap-1">
      <input
        aria-label={t('loginUserLabel')}
        data-testid="login-user"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder={t('loginUserPlaceholder')}
        className="w-28 rounded bg-surface-2 px-1 py-0.5 text-xs text-fg"
      />
      <input
        aria-label={t('loginPasswordLabel')}
        data-testid="login-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder={t('loginPasswordPlaceholder')}
        className="w-24 rounded bg-surface-2 px-1 py-0.5 text-xs text-fg"
      />
      <Button variant="ghost" size="sm" data-testid="login-submit" onClick={submit}>
        {t('signIn')}
      </Button>
      {/* One message for every failure mode — distinguishing "no such user" from "wrong password" (or
          from "login not configured") in the UI would enumerate accounts and disclose posture. */}
      {failed ? (
        <span role="alert" className="text-xs text-alert" data-testid="login-error">
          {t('signInFailed')}
        </span>
      ) : null}
    </span>
  );
}
