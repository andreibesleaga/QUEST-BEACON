# ADR-037 — Live-Demo Delivery Increment: durable logistics, a scheduler seam, live social + vision, and a monitoring-only demo watcher

- **Status:** Accepted (2026-08-07) — §1, §2, §5 decided and implemented in session 1; §3, §4 decided
  here and implemented in session 2 (see the per-session completion notes at the end of each section).
- **Deciders:** Entrant (20 locked decisions, `docs/LIVE_DEMO_DELIVERY_PLAN.md` §0) + prod-architect
- **Relates to:** ADR-001 (hexagonal ports — every item below is an adapter or a composition-root seam,
  never a core change), ADR-012 (config for everything), ADR-013 (Drizzle behind RepositoryPort),
  ADR-008/008a (AI + vision provider ladders), ADR-023 (channels — the notifier the demo watcher reuses),
  ADR-014 (threshold-rule engine — the watcher's severity source), CONSTITUTION Art. XII (deterministic
  source of truth), Art. XIII (human-in-the-loop before any public action), Art. XIV (no PII retention),
  Art. XVI (total redundancy, degrade-labelled)
- **FR refs:** FR-LD-1…FR-LD-15 (`docs/requirements/EARS_ADDENDUM_LIVE_DEMO.md`)
- **Numbering note:** the delivery plan originally called this ADR-034; that number was already taken by
  the anticipatory-action engine, so the increment is recorded here as ADR-037.

## Context

BEACON's gates are green and the FINAL_READINESS_PLAN is fully executed, but the product still carries a
tail of **declared-but-unhonoured contracts** — the defect class this project keeps paying for. The
`docs/audit/UNIMPLEMENTED_REGISTER.md` names them precisely: routes documented and not served, a purge
executor nothing invokes, a documented ranking knob no code reads, database tables with no write path, a
vision ladder whose seven configuration variables are read by nothing. The entrant decided (plan §0) to
close them for the judged live demo rather than qualify them in prose.

This ADR records the five architectural decisions that closing them required. It is deliberately ONE ADR
for the whole increment: the alternative (four or five ADRs across three sessions) would have split a
single coherent decision — "make every declared capability real for the live demo" — across documents that
would then need to cross-reference each other to be understood.

---

## 1. Durable logistics behind the existing store switch, proven by ONE shared contract suite

**Decision.** `ResourceLogisticsPort` gains a Postgres implementation selected by the existing
`FEATURE_STORE=postgres` switch, alongside the in-memory one. Both implementations are proven by a
**single exported contract suite executed twice** — once per store.

**Why the shared suite is the load-bearing part.** Two implementations of one port, each with its own
test file, is precisely how behaviour drifts: a rule tightened in one store and not the other produces a
system that behaves differently depending on a deployment flag, and every test still passes. The shared
suite makes that divergence impossible to commit rather than merely unlikely — the same reasoning that
made `BROWSER_MIRRORED_FLAGS` a derived list instead of a re-typed one (F-24/F-140/F-141 class).

**Consequence, accepted:** the memory store keeps being the offline/air-gapped default (Art. XVI). Only
the live demo and cloud deployments run `postgres`, and the COP incident projection stays in-memory in
both — no pg incident read-model, by design.

**SitRep persistence is history, not a cache.** Persisted SitReps are an audit record; the read path stays
engine-computed per read. A stored SitRep rendered as the current picture would present stale figures as
live ones, which is the exact failure Art. XII exists to prevent.

## 2. A composition-root scheduler seam, injected rather than ambient

**Decision.** Introduce one minimal scheduler (`src/main/scheduler.ts`) owning named interval jobs, with
the timer and clock **injected**, started only from the server composition root.

**Why a seam and not a `setInterval` at the call site.** Before this increment the app had no background
work at all — the only intervals in the tree are SSE. Two capabilities needed one (the retention purge and
the demo watcher), and the wrong move would have been an ambient timer inside each module: untestable
without real time, unstoppable, and live inside every test process and Playwright gate. Injection keeps
the gates deterministic (no fake-timer library, no wall-clock dependence) and keeps job failures isolated —
a throwing job is audited and the loop continues, because a privacy sweep that dies silently is worse than
one that never ran.

**This is what makes the Art. XIV guarantee real.** The purge executor was already correct and tested; it
was simply never invoked, so "no PII beyond the incident lifecycle" held only if a human remembered. A
guarantee that depends on someone remembering is not a guarantee.

## 3. Social intake: keyless Mastodon as the demo source, Bluesky as a bring-your-own-account rung

**Decision.** Add a keyless Mastodon adapter as the live vetted-social source; keep Bluesky as an
authenticated rung that activates only when an operator supplies their own credentials.

**Why not Bluesky alone.** Its keyless public endpoint now answers 403, so the previously-live rung is
dead. A demo whose social corroboration depends on the entrant holding an account is fragile in exactly
the situation that matters (a judge reproducing the run). Mastodon's public instance API needs no key at
all, so the capability is reproducible by anyone.

**Unchanged by this decision:** social content is corroboration-only, low source-authority, never
auto-trusted, conflicting signals flagged rather than merged, aggregate-only with no PII retention
(Art. XIV). The adapter is a new source, not a new trust level.

## 4. A real vision ladder with two keyless-first imagery routes

**Decision.** Implement the documented `VISION_*` configuration for real: an OpenRouter cloud provider, a
local `VISION_API_BASE` rung, and the recorded-fixture MockVision as the floor. Imagery resolves by
reference scheme — `gibs:` (NASA GIBS, keyless, default), `cdse:` (Copernicus Data Space, free account),
`fixture:` (offline).

**Why keyless-first.** The vision claim must be demonstrable without the entrant's credentials, for the
same reproducibility reason as §3. Copernicus gives true Sentinel-2 scenes for those who register; GIBS
requires nothing and is therefore the default.

**Art. XII is enforced structurally, not by prompt.** The model classifies; any numeric claim it returns
is discarded by an output validator before the finding is built. Vision output stays advisory, cited,
confidence-scored, and can never auto-alert — it feeds a human decision. Consent and PII-screening remain
mandatory on the SOS-photo path (satellite imagery carries no PII, and the code says which is which).

## 5. A monitoring watcher that is structurally incapable of alerting

**Decision.** Add an env-gated demo watcher which, on the first critical deterministic signal in the
watched region, sends **one monitoring notification** through the existing notifier — labelled
"AUTOMATED MONITORING (not an approved public alert)".

**Why this does not weaken Art. XIII, and why that is a structural claim rather than a promise.** The
watcher has no path to public alerting: it emits through `NotificationPort` (PII-redaction, semantic
firewall, hash-chained audit), never constructs a raw transport, never creates or mutates an Alert, and
never touches the alert store. `AlertSinkPort.emit` remains type-gated to an approved ACTUAL alert with a
named approver, so an unapproved alert cannot even be expressed. A test asserts the alert store is never
touched. Severity comes from the existing deterministic threshold evaluation — no new judgment logic, and
no LLM anywhere in the path (Art. XII).

**Why it exists at all.** The demo needs a real notification to arrive while someone is watching, without
staging a fake approval. Labelling it as monitoring is what keeps the demonstration honest: the audience
sees the system noticing something, not the system alerting the public.

**Alternatives considered.** (a) Trigger the existing approved-alert broadcast on a timer — rejected: it
would fabricate a human approval, which is the one thing Art. XIII forbids. (b) Pre-record the message —
rejected: it would demonstrate nothing. (c) No demo notification — rejected by the entrant; the push
channel is a graded capability and a capability nobody sees scores nothing.
