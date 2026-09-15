# BEACON — User Guide (what it is, what you see, what to trust)

> For anyone who opens BEACON: a citizen, a volunteer, a responder, a verifier, an emergency manager.
> No setup knowledge is assumed. The operator's step-by-step workflow is `docs/OPERATOR_GUIDE.md`;
> deploying and configuring it is `docs/RELEASE_GUIDE.md`.

## 1. What BEACON is

BEACON is a **common operating picture** for wildfires and floods: one browser screen that shows, for a
chosen region, where the hazard is, what lies in its path, what the sources say about it, and what the
responders are doing about it. It is open source (Apache-2.0), runs on free and open data, and can run on
one laptop with no internet at all.

Three rules shape everything you see, and they are enforced by the software rather than by policy:

1. **Every number is computed by a deterministic engine, never by an AI.** The situation report is
   narrated by a language model only from facts the engine already produced, and every sentence carries
   the citation it came from. If the AI is off or unavailable, the same facts are shown as a plain list.
2. **Every fact says where it came from and how old it is.** Each layer, each report, each figure has a
   provenance badge — LIVE (fetched now from the publisher), CACHED (the last good fetch), MOCK (a
   recorded sample, shown only when a live source is unavailable and always labelled), DB (an operator
   entered it). The status strip shows the data's age separately from the clock.
3. **A named human approves every public action.** A public alert is only ever drafted by the system;
   a verifier or an emergency manager approves it, and the approval is written to an audit ledger.

## 2. The screen

- **Map** — the hazard footprint (fire perimeters, hotspots, flood extents, gauges), lifeline
  infrastructure (hospitals, power, cell sites), exposure (what is inside or near the hazard), shelters,
  weather, cameras, and the projected spread or crest, each layer switchable with its own freshness badge.
  Hover a point for its name and what it is. The **legend** explains colours; colour is never the only
  signal (there is always a shape, icon or label).
- **Situation Report (right dock, top)** — the cited summary for the selected incident: what is
  happening, who is exposed, what the sources say, what is likely next. Every line has a *provenance*
  control that opens the exact source, timestamp and mode. "Deterministic-only" means the AI narrator was
  not used; the facts are the same.
- **Logistics (right dock, bottom)** — resources, shelters with capacity, tasking, pre-positioning
  suggestions and the mutual-aid (EDXL-RM) exchange, for signed-in responders and above.
- **Status strip (top)** — active incidents, items waiting on your role, how many sources are live, and
  the age of the data. When the data is old the strip says so.
- **Region selector** — California, Romania, Spain, Greece, Philippines ship as demo zones; a region is
  configuration, not code.
- **Language** — 14 locales including right-to-left (Arabic, Urdu); machine-translated catalogues say
  so in the UI. Timestamps are shown in the region's time zone.
- **Theme** — dark by default (night operations), light available.

## 3. Roles — what each can do

| Role | Can | Cannot |
|---|---|---|
| **PUBLIC** (no sign-in) | See the whole public picture; send an SOS/report with consent; request an evacuation route | See precise report positions; see the verification queue; approve anything |
| **RESPONDER** | Everything above, plus precise report positions, resources, tasking, pre-positioning, cameras' operator views | Verify reports or approve alerts |
| **VERIFIER** | Everything above, plus triage and verify public reports, draft and review alerts | Emit a public alert |
| **EM** (emergency manager) | Everything, including approving an alert (which produces the CAP message), all-clear, threshold rules, the database admin link | — |

Signing in uses a named account (id + password) issued by the operator of your deployment. A session
lives in the tab you signed in from and ends with it.

## 4. Reporting an emergency (public)

1. Click the map where it is, or allow the browser's location.
2. Describe what you see; attach a photo if you have one; tick the consent box (required — without it
   nothing is stored).
3. Send. You get a receipt: your report is **UNVERIFIED** until a verifier looks at it, and your precise
   position is visible only to responders. Reports are purged on a schedule after the incident; the
   receipt tells you the date.

A report never becomes a public alert by itself. A verifier confirms it; an emergency manager approves an
alert; only then is a CAP alert produced — and it says who approved it.

## 5. Reading the badges honestly

- **LIVE** — fetched from the publisher in the last refresh cycle (every few minutes on a live
  deployment).
- **CACHED** — the publisher could not be reached this cycle; this is the last good answer, with its own
  timestamp.
- **MOCK** — no live or cached answer exists; a recorded sample is shown so the layer is not blank. It is
  never presented as current. On a live deployment a region with no live hazard simply shows **no
  incident** and says so.
- **ASSUMED** (outage layer) — an inference from hazard ∩ infrastructure, not an observation.
- **Estimated / projected** — a first-order model (spread cone, crest projection), labelled as such.
- **Deterministic-only** — the AI narrator is off; the facts stand.

## 6. Working offline and installing the app

On deployments that enable it, BEACON installs from the browser menu (*Install* / *Add to Home Screen*)
and keeps the last public picture on your device. When your connection drops, the screen still opens and
a banner says *"Offline — showing the picture saved at HH:MM"* (the oldest saved part on screen; or
*"no saved picture yet"* when nothing was saved). Saved copies are per language on current browsers
(Chrome 87+, Firefox 132+, Safari 18.4+); older browsers save nothing rather than risk the wrong language.
You can look but not act: reports, verifications, approvals and sign-in need the server. Details:
`docs/OPERATOR_GUIDE.md` §4a.

## 7. Privacy

- Consent is required to store a report; the consent and the purge date are part of the record.
- Precise positions are shown only to responders and above; the public sees a generalised position.
- Photos are screened for personal data before a vision model sees them; the model's output is advisory.
- Prompts and model outputs are never sent to third parties except the configured model provider, and
  the compliance proxy blocks anything that carries personal data.
- Full policy: `docs/RESPONSIBLE_DATA.md`.

## 8. What BEACON is not

- Not an official warning channel. It drafts alerts for humans who hold that authority.
- Not a forecast model. Projections are first-order and labelled.
- Not a substitute for the publisher. Every layer links to its source; when in doubt, follow the link.
- Not complete offline. The offline copy is read-only and public.

The complete list of known limitations is `docs/SPEC.md` §13 and `docs/audit/UNIMPLEMENTED_REGISTER.md`.
