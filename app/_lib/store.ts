// BEACON — Zustand UI store (E8·T-351; ADR-002/FR-1; S3·U3 session persistence). Owns transient UI/view
// state ONLY: which region is active, which incident is selected, which map layers are on, the theme, and
// the actor role. The canonical/server state lives in Postgres and is read via TanStack Query (hooks.ts) —
// never duplicated here. The store is a pure state machine: every action is a small, unit-testable
// transition. The ONE exception to "transient": the auth/session slice (actorRole + authToken) is mirrored
// to sessionStorage so a reload does not sign the operator out mid-incident — see the block below.
import { create } from 'zustand';
import { APP_USER_ROLES, LAYER_IDS, type ActorRole, type LayerId, type Theme } from './types.js';

/**
 * Default layer visibility: the two primary hazard layers + reports on; overlays off until toggled.
 *
 * `storm` is deliberately NOT in the on-set (ADR-032 §4): it is region-specific (only a coastal cyclone zone
 * populates it) and, more importantly, its forecast cone risks being read as an impact area if it appears
 * unasked — so it is opt-in, and the moment it is toggled on the mandatory uncertainty caveat rides with it.
 * Same discipline already applied to `prediction`.
 */
function defaultLayers(): Record<LayerId, boolean> {
  const on = new Set<LayerId>(['fire', 'flood', 'reports']);
  const layers = {} as Record<LayerId, boolean>;
  for (const id of LAYER_IDS) layers[id] = on.has(id);
  return layers;
}

/** BEACON's default region — the seeded flagship (CA wildfire) so the COP populates on first load (scope discipline). */
export const DEFAULT_REGION_ID = 'us-ca';

// ── Session persistence (S3·U3) ────────────────────────────────────────────────
// sessionStorage, DELIBERATELY not localStorage: the session survives a reload of the same tab but dies
// with it — a signed-in session must never outlive the browsing session it was minted in. Persisting the
// bearer token here is the plan-accepted decision (LIVE_DEMO_DELIVERY_PLAN §S3 Lane U3): it stores nothing
// the browser does not already hold for this session, and the server re-authorizes every request anyway
// (a stale/forged token verifies to PUBLIC, fail-closed — rbac.ts).

/** The persisted auth slice: exactly what the store keeps, nothing more. */
interface PersistedSession {
  readonly actorRole: ActorRole;
  readonly authToken?: string;
}

/** The sessionStorage key the auth slice lives under (also asserted by e2e/session-persistence.spec.ts). */
export const SESSION_STORAGE_KEY = 'beacon.session';

/** sessionStorage, or undefined when unreachable — SSR (no window on the server) or a browser whose
 *  storage ACCESS itself throws (hardened privacy modes). Undefined means "skip", never "crash". */
function sessionArea(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Read + validate the persisted session. ANY malformation — corrupted JSON, a non-object, an
 *  out-of-vocabulary role, a non-string token — degrades to undefined (clean defaults), never a throw.
 *  Role validation matters: RBAC-gated components key off actorRole, so tampered storage must not put an
 *  arbitrary string there (same least-privilege rule as login-control's toActorRole). */
function readSession(): PersistedSession | undefined {
  const area = sessionArea();
  if (area === undefined) return undefined;
  try {
    const raw = area.getItem(SESSION_STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { actorRole, authToken } = parsed as { actorRole?: unknown; authToken?: unknown };
    if (!(APP_USER_ROLES as readonly unknown[]).includes(actorRole)) return undefined;
    if (authToken !== undefined && typeof authToken !== 'string') return undefined;
    return { actorRole: actorRole as ActorRole, ...(authToken !== undefined ? { authToken } : {}) };
  } catch {
    return undefined;
  }
}

/** Best-effort write — a full/blocked storage must never break the in-memory state transition. */
function writeSession(session: PersistedSession): void {
  try {
    sessionArea()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* the in-memory session still works; persistence is a convenience, never load-bearing */
  }
}

/** Sign-out: REMOVE the persisted session entirely — no token and no elevated role left behind. */
function clearSession(): void {
  try {
    sessionArea()?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* nothing stored ⇒ nothing leaked */
  }
}

export interface UiState {
  readonly activeRegionId: string;
  readonly selectedIncidentId: string | undefined;
  readonly layers: Record<LayerId, boolean>;
  readonly theme: Theme;
  readonly actorRole: ActorRole;
  /** A verified bearer token from the demo IdP (POST /auth/dev-login). When set, API calls send it as
   *  `Authorization: Bearer <token>` (true per-user identity); when unset they fall back to x-beacon-role. */
  readonly authToken: string | undefined;
  readonly setRegion: (regionId: string) => void;
  readonly toggleLayer: (layer: LayerId) => void;
  readonly selectIncident: (incidentId?: string) => void;
  /**
   * The last point the operator clicked on the map, as `[lon, lat]` (GeoJSON axis order — the same order
   * the domain uses everywhere, so no call site has to remember a second convention). Added 2026-08-04:
   * the SOS form and the evac-route form both asked for coordinates as typed numbers, which on a map
   * product is the one place a human should never have to type. Consumers pre-fill from this and stay
   * editable — it is a convenience, never a lock.
   */
  readonly pickedPoint: readonly [number, number] | undefined;
  readonly setPickedPoint: (point: readonly [number, number] | undefined) => void;
  readonly setRole: (role: ActorRole) => void;
  readonly setAuthToken: (token: string | undefined) => void;
  readonly setTheme: (theme: Theme) => void;
}

/** The persistable slice of the current state (omits an undefined token — exactOptionalPropertyTypes). */
function sessionOf(s: Pick<UiState, 'actorRole' | 'authToken'>): PersistedSession {
  return { actorRole: s.actorRole, ...(s.authToken !== undefined ? { authToken: s.authToken } : {}) };
}

// The auth slice is rehydrated ONCE, synchronously, at store creation — on the server readSession() is a
// no-op (no window), so SSR always renders the least-privilege defaults and the client takes over.
const restored = readSession();

export const useUiStore = create<UiState>((set, get) => ({
  activeRegionId: DEFAULT_REGION_ID,
  selectedIncidentId: undefined,
  layers: defaultLayers(),
  theme: 'dark', // dark-first crisis palette (UIUX §1)
  actorRole: restored?.actorRole ?? 'PUBLIC', // least privilege until authenticated (GET /me)
  authToken: restored?.authToken, // no bearer until the demo dev-login mints one (offline demo stays header-based)
  pickedPoint: undefined, // nothing picked until the operator clicks the map

  // Selecting a new region clears the incident selection — a stale incident from another region is invalid.
  // The picked point goes with it: a coordinate from California is not a sane default in Romania.
  setRegion: (regionId) =>
    set({ activeRegionId: regionId, selectedIncidentId: undefined, pickedPoint: undefined }),
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  selectIncident: (incidentId) => set({ selectedIncidentId: incidentId }),
  setRole: (role) => {
    set({ actorRole: role });
    writeSession(sessionOf(get())); // the acting role survives a reload of this tab (S3·U3)
  },
  setPickedPoint: (point) => set({ pickedPoint: point }),
  setAuthToken: (token) => {
    set({ authToken: token });
    // Sign-out (token cleared) removes the persisted session entirely; sign-in persists it.
    if (token === undefined) clearSession();
    else writeSession(sessionOf(get()));
  },
  setTheme: (theme) => set({ theme }),
}));
