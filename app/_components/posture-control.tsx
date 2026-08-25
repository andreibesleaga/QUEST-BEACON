'use client';
// BEACON — deploy-posture toolbar control (WP-A1; extracted from app/page.tsx 2026-08-25 so both posture
// branches are unit-testable in isolation — page.tsx keeps only the build-time gate, passed as a prop the
// way LoginControl receives `enabled`).
//
// LIVE posture ⇒ an honest green chip PLUS a text-only chip naming the CURRENT acting role (2026-08-25:
// the DEV role-switcher used to be the only surface showing the role; on a live deploy the role must stay
// visible — PUBLIC until sign-in, then whatever the account's JWT carries — but it is display-only: on
// live there is deliberately NO control that could even ask for a role (F-344). DEV posture (default) ⇒
// the red DEV tag + the demo role switcher, which spoofs `x-beacon-role` and is honoured only under
// AUTH_DEV_TRUST_HEADER=on (the server still authorizes every request).
import type { ReactNode } from 'react';
import { useT } from '../_lib/i18n.js';
import { APP_USER_ROLES, type ActorRole } from '../_lib/types.js';

export interface PostureControlProps {
  /** Build-time gate (NEXT_PUBLIC_DEPLOY_POSTURE=live). A prop (not read here) so tests exercise both branches. */
  readonly live: boolean;
  readonly actorRole: ActorRole;
  readonly setRole: (role: ActorRole) => void;
}

export function PostureControl({ live, actorRole, setRole }: PostureControlProps): ReactNode {
  const t = useT('toolbar');
  if (live) {
    return (
      <span className="flex items-center gap-1">
        <span
          className="rounded border border-line px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-ok"
          title={t('liveBadgeTitle')}
          data-testid="posture-live"
        >
          {t('liveBadge')}
        </span>
        <span
          className="rounded border border-line px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-fg-muted"
          title={t('currentRole')}
          data-testid="actor-role"
        >
          <span className="sr-only">{t('currentRole')}: </span>
          {actorRole}
        </span>
      </span>
    );
  }
  return (
    <label
      className="flex items-center gap-1 rounded border border-dashed border-line px-1.5 py-0.5 text-xs text-fg-muted"
      title={t('roleSwitcherTitle')}
    >
      <span className="font-mono uppercase tracking-wide text-alert">{t('devBadge')}</span>
      <span className="sr-only">{t('actingRole')}</span>
      <select
        aria-label={t('actingRole')}
        data-testid="role-switcher"
        value={actorRole}
        onChange={(e) => setRole(e.target.value as ActorRole)}
        className="rounded bg-surface-2 px-1 py-0.5 text-xs text-fg"
      >
        {APP_USER_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </label>
  );
}
