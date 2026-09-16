# V2 CSS-POLISH REVIEW (WS-B) — evidence package for owner sign-off

**Work package:** `docs/features/V2-LIVE-OPS-COMMAND-PLAN.md` §3 (B-1 / B0 / B2 / B3)
**Branch:** `feat/v2-live-production` · **Date:** 2026-09-11 · **Role:** implementer-b
**Prime directive under test:** *a judge who saw V1 must recognise V2 instantly as the same product,
better finished.* Success = "this looks sharper and more modern". Failure = "this is a different UI".

> **Owner action required:** read §6 (baselines) and §7 (open items), then re-mint visual baselines
> yourself (`npx playwright test --update-snapshots`). Agent re-mint stays classifier-blocked; no agent
> re-minted anything for this WP.

---

## §1 What landed, and when

This WP was executed across two sessions. **The first session's work was committed by the owner inside
`65ab5ca "v2 A12"`** — it is already on the branch, not pending. The second session (this one) verified
it, found and fixed one real accessibility defect plus two interaction-consistency gaps, and produced
this document, which the first session never got to.

| Pass | Content | Where | State |
|---|---|---|---|
| 1 — token values | `app/globals.css` palette re-tune, elevation ramp, radius scale, scrollbar/selection finish, `prefers-contrast: more` block | `app/globals.css` | **committed** in `65ab5ca` |
| 2 — component finish | `transition-colors duration-150 ease-out` on interactive elements; table-row hover | 8 `app/_components/**` files | **committed** in `65ab5ca` |
| 3 — verification + fixes (this session) | contrast re-check of every pair in both themes; 1 a11y fix; 2 consistency fixes; this document | 3 files (§5) | **uncommitted** |

Nothing in pass 1 or 2 was rebuilt or re-litigated. The V1 design, information architecture, component
set, routes and copy are untouched — see the before/after screenshots in §3 and the assertions in §4.

---

## §2 Method — which background each token is actually rendered on

The B2 gate is "contrast ≥ 7:1 body, script-checked on every token pair, in BOTH themes". A token pair is
only meaningful against the background the token is *actually rendered on*, so the pairings below were
derived from the code, not assumed:

- Every BEACON status badge — severity, mode, freshness, unverified — renders through
  `BadgeShell` (`app/_components/ui/badge.tsx:20`), which **hard-codes `bg-surface`**. So
  `--sev-*`, `--warn`, `--ok`, `--unverified`, `--stale` inside a badge sit on `--surface`.
- `Card` / `Panel` (`app/_components/ui/card.tsx:11,28`) are `bg-surface`. Bare `text-alert`
  paragraphs (login, SOS, verifier, logistics, routing, draft-alert errors) therefore sit on
  `--surface`; the two header-bar sites sit on `--bg`.
- Every `bg-surface-2` container in `app/**` was enumerated. They contain only `text-fg`,
  `text-fg-muted`, `text-unverified` and `text-stale` — verified at `verifier-queue.tsx:90,105,158,520`,
  `routing-panel.tsx:36`, `decision-support.tsx:89`, `locale-switcher.tsx:39`, plus the `hover:bg-surface-2`
  states in `MapFeatureList`, `dialog`, `dropdown-menu`, `tabs` and `command-palette`.
- `--primary-fg` is text **on a coloured fill** in two button variants
  (`button.tsx:17` primary, `:19` danger → `bg-alert`), so it is checked against both fills at the 7:1 text bar.
- `--line` (hairline) and `--focus` (ring) are **non-text UI**, judged against WCAG 1.4.11 (3:1), not 7:1.

Checker: a throwaway no-dependency Node script implementing WCAG 2.x relative luminance + contrast ratio,
run in the session scratchpad (**not** added to the repo, no new dependency). Every ratio in §3 is its output.

---

## §3 Token diff table — before → after, with contrast in both themes

"Worst real pairing" = the actual rendered background that yields this token's **lowest** ratio, per §2.

### DARK

