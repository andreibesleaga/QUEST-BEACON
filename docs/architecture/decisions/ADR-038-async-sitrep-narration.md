# ADR-038 — Asynchronous SitRep narration: the read path never waits for a model

- **Status:** Accepted (2026-09-10) — decided in the V2 kickoff, implemented in the same work package (A1).
- **Deciders:** Entrant (V2 locked decision §0·2, `docs/features/V2-LIVE-OPS-COMMAND-PLAN.md`) + prod-architect
- **Relates to:** ADR-001 (hexagonal ports — this is an application-layer + composition-root change, no port
  contract moves), ADR-008 (AI provider ladder), ADR-012 (config for everything), ADR-017 (the compliance
  gateway is the only model seam), CONSTITUTION Art. XII (deterministic source of truth), Art. XVI (total
  redundancy, degrade always labelled)
- **Supersedes in practice:** nothing; it removes the last blocker on `AI_MODE=cloud` in the cloud posture.

## Context

Cloud narration is unusable on the deployed product, and the reason is structural rather than incidental.

`synthesizeSitRep` narrates on the SitRep **read** path: it assembles the deterministic fact bundle, then
`await`s the compliance gateway before returning. A cloud model call takes seconds; Railway's edge kills a
request at **60 s**. Measured on the deployment (2026-08-26), `/status` hung and the operator saw nothing
at all — worse than the deterministic report they were entitled to immediately.

The narration memo (`src/adapters/compliance/narration-memo.ts`) fixed the *repeat* cost, not this: a memo
can only serve a fact set that has already been narrated once. The **first** read of every new fact set —
and live ingestion mints new fact sets continuously — still blocks on the model. So the memo made the
steady state affordable while leaving every cold path exposed to the edge timeout.

Two properties of the existing design are worth preserving exactly, because they are what makes the AI
claim defensible: the deterministic record is complete without the model (Art. XII), and any block, error
or ungrounded narration already degrades to a deterministic-only SitRep that is still fully cited (F4/F7).
The problem was never *what* we do when the model is unavailable — it was that we made the operator wait
to find out.

## Decision

**The SitRep read returns the deterministic report immediately; narration is raced against a short deadline
and, if it loses, continues in the background so the next read serves the prose.**

Three parts:

1. **A narration deadline in the use case** (`SitRepSynthesisDeps.narrationDeadlineMs`). When positive, the
   narration promise is raced against a timer. Prose that arrives inside the deadline is used exactly as
   today. If the deadline wins, the SitRep is assembled deterministically and labelled
   `aiMode: 'deterministic-only'` — the *same* honest label the AI-off and blocked paths already use, and
   the same one the UI already explains. The abandoned narration is **not** cancelled: it keeps running,
   and its result lands in the memo.
2. **Single-flight in the narration memo.** The memo now shares one in-flight promise per cache key, so
   concurrent identical requests join the same upstream call instead of starting their own. Without this,
   async mode would re-open exactly the cost leak the memo was built to close: every SSE-driven refetch of
   an un-narrated fact set would abandon its race and start *another* model call. With it, a fact set is
   narrated **at most once at a time**, no matter how many reads race for it.
3. **Composition-root wiring** (`AI_NARRATION_DEADLINE_MS`, raw env like the other narration knobs). It is
   only ever consulted when `AI_MODE=cloud|local`, because that is the only path that constructs a gateway.

### Why a deadline race rather than a fire-and-forget trigger

A "trigger, never await" design would need a second seam to ask *"is this fact set already narrated?"* —
a peek into the memo, i.e. a new port or a leak of adapter state into the application layer. Racing the
existing call needs neither: **a memo hit resolves in microseconds and wins the race**, so cached prose is
served on the very first read that can serve it, while a cold call loses and degrades. The cache lookup and
the model call are the same call; only their latencies differ, and the deadline is what reads that
difference. No port changes, no new state, no API-shape change.

### Why the default is enabled

The deadline defaults to a positive value, so the protective behaviour ships without per-environment
opt-in. This is safe for the suite by construction: test doubles resolve immediately, win the race, and
produce byte-identical results. Only a genuinely slow upstream — the exact case this ADR exists for —
behaves differently. `AI_NARRATION_DEADLINE_MS=0` restores the old fully-synchronous behaviour.

## Consequences

**Good.** The read path is bounded by the deadline instead of by the model, so the 60 s edge is
unreachable from a SitRep read; the operator always gets the deterministic report at once. Cloud AI becomes
usable in production for the first time. Single-flight makes the memo strictly stronger (it now collapses
concurrent duplicates, not only sequential ones), which also benefits the synchronous path.

**Costs and limits, stated plainly.** Prose is now *eventually* consistent: the first viewer of a brand-new
fact set sees a deterministic-only SitRep and the narration appears on a later read. That is a real
behaviour change for the operator, and it is why the label is the existing, already-explained
`deterministic-only` rather than a new "pending" state that would imply a guarantee we do not make — a
narration that is blocked, ungrounded or failing will never arrive, and the UI must not promise otherwise.
Background work continues after the response is sent, so a process that exits immediately after one read
may discard an in-flight narration; nothing is lost but the tokens already spent. Budget caps, the audit
chain, the firewall and the grounding enforcement are all untouched: the background call goes through the
identical gateway, and a cache hit is still not a model call.

**Rejected alternatives.** *Streaming the prose into the open response* — keeps the request alive, which is
precisely what the edge kills. *A job queue with a narration table* — correct at larger scale, but it adds
infrastructure and a persistence contract for a value that is worthless once its facts are stale, and the
memo's TTL already expresses that. *Raising the platform timeout* — not available, and it would make the
operator wait on the model in any case.
