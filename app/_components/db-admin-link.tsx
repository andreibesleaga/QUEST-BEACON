'use client';
// BEACON — EM-only DB-admin link (V2·A7; ADR-040). Renders in the toolbar's account cluster, beside the
// sign-in control, when the AUTHENTICATED SESSION READ came back carrying `dbAdminUrl`.
//
// THERE IS NO ROLE CHECK IN THIS FILE, AND THAT IS THE DESIGN. The server decides who may see the Directus
// console and answers `GET /me` accordingly (EM only, and only when `DB_ADMIN_URL` is configured); the URL
// is never `NEXT_PUBLIC_*`, so it is not in the bundle an anonymous visitor downloads and there is nothing
// here for a client-side check to protect. A component that re-derived the gate from `actorRole` would look
// safer while being strictly weaker: it would be guarding a value everybody already had.
//
// Absent field ⇒ absent link, with no placeholder and no explanation — unlike a degraded data panel, an
// operator affordance the caller was never granted should not announce itself (Art. XIV, least privilege).
// Its own component rather than markup inside LoginControl so the session read mounts only where it is
// needed and both surfaces stay independently testable.
import type { ReactNode } from 'react';
import { useMe } from '../_lib/hooks.js';

/**
 * The plan's own label (§2·A7). Hardcoded English, NOT an i18n key: the V2 catalogs are frozen (plan §0·8)
 * and adding a key would touch all 14 — the same convention the routing panel's operator strings already
 * follow. Raised as a PLAN-DELTA rather than done silently.
 */
const DB_ADMIN_LABEL = '⛁ DB Admin ↗';

export function DbAdminLink(): ReactNode {
  const me = useMe();
  const dbAdminUrl = me.data?.dbAdminUrl;
  if (dbAdminUrl === undefined || dbAdminUrl === '') return null;
  return (
    <a
      href={dbAdminUrl}
      target="_blank"
      // The admin console opens in a tab that must never reach back into a signed-in EM's COP through
      // `window.opener`, and must not leak the COP URL as a referrer to it.
      rel="noopener noreferrer"
      data-testid="db-admin-link"
      className="rounded border border-line px-1.5 py-0.5 text-xs text-fg-muted transition-colors duration-150 ease-out hover:text-fg"
    >
      {DB_ADMIN_LABEL}
    </a>
  );
}