| token | before | after | changed | worst real pairing (bg) | before | after | bar | verdict |
|---|---|---|---|---|---|---|---|---|
| `--bg` | `#0b0f14` | `#0b0f14` | — | (background token) | — | — | — | — |
| `--surface` | `#121a24` | `#121a24` | — | (background token) | — | — | — | — |
| `--surface-2` | `#1a2532` | `#1a2532` | — | (background token) | — | — | — | — |
| `--overlay` | `#0e1620e6` | `#0e1620e6` | — | (background token, unreferenced — §7·D1) | — | — | — | — |
| `--line` | `#26313f` | `#2c3847` | **yes** | surface-2 (hairline) | 1.18 | 1.30 | n/a — §4·G6 | by design |
| `--fg` | `#e8eef5` | `#e8eef5` | — | surface-2 | 13.27 | 13.27 | 7:1 text | PASS |
| `--fg-muted` | `#9fb0c3` | `#a3b4c6` | **yes** | surface-2 | 6.99 | 7.31 | 7:1 text | PASS |
| `--primary` | `#4aa3ff` | `#69b3ff` | **yes** | surface | 6.65 | 7.92 | 7:1 text | PASS |
| `--primary-fg` | `#04121f` | `#04121f` | — | on `--alert` (danger button fill) | 5.64 | 7.88 | 7:1 text | PASS |
| `--focus` | `#7cc0ff` | `#7cc0ff` | — | bg (ring, non-text) | 9.92 | 9.92 | 3:1 non-text | PASS |
| `--sev-minor` | `#59c3a5` | `#59c3a5` | — | surface | 8.15 | 8.15 | 7:1 text | PASS |
| `--sev-moderate` | `#e2b53d` | `#e2b53d` | — | surface | 9.10 | 9.10 | 7:1 text | PASS |
| `--sev-severe` | `#ef8a3c` | `#f08e42` | **yes** | surface | 6.98 | 7.22 | 7:1 text | PASS |
| `--sev-extreme` | `#f2565f` | `#ff8189` | **yes** | surface | 5.23 | 7.30 | 7:1 text | PASS |
| `--alert` | `#f2565f` | `#ff8189` | **yes** | surface | 5.23 | 7.30 | 7:1 text | PASS |
| `--ok` | `#59c3a5` | `#59c3a5` | — | surface | 8.15 | 8.15 | 7:1 text | PASS |
| `--warn` | `#e2b53d` | `#e2b53d` | — | surface | 9.10 | 9.10 | 7:1 text | PASS |
| `--warn-strong` | `#e2b53d` | `#e2b53d` | — | surface | 9.10 | 9.10 | 7:1 text | PASS |
| `--stale` | `#9fb0c3` | `#a3b4c6` | **yes** | surface-2 | 6.99 | 7.31 | 7:1 text | PASS |
| `--unverified` | `#b892ff` | `#bf9dff` | **yes** | surface-2 | 6.34 | 7.00 | 7:1 text | PASS |
| `--elev-1/2/3` | *(did not exist)* | 3-step ramp | **new value** | shadow only | — | — | — | non-colour |

### LIGHT

| token | before | after | changed | worst real pairing (bg) | before | after | bar | verdict |
|---|---|---|---|---|---|---|---|---|
| `--bg` | `#f6f8fb` | `#f6f8fb` | — | (background token) | — | — | — | — |
| `--surface` | `#ffffff` | `#ffffff` | — | (background token) | — | — | — | — |
| `--surface-2` | `#eef2f7` | `#eef2f7` | — | (background token) | — | — | — | — |
| `--overlay` | `#ffffffe6` | `#ffffffe6` | — | (background token, unreferenced — §7·D1) | — | — | — | — |
| `--line` | `#d6dee8` | `#cbd6e3` | **yes** | surface-2 (hairline) | 1.21 | 1.31 | n/a — §4·G6 | by design |
| `--fg` | `#0d1826` | `#0d1826` | — | surface-2 | 15.89 | 15.89 | 7:1 text | PASS |
| `--fg-muted` | `#4a5b6e` | `#414f60` | **yes** | surface-2 | 6.20 | 7.44 | 7:1 text | PASS |
| `--primary` | `#0b6bd6` | `#0850a0` | **yes** | bg | 4.83 | 7.41 | 7:1 text | PASS |
| `--primary-fg` | `#ffffff` | `#ffffff` | — | on `--alert` (danger button fill) | 6.00 | 7.87 | 7:1 text | PASS |
| `--focus` | `#0b6bd6` | `#0b6bd6` | — | bg (ring, non-text) | 4.83 | 4.83 | 3:1 non-text | PASS |
| `--sev-minor` | `#1f8a6d` | `#155c49` | **yes** | surface | 4.27 | 7.90 | 7:1 text | PASS |
| `--sev-moderate` | `#9a6b00` | `#6d4c00` | **yes** | surface | 4.69 | 7.82 | 7:1 text | PASS |
| `--sev-severe` | `#b5521a` | `#853c13` | **yes** | surface | 5.02 | 7.92 | 7:1 text | PASS |
| `--sev-extreme` | `#c11f2c` | `#a01a25` | **yes** | surface | 6.00 | 7.87 | 7:1 text | PASS |
| `--alert` | `#c11f2c` | `#a01a25` | **yes** | bg | 5.64 | 7.39 | 7:1 text | PASS |
| `--ok` | `#1f8a6d` | `#155c49` | **yes** | surface | 4.27 | 7.90 | 7:1 text | PASS |
| `--warn` | `#9a6b00` | `#6d4c00` | **yes** | surface | 4.69 | 7.82 | 7:1 text | PASS |
| `--warn-strong` | `#8a5f00` | `#6d4c00` | **yes** | bg | 5.31 | 7.35 | 7:1 text | PASS |
| `--stale` | `#4a5b6e` | `#414f60` | **yes** | surface-2 | 6.20 | 7.44 | 7:1 text | PASS |
| `--unverified` | `#6b3fd1` | `#5c2fc5` | **yes** | surface-2 | 5.74 | 7.00 | 7:1 text | PASS |
| `--elev-1/2/3` | *(did not exist)* | 3-step ramp | **new value** | shadow only | — | — | — | non-colour |

