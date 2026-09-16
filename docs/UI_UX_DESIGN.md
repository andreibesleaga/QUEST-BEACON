# BEACON — UI/UX Design Charter (modern, accessible, crisis-first)

> **Single source of truth for the frontend look, feel, interaction, and accessibility bar.** E8 tasks
> trace here; `docs/LIBRARIES.md` pins the implementing libraries (all free/OSS, self-hostable — the UI
> must look identical offline/air-gapped: **no CDN fonts/scripts ever**). Adopted 2026-07-04 (D-35).
> Principle: **calm, modern, instant — and invisible until needed.** Crisis UX = clarity under stress,
> never decoration over signal.

## 1. Visual language (modern 2026, not trendy-fragile)
- **Dark-first, light-capable.** High-contrast dark theme is the default (night EOC ops); full light theme
  via tokens; `prefers-color-scheme` respected, manual toggle persisted. All colors as **semantic design
  tokens** (T-345) — never raw hex in components.
- **Typography:** self-hosted **Inter** (variable, via @fontsource) — `font-feature-settings: "tnum"` for
  tabular numbers in data tables/badges; fluid type scale with `clamp()`; generous line-height; max ~70ch
  reading measure in panels.
- **Surface & depth:** flat, layered surfaces with subtle elevation (1px borders + low-alpha shadows);
  **soft-glass panels** (blur + translucency) ONLY for overlays/menus atop the map — with solid fallbacks
  (`@supports` + reduced-transparency). Rounded-lg radii, consistent 4/8px spacing grid.
- **Color = meaning, never alone:** hazard severities keep the one-meaning-per-color/shape rule (T-346);
  status always pairs color + icon/shape + text. Alert red is reserved for alerts only.
- **Iconography:** **lucide** icon set (consistent stroke, tree-shaken). No emoji in operational UI.
- **Data-viz:** deck.gl layers + minimal chart accents share the token palette; freshness/degraded states
  render as badges with icon + label (never a bare timestamp or color).

## 2. Interaction & motion
- **Micro-interactions with restraint:** 120–200 ms ease-out transitions on hover/focus/panel dock,
  skeleton shimmer while loading, live-region toast on SSE events. **`prefers-reduced-motion` fully
  honored** (motion becomes opacity/instant). Implemented with **motion** (Framer Motion) — no bespoke
  animation code.
- **Instant feel:** optimistic UI on verify/task actions (TanStack Query mutations + rollback); skeletons
  (never spinners >300 ms); map layer toggles apply <100 ms from local state.
- **Command palette (⌘K/Ctrl-K)** via **cmdk**: jump to region/incident/panel, run the act-menu actions,
  toggle layers — the power-user path that also demos beautifully.
- **Keyboard-first:** every action reachable by keyboard (shortcuts documented in a `?` overlay);
  map feature selection has a keyboard/list alternative (not drag/pointer-only — WCAG 2.2 dragging).
- **Toasts/notifications:** **sonner** — polite `aria-live`, action-able (e.g. "DRAFT alert created →
  Review"), never block the map.
- **Touch & field use:** ≥44×44 px touch targets (exceeds WCAG 2.2's 24 px minimum), thumb-reachable
  primary actions on phone, `env(safe-area-inset-*)` respected, hover-independent (all hover info also
  on tap/focus).

## 3. Accessibility — **WCAG 2.2 AA** (upgraded from 2.1; current W3C Recommendation)
- All 2.1 AA criteria **plus** 2.2 additions: **2.4.11 Focus Not Obscured**, **2.5.7 Dragging
  Alternatives** (map pan/draw have button/keyboard equivalents), **2.5.8 Target Size ≥24px** (we use
  44px), **3.2.6 Consistent Help**, **3.3.7 Redundant Entry** (SOS form never asks twice),
  **3.3.8 Accessible Authentication** (no cognitive puzzles).
- **Radix UI primitives** for every interactive component (dialog, menu, popover, tabs, toggle, tooltip)
  — correct ARIA/focus/roving-tabindex for free; never hand-rolled widgets.
- Visible `:focus-visible` rings (token-colored, 2px, offset); skip-to-content; landmarks + headings
  hierarchy; screen-reader map alternative = the same data as an accessible list/table view (T-391).
- Contrast: ≥4.5:1 text, ≥3:1 UI/graphics — enforced by the token palette and axe CI gate (F13 → 2.2 AA).

## 4. Simplicity & responsiveness (fully responsive AND functional)
- **Progressive disclosure:** default view = map + minimal chrome; SitRep/logistics dock, collapse, or
  overlay by breakpoint (D-27). Show only what the active hazard needs; advanced controls one level deep.
- **Breakpoints:** desktop-EOC (multi-panel docked) · tablet (tabbed panels) · phone (bottom-sheet panels,
  FAB act-menu). Container queries for panel-internal layout; **no horizontal scroll ever**; text never
  truncates critical data (wraps or tooltips-with-focus).
- **Empty/degraded/error states are designed**, not default: every layer/panel has a labeled
  "cached/derived/unavailable + why + freshness" state (Art. XVI — never a dead-end or blank).
- **Performance is UX:** code-split panels, virtualized lists (logistics/reports), memoized deck.gl
  layers; TTTP < 10 s (F14) and instant interactions are acceptance criteria, not aspirations.

## 5. Enforcement (traces)
Tokens + theme → E8·T-345/347 · legend/badges → T-346/355/356 · layout/docking/sheets → T-350 ·
primitives/palette/toasts/motion → **T-345a/T-389a (new)** · a11y gates (now **WCAG 2.2 AA**) →
T-390/391/392 + F13 · visual regression (both themes, 3 breakpoints) → T-393 · PWA/offline-identical →
T-350a. Libraries pinned in `docs/LIBRARIES.md` (Radix, motion, cmdk, sonner, lucide, @fontsource/inter).