### `prefers-contrast: more` (the block itself is new in this WP)

| theme | token | default | with `prefers-contrast: more` | on bg / surface / surface-2 | bar | verdict |
|---|---|---|---|---|---|---|
| dark | `--line` | `#2c3847` | `#667487` *(fixed this session — was `#55657a`)* | 4.04 / 3.68 / 3.26 | 3:1 non-text | **PASS** |
| dark | `--fg-muted` | `#a3b4c6` | `#c3d0dd` | 12.25 / 11.17 / 9.88 | 7:1 text | PASS |
| light | `--line` | `#cbd6e3` | `#7c8da0` | 3.20 / 3.40 / 3.03 | 3:1 non-text | PASS |
| light | `--fg-muted` | `#414f60` | `#2c3a4a` | 10.90 / 11.59 / 10.31 | 7:1 text | PASS |

**The one real accessibility defect found and fixed this session.** The committed
`prefers-contrast: more` value `#55657a` cleared 3:1 only against `--bg` (3.23). On the panels it still
measured **2.94:1 on `--surface` and 2.61:1 on `--surface-2`** — i.e. a reader who explicitly asked for
*more* contrast did not actually receive a conforming hairline where most of the UI lives. Raised to
`#667487` (the same slate hue lifted 10% toward white): **4.04 / 3.68 / 3.26**, now comparable to the
light theme's 3.20 / 3.40 / 3.03. This value is only ever applied for users who request more contrast,
so **the default appearance in both themes is unchanged** and no baseline can move because of it.

---

## §4 Rationale per group, and the honest gaps

**G1 — surfaces (`--bg`, `--surface`, `--surface-2`, `--overlay`): unchanged.** The layering was already
correct. Changing it would have moved every panel's tone, which is exactly the "different UI" failure.

**G2 — hairline (`--line`): lifted one step in both themes.** At `#26313f` the dark hairline measured
1.18:1 against `--surface-2` — effectively invisible on a raised surface, so cards lost their edge exactly
where the eye needs it. One step (`#2c3847`; light `#d6dee8` → `#cbd6e3`) makes the 1px border read as a
crisp hairline without becoming a drawn box.

**G3 — muted text (`--fg-muted`, `--stale`): the AAA gap closed.** `--fg-muted` carries 145 of the app's
labels. It measured 6.99:1 (dark) / 6.20:1 (light) against `--surface-2` — a hair under the 7:1 AAA body
bar in the one place it is most used (raised chips and hover rows). Now 7.31 / 7.44. `--stale` tracks it
by design, so it moved with it.

**G4 — accent (`--primary`) and severity/status hues.** In **light** the old ramp was the real problem:
`--primary` at 4.83:1, `--ok`/`--sev-minor` at 4.27:1, `--warn` at 4.69:1 — all merely AA, several failing
AA for small text, and white-on-`--primary` measured **5.14:1, an outright AA miss on the primary button**.
The light ramp was deepened until every one clears 7:1 as text *and* the button fill clears 7:1. In **dark**
only three moved: `--primary` (6.65 → 7.92), and `--alert`/`--sev-extreme` (5.23 → 7.30), which were the
weakest colours in the palette while carrying the most urgent meaning. Hue was held in every case —
saturation was raised rather than lowered where lightness had to move — so the palette reads as the same
palette, better tuned. **Severity semantics are untouched: every severity is still colour + distinct icon
shape + text label** (`severity-tag.tsx`), never colour alone.

**G5 — `--warn` and `--warn-strong` converge in light.** `--warn-strong` existed only because `--warn`
(`#9a6b00`, 4.41:1) was too weak for small text. Now that `--warn` itself clears 7:1, the two hold the same
value — exactly as they already did in dark. **Both tokens remain defined; nothing was renamed or removed**,
so every call site keeps working.

**G6 — the hairline is deliberately below the 3:1 non-text bar in the default themes, and that is a
judgement call the owner should see.** `--line` measures 1.30:1 (dark) / 1.31:1 (light) on `--surface-2`.
It is not raised to 3:1 because doing so would turn every card, chip, input and table rule into a drawn
box — a visible redesign, and precisely the "different UI" failure this WP exists to avoid. The controls
that use `border-line` (map zoom buttons, palette trigger, provenance trigger, external-view links) remain
identifiable without it, by fill, label and focus ring, which is the WCAG 1.4.11 test. Readers who need
more get a conforming 3.03–4.04:1 hairline via `prefers-contrast: more`. **If you disagree, this is the one
value to push back on** — it is a one-line change per theme.

**G7 — elevation, radius, scrollbar, selection: value-level only.** The three-step shadow ramp replaced
ad-hoc per-component shadows, but every call site keeps its existing `shadow-sm/md/lg` class — only the
value each resolves to changed. `--radius: 0.375rem` replaces Tailwind's bare `0.25rem` default so chips
and badges relate to the `0.625rem` panels; **no `className` was edited to achieve it**. Scrollbars and
`::selection` are token-coloured so the dock and tables stop drawing a bright OS-default bar across a dark
EOC screen.

**G8 — interaction finish.** Interactive elements ease their hover/selected state over 150 ms with
`ease-out` (inside the plan's 120–160 ms window). The global `prefers-reduced-motion` bypass already
collapses all of it to 0.01 ms and was left exactly as it was.

### Pairings that do NOT occur, reported rather than "fixed"

The script flags six token/background pairs below 7:1 that I deliberately did **not** chase, because §2
shows they are never rendered:

| pair | ratio | why it is not a defect |
|---|---|---|
| dark `--sev-severe` / `--sev-extreme` on `--surface-2` | 6.39 / 6.46 | severity text renders only inside `BadgeShell`, which is `bg-surface` (7.22 / 7.30 — PASS) |
| dark `--alert` on `--surface-2` | 6.46 | every `text-alert` site is a bare `<p>`/`<span>` inside a `Panel`/`Card` (`bg-surface`) or the header (`bg`) |
| light `--sev-moderate` / `--warn` / `--warn-strong` on `--surface-2` | 6.96 | same — badge text is on `bg-surface`; the machine-translation notice is on the header, not the `bg-surface-2` `<select>` beside it |

Chasing them would have meant lightening the alert red further — weakening the one colour reserved for
alerts — to satisfy a combination the UI never produces. **Recorded here so that any future component that
does place a severity, warn or alert colour on a raised surface knows it must re-check this pairing first.**

---

## §5 Files changed this session

All three are value-or-`className` only. No markup element was added, removed, moved or re-nested.

| file | change | nature |
|---|---|---|
| `app/globals.css` | dark `prefers-contrast: more` `--line` `#55657a` → `#667487`, + explanatory comment | **CSS value** inside an existing token, in an existing block |
| `app/_components/db-admin-link.tsx` | added `transition-colors duration-150 ease-out` to the existing `className` string | **className only** — the only interactive element in `app/**` still missing the hover easing (the file was created in `65ab5ca`, after the sweep) |
| `app/_components/ui/button.tsx` | base variant string `transition-colors` → `transition-[color,background-color,border-color,opacity]` | **className only** — the `primary` and `danger` variants hover on `opacity`, which `transition-colors` does not animate, so those two snapped while every other control eased |

No test asserts a `className` on either component (checked `button.test.tsx`, `db-admin-link.test.tsx`),
and neither change is observable in a screenshot at rest — transitions only exist mid-hover.

**Evidence images:** `docs/audit/v2-css-polish/{before,after}-{dark,light}-1280.png` (1.9 MB total, map
tiles dominate). Delete the directory if you would rather eyeball the running app than carry the bytes.

---

## §6 Visual baselines — what should move, and why each is non-structural

Baselines were **not** re-minted. `--update-snapshots` was never run. Expect movement in every visual
baseline that captures chrome, and in **both** themes:

| what moves | cause | why it is a colour/spacing delta, not structural |
|---|---|---|
| all panel/card edges | `--line` one step lighter (dark) / darker (light) | same 1px border on the same element at the same position; only the RGB of the border changes |
| all secondary/muted label text | `--fg-muted`, `--stale` one step | same glyphs, same font, same metrics, same box — fill colour only |
| links, primary buttons, meter fill | `--primary` re-tuned (large move in light) | same elements, same size; fill/text colour only |
| alert text, danger button, EXTREME/SEVERE badges | `--alert`, `--sev-extreme`, `--sev-severe` re-tuned | same glyph + same icon + same label; colour only. Severity pairing unchanged |
| every light-theme severity/status badge | light ramp deepened across the board | colour only; the badge box, icon and text are byte-identical markup |
| panels, popovers, dialogs, map buttons carrying `shadow-*` | `shadow-sm/md/lg` now resolve to the `--elev-*` ramp | shadow is painted outside the box; element geometry is unchanged. A shadow *can* change a screenshot's bounding pixels — expected, still non-structural |
| chips, badges, inputs, kbd | `--radius` `0.25rem` → `0.375rem` | 2px of corner rounding on existing elements; no size, position or layout change |
| any scroller in frame | scrollbar now thin + token-coloured | replaces the OS default bar; can alter content width by a few px where a scroller is visible |

**A structural diff — a moved, added, removed or resized panel/column/control — would be a bug in this WP.**
I found none: the before/after screenshots in `docs/audit/v2-css-polish/` show identical layout at 1280,
and the responsive probe in §8 shows identical scroll geometry at all three breakpoints.

---

## §7 Open items / PLAN-DELTAs raised rather than acted on

**D1 — `--overlay` is a dead token.** Defined in both themes (`#0e1620e6` / `#ffffffe6`) but mapped into
no `--color-*` in `@theme inline` and referenced by no `var()` anywhere in `app/**`. Removing it would be a
change to the token *set*, which B0 does not allow, so it was left exactly as-is. Owner call whether to drop
it or wire it to the map chrome.

**D2 — the hairline 3:1 judgement (G6).** Raising `--line` to the WCAG 1.4.11 non-text bar in the default
themes is a one-line change per theme but a visible one. Not taken unilaterally; flagged for your decision.

**D3 — no wrapper elements were added.** No polish in this pass needed one, so no markup PLAN-DELTA arises.

---

## §8 Verification

### Gate (run from `Phase3/`, Node v24.18.0 via nvm)

```
$ npx tsc --noEmit
src/adapters/channels/http/routes/feature-router.ts(691,46): error TS2322: ...
src/adapters/channels/http/routes/panels.test.ts(53,18): error TS2339: ...
  [11 errors total]
TSC_EXIT=2
```

**All 11 errors are in `src/adapters/channels/http/**` — WS-A's lane**, from the concurrently-running A12
DB-backed-panels work (`src/ports/panels.ts` untracked, `src/ports/index.ts` modified at the time of the
run). **Zero errors in `app/**`.** Bucketed: `11 src/adapters/`, `0 app/`. This WP changed one CSS file and
two `className` strings and cannot produce a `Promise<PanelHttpResult>` type error.

```
$ npx eslint .
ESLINT_EXIT=0        (clean, no output)
```

```
$ npx vitest run app/
 Test Files  63 passed (63)
      Tests  530 passed (530)
   Duration  44.48s
VITEST_EXIT=0
```

### Screenshots — captured from the running app

`npm run dev` came up cleanly (Next.js 15.5.22, ready in 7.5s, `GET / 200`). Captured with the repo's own
Playwright chromium against `http://localhost:3000`, theme forced through the same `data-theme` attribute
the real toggle sets, verified by computed `body` background:

| file | theme | verified `body` background |
|---|---|---|
| `docs/audit/v2-css-polish/before-dark-1280.png` | dark | `rgb(11,15,20)` = `#0b0f14` |
| `docs/audit/v2-css-polish/after-dark-1280.png` | dark | `rgb(11,15,20)` = `#0b0f14` |
| `docs/audit/v2-css-polish/before-light-1280.png` | light | `rgb(246,248,251)` = `#f6f8fb` |
| `docs/audit/v2-css-polish/after-light-1280.png` | light | `rgb(246,248,251)` = `#f6f8fb` |

The "before" pair was produced by temporarily restoring the pre-polish `app/globals.css` from
`65ab5ca~1`, letting the dev server rebuild, capturing, then restoring the working file — restore verified
byte-identical by `diff`.

**Coverage limit, stated plainly:** these are the **default COP view** (map + SitRep dock + logistics dock)
in both themes. The role-gated views (EM / VERIFIER / RESPONDER) and the modal surfaces (command palette,
provenance popover, draft-alert review, SOS form) were **not** captured — they need seeded data and an
authenticated session, which was outside the screenshot time-box. Those surfaces use the same tokens and
the same `BadgeShell` / `Panel` / `Button` primitives measured in §3, so the §6 expectations apply to them
unchanged, but **no screenshot evidence is offered for them and none should be assumed.** Views for you to
eyeball after re-mint: verifier queue (unverified badges, confidence meters, dashed `border-warn` chips),
draft-alert review (alert red on `bg-surface`), logistics board, SOS form error text, provenance popover
(mode badges), command palette, and the map legend.

### Responsive + reduced motion + RTL

Measured on the running app in both themes: **no horizontal scroll at any breakpoint.**

| breakpoint | dark `scrollWidth`/`clientWidth` | light `scrollWidth`/`clientWidth` |
|---|---|---|
| 360px | 360 / 360 — ok | 360 / 360 — ok |
| 768px | 768 / 768 — ok | 768 / 768 — ok |
| 1280px | 1280 / 1280 — ok | 1280 / 1280 — ok |

The `prefers-reduced-motion` bypass, the RTL-safe logical-property skip link, `font-feature-settings:'tnum'`
and the focus-ring rule are all unchanged from V1 and were re-read to confirm it.

---

## §9 Forbidden list — explicit per-item statement

Every item from plan §3·B0 "Forbidden", stated individually. **I did not do any of these.**

1. **Touched `src/**`, API shapes, or anything in WS-A's lane** — NOT DONE. The only files changed are
   `app/globals.css`, `app/_components/db-admin-link.tsx`, `app/_components/ui/button.tsx`, plus this doc
   and its four evidence PNGs under `docs/audit/`.
2. **New/moved/removed panel, section, column, control or route** — NOT DONE. No JSX element was added,
   removed or re-nested; no file under `app/` was created or deleted; no route touched.
3. **Information-architecture change** — NOT DONE. Same panels, same docks, same tab groups, same order.
4. **Responsive-breakpoint restructuring** — NOT DONE. No breakpoint class was added, removed or changed;
   §8 shows identical scroll geometry at 360/768/1280.
5. **New components** — NOT DONE. No new component file, no new exported component.
6. **New design language** — NOT DONE. Same tokens by name, same primitives, same layout; values only.
7. **New fonts** — NOT DONE. `--font-sans` is byte-identical; Inter Variable + Noto, self-hosted.
8. **New dependencies** — NOT DONE. `package.json` was not opened by me. The contrast checker is a
   throwaway zero-dependency script in the session scratchpad, outside the repo.
9. **Imported mock markup** — NOT DONE. Nothing was copied in from any mock or redesign.
10. **Markup edits beyond `className` / style-hook attributes** — NOT DONE. The two component edits are
    each a single string literal inside an existing `className`; §5 documents both.
11. **Added a wrapper element** — NOT DONE. No polish required one (§7·D3).
12. **`data-testid` change** — NOT DONE. No `data-testid` added, removed or renamed.
13. **i18n key change** — NOT DONE. No message key or catalog touched.
14. **ARIA name/role change** — NOT DONE. No `aria-*`, `role` or accessible name altered.
15. **Copy change** — NOT DONE. No user-visible string changed.
16. **Severity-semantic change** — NOT DONE. `SEVERITY_META` is untouched: each severity keeps its distinct
    colour **and** distinct icon shape **and** text label. Severity is never conveyed by colour alone.
17. **Ran `--update-snapshots` or `vitest -u`** — NOT DONE. Never invoked. No baseline was re-minted;
    §6 reports the expected deltas for the owner to re-mint.
18. **Ran a git command that writes** — NOT DONE. Only `git status`, `git log`, `git diff`, `git show`
     (all read-only). No commit, no stash, no checkout, no tag, no push.
