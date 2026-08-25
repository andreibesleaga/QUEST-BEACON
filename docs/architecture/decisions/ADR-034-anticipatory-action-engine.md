# ADR-034 — Anticipatory action engine: EAP-as-validated-data + deterministic ensemble trigger + governance ledger + drill mode

- **Status:** Accepted (2026-07-26)
- **Deciders:** Entrant + prod-architect + ops-security (master-plan wave MW-D)
- **Relates to:** ADR-014 (declarative threshold-rule engine — the edge-triggered, DRAFT-only precedent this
  extends rather than replaces), ADR-012 (config-for-everything), ADR-010 (CAP/EDXL boundary + `CAP_EMIT_MODE=draft`
  / `IPAWS_ENABLED=off`), ADR-017 (compliance proxy — the "structurally unreachable raw transport" posture),
  ADR-022 (observability + the hash-chained `AUDIT_EVENT` this ledger reuses), ADR-025 (JWT identity — the
  recorded authorizer), ADR-026 (HITL broadcast — notifier-only injection; broadcast is a strictly post-emit
  side-effect), ADR-033 (likelihood classes / Outlook — the classes this engine's evidence maps onto),
  ADR-035 (predicted-impact methods — what an activation shows next to it), ADR-036 (warning excellence — the
  `EXERCISE` CAP status this ADR depends on), CONSTITUTION Art. XII (deterministic source of truth — the LLM
  never decides a trigger), Art. XIII (HITL before any public or operational action), Art. XIV (responsible
  data — the ledger holds no PII), Art. XVI (total redundancy — replay from cached files, air-gapped)
- **FR refs:** FR-AA-1…FR-AA-5 (`docs/requirements/EARS_FINAL_VERSION.md:165-169`; FU-13, FU-14, FST-3,
  FEV-10, FEV-11, FUW-4 at `:171-185`) and FR-GOV-1…FR-GOV-3
  (`docs/requirements/EARS_FINAL_VERSION.md:249-251`; FEV-19, FST-4, FOP-4, FUW-7 at `:253-261`)
- **Threat model:** new rows required at S03 — trigger-config supply chain (an EAP file is boot-validated
  data, never code: no `eval`, no path traversal outside `config/eap/`), ledger-integrity extension of TB7
  (`docs/architecture/THREAT_MODEL.md:205`), and drill-mode egress isolation (a new TB2 row beside T2.9
  broadcast side-effect)

## Context

### Why now, and what this actually adds

`CURRENT-MASTER-PLAN.md:93-99` locks **D1 Anticipatory Action Engine** as the conceptual crown of the
differentiator wave, and `CURRENT-MASTER-PLAN.md:109-112` locks **D5 Trust & governance** (ledger, SOP chain
with delegated fallback, DRILL mode). Both land in wave MW-D (`CURRENT-MASTER-PLAN.md:154-158`). The detail
annex frames the strategy: UN **Early Warnings for All** has four pillars — risk knowledge, monitoring/
forecasting, dissemination, preparedness/response — and the literature says early-warning systems actually
fail on **Pillars 3–4, the last mile** (`CURRENT-PLAN-3-DIFFERENTIATORS.md:28-32`). Anticipatory action is
the Pillar-4 answer: turn a forecast into **pre-authorized** action before impact, per the IFRC Early Action
Protocol structure and the OCHA/CERF three-pillar model — pre-agreed trigger + pre-agreed activities +
pre-arranged resources (`CURRENT-PLAN-3-DIFFERENTIATORS.md:43-49`).

BEACON already has the two halves and nothing joining them:

| Half that exists | Where | What is missing |
|---|---|---|
| Edge-triggered, deterministic, DRAFT-only rule firing | `src/application/threshold-evaluation/threshold-evaluation.ts:55` (`evaluateRule`), `:106` (`buildDraftAlert`), DRAFT hardcoded at `:111` | fires **one alert**; has no notion of a *protocol*, a lead time, a two-stage readiness/activation ladder, a resource ceiling, an authorizer, or a stop |
| A pre-positioning suggester | `src/application/pre-positioning/pre-positioning.ts:176` (`suggestPrePositioning`) | is only ever called with an already-present hazard extent (`src/adapters/channels/http/routes/logistics.ts:253`); nothing drives it from a *forecast* trigger |
| A hash-chained append-only audit writer | `src/domain/audit-event.ts:73` (`linkHash`), `:112` (`verifyAuditLink`), `src/adapters/compliance/audit-chain.ts:53` (`append`), `:72` (`verify`) | records `action`/`target`/`actor`/`at` only — no place to bind forecast evidence |

So the differentiator is **not** "we can compute a probability" (GloFAS already publishes one) and **not** "we
can alert on a threshold" (ADR-014 already does). It is: **a replayable, evidence-showing, human-gated trigger
engine whose activations are wired into pre-positioning and written to a tamper-evident ledger, and which can
be rehearsed end-to-end in a mode that structurally cannot reach a real channel.** No incumbent COP
(DisasterAWARE / Everbridge / Genasys / FloodHub) exposes the trigger arithmetic, the protocol state, and the
stop mechanism as inspectable artifacts (`CURRENT-PLAN-3-DIFFERENTIATORS.md:34-39`) — they are cloud
black boxes. That inspectability is the claim, and it is only credible if the evidence is *shown*, which is
why §7's panel is a hard deliverable, not a nice-to-have (`CURRENT-MASTER-PLAN.md:96-99`).

### Findings from the codebase (verified, and they change the design)

1. **`schemas/threshold-rule.schema.json` is dead.** No `.ts`/`.tsx` file references it; threshold rules are
   only ever constructed in TypeScript (`src/main/feature-seed.ts:72-87`) or read from Postgres
   (`src/adapters/persistence/repositories.ts:207`). It has also **drifted** from the domain type it claims to
   describe: `hysteresis`/`cooldown` are *required duration strings* in the schema
   (`schemas/threshold-rule.schema.json:43-52`, required list `:8`) but *optional numbers* in the domain
   (`src/domain/threshold-rule.ts:19-20`), `scope` is required-uuid vs optional, and `enabled` exists only in
   the schema. **Consequence:** ADR-014 is the right *semantic* precedent (declarative, edge-triggered,
   DRAFT-only) but is **not** an executed "config as validated data" precedent, and must not be copied as one.
2. **The executed precedent is the compliance policy loader.**
   `src/adapters/compliance/policy-loader.ts:34` (`loadPolicy`) reads `config/policies.yml`
   (`:12`), compiles `schemas/policies.schema.json` (`:13`) with Ajv draft-2020-12 (`:39`, `ajv.compile` `:42`),
   validates (`:43`) and **throws fail-fast at boot** with the aggregated issues (`:47`). The manifest loader is
   the Result-returning sibling (`src/adapters/_shared/manifest.ts:40-48`, consumed by
   `src/main/adapter-registry.ts:90`). A memoized generic validator already exists:
   `src/adapters/interop/schema-validator.ts:24` (`validatorForFile`), `:13` (`validatorForSchema`), `:32`
   (`formatErrors`). **There is no generic "read a config dir + validate + return Result" helper and no
   `config/eap/` directory** — the reader half is new code, templated on `loadManifest`.
3. **The wired GloFAS adapter does not expose ensemble members.** The adapter consumes the *GloFAS reporting
   points* product, whose documented attributes include a **derived exceedance probability** and a tendency
   (`src/adapters/sources/glofas/glofas-acl.ts:42-43`, documented `:16-21`) — and both are **dropped at the
   ACL**: the `definedOnly({…})` literal in `glofasMapper` (`src/adapters/sources/glofas/glofas-acl.ts:82-90`)
   has no `probability`/`tendency` key, and the canonical `Gauge` has no field to receive them
   (`src/domain/gauge.ts:23-29`); `probability` appears nowhere else in `src/` outside that ACL. There is no
   per-member discharge series anywhere in the repo. ADR-033 §1 records the same defect and fixes the *drop*;
   this ADR consumes whichever signal survives it.
   **Consequence:** the member-counting evaluator cannot be fed by the currently wired source. It is designed
   generic over an ensemble input, and where only a derived probability exists the engine records that
   honestly instead of fabricating a member count (§3).
4. **No aggregate records its own transition history.** All three existing state machines return
   `{...entity, status}` with no log: `src/domain/public-report.ts:62-67` (adjacency map) + `:138-146`
   (`transitionPublicReport`), `src/domain/incident.ts:29-33` + `:51-56`, `src/domain/resource-task.ts:12-14` +
   `:61-69`. **Consequence:** "SHALL record every transition" (FST-3,
   `docs/requirements/EARS_FINAL_VERSION.md:177-178`) is satisfied by the **ledger**, not by a history array
   on the entity.
5. **The audit chain's hashed payload has no evidence slot.** `AuditPayload` is
   `{actorId?, action, target, at}` + cost fields (`src/domain/audit-event.ts:22-27`), and
   `AuditAppendInput` mirrors it (`src/adapters/compliance/audit-chain.ts:13-24`). FR-GOV-1 demands inputs,
   source/forecast version, probability evidence, decision, authorizer and stop
   (`docs/requirements/EARS_FINAL_VERSION.md:253-255`). **Consequence:** one additive optional field is needed
   (§5), chosen so existing chain hashes stay byte-identical.
6. **No `FEATURE_*` flag currently reaches the browser.** `FEATURE_CAMERAS` / `FEATURE_EXTERNAL_VIEWS` are
   declared (`src/config/index.ts:89-90`) and never read anywhere; only `NEXT_PUBLIC_*` crosses
   (`app/page.tsx:54`, `:60`) or a flag is threaded as a prop (`app/_components/panels/sos-form.tsx:53`).
   **Consequence:** the Anticipatory panel's flag needs an explicit `NEXT_PUBLIC_` mirror or a prop — there is
   no existing server-flag→panel wiring to copy.

## Decision

### 1. An EAP is validated DATA in files, never code (FR-AA-1 / FU-13)

**Location: `config/eap/<region>-<hazard>.json`, one protocol per file.** Schema:
`schemas/eap.schema.json` (new, S03, Ajv draft-2020-12, `additionalProperties:false`). Loader:
`src/adapters/persistence/eap-registry.ts` — a directory read + per-file validate, templated on
`loadManifest` (`src/main/adapter-registry.ts:90-100`, Result-returning, `fileURLToPath(new URL(…))` path
resolution, `makeAdapterError('CONFIG', …, {retryable:false})`), reusing `validatorForFile`
(`src/adapters/interop/schema-validator.ts:24`) so the schema compiles once and is memoized. Invalid file ⇒
typed `CONFIG` error naming the file and the Ajv reasons (`formatErrors`,
`src/adapters/interop/schema-validator.ts:32`); the registry **fails fast at composition** like
`loadPolicy` (`src/adapters/compliance/policy-loader.ts:47`) rather than silently skipping a protocol — a
half-loaded EAP set is worse than no EAP set.

The schema carries **all six IFRC Early Action Protocol elements** as recorded in the annex
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:46-49`), one-to-one:

| IFRC EAP element (annex) | EAP config field | Notes |
|---|---|---|
| Two-stage trigger (READINESS longer-lead → ACTIVATION shorter-lead) | `triggers.readiness`, `triggers.activation` | each: `{ source, parameter, threshold, comparator, minMembersFraction, leadTimeHours }` |
| Pre-agreed action list | `actions[]` | `{ id, label, kind: 'PREPOSITION'\|'TASK'\|'NOTIFY_INTERNAL', resourceKind?, targetScopeRef? }` |
| Pre-arranged resource ceiling | `resourceCeiling` | `{ maxResources, maxByKind?, currency?: never }` — no monetary/donor field exists (see ADR-035 §4 PERMANENTLY-OUT) |
| Roles / activation mechanism | `approval` | `{ authorizerRole, fallbackRole, fallbackAfterMinutes }` (§6) |
| Geographic scope | `scope` | `{ regionId, geometry \| geometryRef }` — `regionId` validated against `config/regions.json` ids |
| **Stop mechanism** | `stop` | `{ conditions[], authorizerRole, maxDurationHours }` — **required by the schema**, not optional |

**Data-not-code is enforced, not asserted.** The schema admits only scalars, enums from closed lists, and
geometry objects — no expression string, no template, no path, no URL is accepted anywhere in an EAP; there
is therefore nothing for an `eval`/`Function`/dynamic-`import` to consume, and the linter's existing
no-`eval` posture needs no new rule to be effective. File selection is a directory listing filtered to
`*.json` under a fixed resolved base path — an EAP id never becomes a path segment, closing the traversal
class that NFR-F7 names for locales and regions (`docs/requirements/EARS_FINAL_VERSION.md:330`).

**Files, not the database — justified.** Master plan §5.5 is explicit: "EAP/trigger configs live in config
files (not DB) to stay air-gapped-friendly" (`CURRENT-MASTER-PLAN.md:209-210`), restated as NFR-F6
(`docs/requirements/EARS_FINAL_VERSION.md:329`). Concretely: (a) the default composition is
`FEATURE_STORE=memory` (`src/config/index.ts:36`) — a DB-resident EAP would make the engine **absent** in the
offline/air-gapped path that Art. XVI makes a required acceptance test; (b) an EAP is a
signed-off-by-a-human doctrine document, so it belongs in version control where a diff is reviewable, next to
`config/policies.yml` and `config/regions.json`; (c) replay determinism (§3) requires the protocol to be
pinned by commit, which a mutable table cannot give. Sample EAPs ship for the five locked zones
(`CURRENT-MASTER-PLAN.md:156-157`) and are **illustrative** (§8).

### 2. Protocol state machine: `IDLE → READINESS → ACTIVATED → STOPPED` (FR-AA-3 / FST-3)

A new pure domain entity `src/domain/eap-state.ts` following the **`public-report.ts` pattern** — the only
existing machine with an explicit adjacency map and documented terminal states
(`src/domain/public-report.ts:62-67`, `:138-146`):

```
EAP_STATES        = ['IDLE','READINESS','ACTIVATED','STOPPED']
LEGAL_TRANSITIONS = { IDLE:['READINESS','ACTIVATED'], READINESS:['ACTIVATED','STOPPED','IDLE'],
                      ACTIVATED:['STOPPED'], STOPPED:[] }   // STOPPED is terminal for the episode
```

`IDLE→ACTIVATED` is legal (a sudden-onset forecast can satisfy both stages in one cycle);
`READINESS→IDLE` is the de-escalation path when the readiness condition clears before activation;
`STOPPED` is terminal per episode — a new episode is a new protocol run with a new id, mirroring
`firedForEpisode` in the existing rule state (`src/application/threshold-evaluation/threshold-evaluation.ts:25`).
`transitionEap` throws `InvalidTransition` (`src/domain/errors.ts`, as `transitionPublicReport` does at
`src/domain/public-report.ts:143`). Per finding 4, **the transition history lives in the ledger** (§5), not on
the entity; the entity carries only `{ eapId, state, episodeId, enteredAt }`.

### 3. Trigger evaluator: deterministic ensemble member-counting, evidence-first (FR-AA-2 / FU-14 / FUW-4)

New use-case directory `src/application/anticipatory-action/` (pure; `src/application` may not import
adapters — enforced by `.dependency-cruiser.cjs:8-10`), exporting:

```ts
evaluateEapTriggers(input: EapEvaluationInput): EapEvaluationResult   // pure, no I/O, no clock read
```

`EapEvaluationInput` = `{ eap, priorState, forecast: TriggerEvidence, now }` (`now` **injected**, never read —
the project-wide fixed-clock discipline). The evidence discriminated union is the heart of the design:

| Evidence kind | Shape | Produced from | Likelihood mapping |
|---|---|---|---|
| `ENSEMBLE_MEMBER_COUNT` | `{ kind, membersOverThreshold, memberTotal, threshold, parameter, forecastVersion, issuedAt, leadTimeHours }` | a cached per-member ensemble file (GloFAS ensemble discharge, 51 members per the annex, `CURRENT-PLAN-3-DIFFERENTIATORS.md:50-53`) | `membersOverThreshold / memberTotal` vs the EAP's `minMembersFraction` |
| `SOURCE_DERIVED_PROBABILITY` | `{ kind, probability, parameter, forecastVersion, issuedAt, leadTimeHours }` | the wired GloFAS reporting-points product (`src/adapters/sources/glofas/glofas-acl.ts:42`) once ADR-033 stops dropping it at the ACL | the source's own value, labeled as source-provided |

**The evaluator never converts between the two kinds.** A `SOURCE_DERIVED_PROBABILITY` never gains a
`memberTotal`, and an `ENSEMBLE_MEMBER_COUNT` fraction is never presented as a calibrated probability (§8).
This is FUW-3's rule from the prediction wave — never invent a probability a source did not provide
(`docs/requirements/EARS_FINAL_VERSION.md:156-157`) — applied one layer up. Both kinds map onto the
**ADR-033 likelihood classes** (`POSSIBLE`/`LIKELY`/`VERY_LIKELY`, `CURRENT-MASTER-PLAN.md:87-88`) through a
single deterministic classifier so the Outlook and the anticipatory panel cannot disagree.

`EapEvaluationResult` = `{ eapId, episodeId, from, to, fired: 'READINESS'|'ACTIVATION'|null, evidence, suggestedActions, reason }`.
Unlike `RuleEvalOutcome` (`{fired, state}` only —
`src/application/threshold-evaluation/threshold-evaluation.ts:36-37`), the result carries the **arithmetic that
produced it**: the counted members, the total, the threshold, the comparator, the forecast version and the
lead time. That object is simultaneously the panel's chart input (§7), the ledger's evidence (§5), and the
replay fixture (§9) — one artifact, three consumers, no restatement.

**Replay determinism is a hard test, not an aspiration** (master plan §5.7c,
`CURRENT-MASTER-PLAN.md:216-217`; acceptance test 3,
`docs/requirements/EARS_FINAL_VERSION.md:339`): the function is pure, takes no clock and no I/O, and the
ensemble input is a cached file — so identical `(eap, priorState, forecast, now)` must yield a
**deep-equal** result including the evidence object. Cross-run stability is asserted by hashing the
canonical JSON of the result with the domain's existing key-sorting canonicalizer
(`src/domain/audit-event.ts:59-67`) and comparing against a committed golden digest.

**Hysteresis/cooldown are reused, not reinvented.** The EAP's dwell/de-dup semantics are ADR-014's
`hysteresis`/`cooldown` fields applied per stage; the existing `evaluateRule` state shape
(`src/application/threshold-evaluation/threshold-evaluation.ts:21-26`) is the model. This keeps flap-safety
identical between the two engines instead of shipping a second, subtly different definition.

### 4. HITL: activation SUGGESTS into the existing pre-positioning seam and can do nothing else (FR-AA-4 / FEV-10)

**The exact receiving seam is `suggestPrePositioning`
(`src/application/pre-positioning/pre-positioning.ts:176-179`).** On `fired === 'ACTIVATION'`, the engine
calls it with the EAP's `scope.geometry` as `PrePositioningInput.extent`
(`src/application/pre-positioning/pre-positioning.ts:44`) and the region's registered resources/shelters as
`candidates` (`:42`), receiving `readonly PrePositioningSuggestion[]`
(`src/application/pre-positioning/pre-positioning.ts:53-62`, assembled `:192-195`). Those suggestions —
annotated with the EAP action ids they satisfy — are what the panel renders and what a human may act on.

Three independent reasons the engine **cannot** dispatch, task, or broadcast:

1. **`suggestPrePositioning` is a pure ranking function.** It takes candidates + an extent + a `SpatialPort`
   and returns a ranked list (`:176-196`). It holds no port that writes. There is no code path from it to
   `ResourceLogisticsPort.task` (`src/ports/logistics.ts:32`).
2. **Tasking requires a human HTTP action against a VERIFIED incident.** `advanceTask`
   (`src/adapters/logistics/memory-logistics.ts:72`) gates on the incident being VERIFIED (`:77-79`), and a
   task must be created at `PROPOSED` (`:49-51`, domain default `src/domain/resource-task.ts:38`) then stepped
   one state at a time (`src/domain/resource-task.ts:56-57`). The anticipatory use-case lives in
   `src/application/` and **cannot import an adapter at all** — `.dependency-cruiser.cjs:8-10` forbids
   `^src/application` → `^(src/adapters|src/main)` as an `error`, checked by `npm run boundaries`
   (`package.json` `"boundaries": "depcruise src && madge --circular src"`).
3. **Alerting stays DRAFT-only.** If an activation should also warn, it goes through the unchanged ADR-014
   path — `buildDraftAlert` hardcodes `capStatus: 'DRAFT'`
   (`src/application/threshold-evaluation/threshold-evaluation.ts:111`), and only `approveAlert` with a human
   `approvedBy` can produce ACTUAL (`src/domain/alert.ts:76-84`), which alone satisfies `EmittableAlert`
   (`src/ports/logistics.ts:41-44`). Broadcast remains a strictly post-emit side-effect of the approval
   handler (ADR-026; `src/adapters/channels/http/routes/interop.ts:132-141`). **An activation is not an
   emission** (FUW-4, `docs/requirements/EARS_FINAL_VERSION.md:184-185`).

### 5. Governance ledger: the existing hash chain, extended by exactly one optional field (FR-GOV-1 / FEV-19)

Every evaluation, transition, activation, approval and stop appends to a hash-chained append-only log via
`AuditChain.append` (`src/adapters/compliance/audit-chain.ts:53`), whose link is the **domain** hash
(`linkHash`, `src/domain/audit-event.ts:73`; verified by `verifyAuditLink`, `:112`; FNV-1a over
key-sorted canonical JSON at the domain level, SHA-256 wrapped by the persistence layer per
`src/domain/audit-event.ts:1-4`). This is the same writer the CAP emitter already uses — `alert-sink.ts` appends
`ALERT_EMIT` **before** recording the emission (`src/adapters/alerting/alert-sink.ts:72-86`) — so trigger
decisions and alert emissions land in one verifiable chain, not two.

**The one additive change (finding 5):** an optional `evidenceDigest?: string` on `AuditPayload`
(`src/domain/audit-event.ts:22-27`), on `toPayload` (`:77-88`) and on `AuditAppendInput`
(`src/adapters/compliance/audit-chain.ts:13-24`). The digest is the canonical-JSON hash of the full
`EapEvaluationResult` (§3), computed with the canonicalizer already in that file (`:59-67`); the full evidence
record is stored in an append-only `TriggerLedger` beside the chain. This choice matters for three reasons:
(a) `canonicalize` **omits `undefined` keys** (`src/domain/audit-event.ts:64`), so every existing chain and
every committed golden audit hash is byte-identical when the field is absent — the extension is provably
non-breaking; (b) the chain stays small and PII-free (Art. XIV) while still *binding* the evidence
cryptographically — tampering with the stored evidence breaks the digest comparison; (c) evidence is
content-addressed, so the ledger entry, the panel, and the replay fixture reference the same bytes.

Ledger entry fields, mapped to FEV-19's list: `action` ∈ `{EAP_EVAL, EAP_TRANSITION, EAP_ACTIVATE, EAP_APPROVE,
EAP_STOP}`; `target` = `eap:<id>#<episodeId>`; `actorId` = the JWT-identified authorizer for the human actions
(ADR-025) and absent for machine evaluations; `at` = the injected clock; `evidenceDigest` = inputs +
source/forecast version + probability evidence + decision + stop reason. `verify()`
(`src/adapters/compliance/audit-chain.ts:72-75`) fail-closes the whole chain on any gap or tamper.

### 6. SOP approval chain with a delegated fallback approver (FR-GOV-2 / FST-4)

The EAP's `approval` block (§1) declares `authorizerRole`, `fallbackRole` and `fallbackAfterMinutes`. While an
activation approval is pending, the engine reports the **currently responsible** role: `authorizerRole` until
`enteredAt + fallbackAfterMinutes`, `fallbackRole` after — a pure function of the injected clock, so it is
deterministic and testable. This is the WMO Checklist "delegation of authority" gap the annex names
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:123`). Roles are the existing `AppUser` roles (`src/domain/app-user.ts`),
so RBAC is unchanged (`src/adapters/channels/http/rbac.ts`); the fallback **widens who may approve, never
whether approval is required**. The ledger records which role actually acted (§5), satisfying FST-4's "SHALL
record which one acted" (`docs/requirements/EARS_FINAL_VERSION.md:256-257`).

### 7. DRILL mode: banner-labeled end-to-end and STRUCTURALLY unable to reach a real channel (FR-GOV-3 / FOP-4 / FUW-7)

FUW-7 is explicit that convention is not acceptable: enforcement must be "structural (type-level/composition),
not only by convention" (`docs/requirements/EARS_FINAL_VERSION.md:260-261`). `DRILL_MODE=on`
(`featureFlag(['off','on'],'off')`, `src/config/index.ts` — same helper as `:89-91`) selects a **three-layer**
guarantee, no layer of which is a runtime `if` in a send path:

**Layer 1 — type-level, and CAP-native.** Drill artifacts carry `capStatus: 'EXERCISE'`. CAP v1.2's `status`
enum genuinely includes `Exercise`, and the repo already documents this: `schemas/cap-v1.2.schema.json`
restricts `status` to `["Actual","Draft"]` with the note *"Full CAP enum also allows Exercise|System|Test."*
Adding `EXERCISE` to `CAP_STATUSES` (`src/domain/alert.ts:9`) and to `CapStatusValue`
(`src/adapters/interop/cap-mapper.ts:17`) — an additive schema/enum delta at S03, coordinated with ADR-036 —
makes the isolation fall out of a guard that **already exists and is already tested**:
`EmittableAlert` requires the `'ACTUAL'` literal (`src/ports/logistics.ts:41-44`), so
`AlertSinkPort.emit` (`:48`) **will not compile** with an EXERCISE alert (Gate 2, `tsc --noEmit`), and
`asEmittable` returns `null` for anything not ACTUAL (`src/adapters/alerting/alert-sink.ts:54-58`) so the
runtime narrowing refuses it too. We are reusing the project's existing type-level HITL gate rather than
inventing a parallel one — the strongest possible argument that it will not rot.

**Layer 2 — composition-level partition, enforced at build time.** A drill run is assembled by a **separate
composition function** `buildDrillDeps` (`src/main/build-drill.ts`, new) that constructs
`sink: makeRecordingSink()` and **does not call `makeBroadcastDeps` at all**
(`src/main/feature-seed.ts:158-168`) — the notifier/subscriber pair is absent by *construction*, not by a
falsy flag, so there is no branch to mis-set. `makeRecordingSink` is a new `AlertSinkPort` in
`src/adapters/alerting/recording-sink.ts` that appends to the audit chain and records the document exactly as
today's sink does (`src/adapters/alerting/alert-sink.ts:61-100`, which is *already* `sink:'MOCK'` with no
network send, `:26`, `:87-88`) — so the drill path exercises the real serializer, the real Ajv validation
(`alertToCap` → `validatedByFile`, `src/adapters/interop/cap-mapper.ts:151`) and the real chain.
This partition is then made **unreachable-by-import** with a new `.dependency-cruiser.cjs` forbidden rule
beside the three existing ones (`.dependency-cruiser.cjs:4-10`):

```js
{ name: 'drill-never-reaches-a-live-channel', severity: 'error',
  from: { path: '^src/(application/anticipatory-action|main/build-drill)' },
  to:   { path: '^src/adapters/channels/messaging/telegram' } }
```

Because `depcruise` runs in `npm run boundaries` and boundary violations are `error`, a future edit that
imports a live transport into the drill subgraph **fails the build**, not a review.

**Layer 3 — the structural test that proves it** (master-plan acceptance test (d),
`CURRENT-MASTER-PLAN.md:216-217`; EARS acceptance test 4,
`docs/requirements/EARS_FINAL_VERSION.md:340`). Three assertions, in
`tests/architecture/drill-isolation.test.ts` (beside the existing structural test `tests/architecture/f9-domain-purity.test.ts`):

1. **Module-graph assertion** — run `depcruise --output-type json` over `src/main/build-drill.ts` and assert
   the reachable module set contains **zero** modules under `src/adapters/channels/messaging/`. This is the
   assertion that "structurally" means something: it is about the import graph, not about behaviour under one
   input.
2. **Egress assertion** — execute a full drill episode (load a sample EAP → evaluate → activate → approve →
   emit → stop) with `globalThis.fetch` replaced by a spy that throws, and assert the spy was never called and
   the episode completed. Zero live network is already the project-wide test rule.
3. **Type-level assertion** — an `expect-type`/`@ts-expect-error` case proving
   `sink.emit(exerciseAlert)` does not type-check, so Layer 1 cannot silently regress.

**Labeling (FOP-4).** Every drill artifact carries `exercise: true`; the API envelope
(`{data, provenance[], freshness, meta?}`) gets `meta.exercise`; the UI renders a persistent banner via the
existing panel shell (`app/_components/ui/card.tsx` `Panel`) and every exported document is prefixed
`EXERCISE — NOT A REAL EMERGENCY`. Label and isolation are independent: the banner is for humans, Layers 1–3
are for the machine.

**Drill mode doubles as the demo engine.** This is deliberate and it is the reason drill mode is worth the
effort twice over: MW-E's shot list needs a *repeatable, on-camera, deterministic* activation
(`CURRENT-MASTER-PLAN.md:163-166` — "drill activation" is an explicit shot), and the FEATURE→SHOT traceability
matrix makes any feature without a visible moment an MW-E blocker (`CURRENT-MASTER-PLAN.md:166-169`). A drill
run over a committed historical ensemble fixture is exactly that: same input, same numbers, every take
(§3's replay determinism is what makes the demo reproducible). It also lets a judge run the flagship
differentiator live without any possibility of emitting a real warning.

### 8. UI deliverable: the Anticipatory panel (FR-AA-5 / FEV-11)

Required, not optional — the master plan calls it out so "the engine is fully visible on-camera, not
backend-only" (`CURRENT-MASTER-PLAN.md:96-99`). `app/_components/panels/anticipatory-panel.tsx`, exported
from the panels barrel (`app/_components/panels/index.ts`) and mounted as a **new tab** beside the existing
SitRep/Decision/Draft-alerts tabs (`app/page.tsx:214-235`) — the same thin seam ADR-032's storm layer uses.
Per FEV-11 (`docs/requirements/EARS_FINAL_VERSION.md:182-183`) it shows, per EAP:

- current state (`IDLE`/`READINESS`/`ACTIVATED`/`STOPPED`) as **text + shape + colour**, never colour alone
  (ISO 22324 / WCAG 1.4.1 discipline, ADR-036 §3);
- the **members-over-threshold evidence chart** — `membersOverThreshold` of `memberTotal` with the threshold
  line, or, for `SOURCE_DERIVED_PROBABILITY`, the source's own value labeled as such (never rendered as a
  member count);
- **lead time** to the triggering stage, and the forecast version + issue time;
- the **activation/stop history** for the episode, read from the ledger, each row showing the authorizer (or
  the fallback role that acted) and the evidence digest;
- the suggested pre-agreed actions from §4, each with an explicit "suggestion — requires approval" affordance.

Per finding 6 there is no server-flag→panel path to copy: the flag is `FEATURE_ANTICIPATORY` in
`src/config/index.ts` (server authority) with a `NEXT_PUBLIC_FEATURE_ANTICIPATORY` mirror for UX gating
(precedent `app/page.tsx:60`), documented as UX-only exactly as `FEATURE_CITIZEN_STREAM` is
(`docs/architecture/CONFIGURATION.md:49`). Default is **on-but-DRAFT-only-by-design**
(`CURRENT-MASTER-PLAN.md:206-207`).

## Verification

| # | What is verified | Concrete test / gate |
|---|---|---|
| V1 | EAP files are schema-valid data; an invalid one fails fast and names the file | `src/adapters/persistence/eap-registry.test.ts` — valid fixture loads; missing `stop` block rejected; unknown property rejected (`additionalProperties:false`); malformed JSON ⇒ typed `CONFIG` error. Mirrors `src/adapters/compliance/policy-loader.ts` test posture |
| V2 | No EAP field can carry code or a path | `schemas/eap.schema.json` unit test asserting every string field is either an enum or a `pattern`-constrained id, plus a repo grep test that `src/application/anticipatory-action/` contains no `eval`/`new Function`/dynamic `import(` |
| V3 | **Replay determinism** (acceptance test 3, `docs/requirements/EARS_FINAL_VERSION.md:339`) | `tests/redundancy/trigger-replay.test.ts` (the "redundancy-pattern" acceptance suite, beside `tests/redundancy/redundancy-acceptance.test.ts`) — the same cached ensemble fixture evaluated twice is deep-equal, and its canonical digest (`src/domain/audit-event.ts:59-67`) matches a committed golden |
| V4 | Member counting is arithmetic, never invention | `src/application/anticipatory-action/*.test.ts` — table-driven `(membersOverThreshold, memberTotal, minMembersFraction) → fired`; boundary cases at exactly the fraction; a `SOURCE_DERIVED_PROBABILITY` input **never** yields a `memberTotal` in the result |
| V5 | State machine legality + terminality | `src/domain/eap-state.test.ts` — every legal edge accepted, every illegal edge throws `InvalidTransition`, `STOPPED` accepts nothing (pattern of `src/domain/public-report.test.ts`) |
| V6 | An activation cannot dispatch, task, or broadcast | `npm run boundaries` (`.dependency-cruiser.cjs:8-10` `application-no-adapters`) + a unit test asserting the activation result contains only suggestions and that `suggestPrePositioning` was the sole call; plus the existing VERIFIED-incident tasking gate test (`src/adapters/logistics/memory-logistics.ts:77-79`) |
| V7 | Ledger is tamper-evident and the extension is non-breaking | `src/domain/audit-event.test.ts` — appending without `evidenceDigest` reproduces the **pre-change** hashes byte-for-byte; with it, mutating the stored evidence breaks the digest match; `AuditChain.verify()` fail-closes on a spliced entry (`src/adapters/compliance/audit-chain.ts:72-75`) |
| V8 | SOP fallback is deterministic and recorded | pure-function test over the injected clock at `t < fallbackAfterMinutes` and `t ≥`; ledger assertion that the acting role is recorded |
| V9 | **Drill isolation, structurally** (acceptance test 4, `docs/requirements/EARS_FINAL_VERSION.md:340`) | `tests/architecture/drill-isolation.test.ts` (beside the existing structural test `tests/architecture/f9-domain-purity.test.ts`) — (a) depcruise-JSON module-graph reachability from `src/main/build-drill.ts` to `src/adapters/channels/messaging/**` is **empty**; (b) full drill episode with a throwing `fetch` spy records zero calls; (c) `@ts-expect-error` on `sink.emit(exerciseAlert)`; plus the new `drill-never-reaches-a-live-channel` depcruise rule failing `npm run boundaries` if violated |
| V10 | Drill labeling is end-to-end | `meta.exercise` asserted on the API envelope; panel test asserting the banner is in the accessible tree; export test asserting the `EXERCISE — NOT A REAL EMERGENCY` prefix |
| V11 | Panel a11y + i18n | axe zero serious/critical under `en` + `ar` (RTL) + one CJK locale (NFR-F8, `docs/requirements/EARS_FINAL_VERSION.md:331`); state conveyed by text+shape, asserted not colour-only |
| V12 | Flag isolation | `FEATURE_ANTICIPATORY=off` ⇒ panel absent, engine not composed, all other gates still green (NFR-F5, `docs/requirements/EARS_FINAL_VERSION.md:328`) |

## Consequences

**Positive.** The forecast→pre-authorized-action gap closes with **one new pure use-case directory, one new
domain entity, one new config schema+loader, one new panel and one additive audit field** — no core surgery,
because the receiving seam (`suggestPrePositioning`, `src/application/pre-positioning/pre-positioning.ts:176`),
the DRAFT-only alert path (`threshold-evaluation.ts:111`), the type-level emit gate
(`src/ports/logistics.ts:41-44`) and the hash chain (`src/domain/audit-event.ts:73`) all already exist and are
already tested. Drill mode's isolation reuses the *existing* HITL type guard instead of a parallel mechanism,
so it cannot drift away from the real emit path. The evidence object is one artifact serving the panel, the
ledger and the replay fixture. And the whole engine runs air-gapped from files and cached forecasts (Art. XVI).

**Negative / accepted.** (a) The member-counting evaluator's richest evidence kind has **no wired live source
today** (finding 3) — it ships from cached/fixture ensemble files, which is honest and demo-sufficient but is
*not* a live GloFAS ensemble subscription; (b) `AuditPayload` is touched, i.e. a domain type on the audit path
changes — mitigated by V7's byte-identity assertion, but it is still a change to the project's most
integrity-sensitive type; (c) `CAP_STATUSES` gains a value, which forces a `schemas/cap-v1.2.schema.json`
enum delta and a coordinated ADR-036 change — a lockstep edit set, not a local one; (d) five sample EAPs are
five more config artifacts to keep truthful at MW-E; (e) drill mode is a second composition path, so every
future channel must be considered against Layer 2 — the depcruise rule is what makes that failure loud
instead of silent.

**Honest limitations (must appear in the consolidated SPEC "Known limitations" section,
`CURRENT-MASTER-PLAN.md:223-226`).**

1. **A member fraction is not a calibrated probability.** `membersOverThreshold / memberTotal` is the fraction
   of ensemble members exceeding a threshold — an uncalibrated, model-relative signal. It is displayed as a
   count over a total (never as a percentage chance of the event), and the master plan already lists exactly
   this caveat (`CURRENT-MASTER-PLAN.md:225`). BEACON does no calibration, no bias correction and no
   verification against observed outcomes; "calibrated probabilistic modelling of our own" is explicitly out
   of scope (`docs/requirements/EARS_FINAL_VERSION.md:348`).
2. **The shipped EAPs are illustrative, not endorsed.** The US/RO/PH/ES/GR samples
   (`CURRENT-MASTER-PLAN.md:156-157`) are structurally faithful to the IFRC EAP element list
   (`CURRENT-PLAN-3-DIFFERENTIATORS.md:46-49`) but their thresholds, actions, ceilings and roles are
   **invented for demonstration** and are **not** approved by, endorsed by, or derived from any National
   Society, hydromet service or civil-protection authority. Every EAP surface states this; a real deployment
   replaces the file with its own signed-off protocol.
3. **Lead time is the source's, not ours.** `leadTimeHours` comes from the forecast product's own horizon; the
   engine does not model hazard travel time (`hazardArrival` remains the separate MW-C computation).
4. **No transition history on the aggregate.** History is reconstructed from the ledger; if the ledger store is
   lost, only the current state survives. The in-memory chain does not outlive the process by default (the
   same accepted "demo now, durable-later" posture ADR-026 records for the subscriber registry).
5. **The engine cannot verify that anyone acted.** It records suggestions, approvals and stops. Whether a
   pre-agreed action physically happened is outside BEACON's observation.

## Alternatives considered

- **Extend `ThresholdRule` instead of adding an EAP entity** — rejected: a rule is a single stateless edge
  condition (`src/domain/threshold-rule.ts:13-21`) with no protocol, lead time, two-stage ladder, ceiling,
  roles or stop; overloading it would either bloat the rule for every existing consumer or fork its semantics.
  ADR-014's *semantics* are reused (edge-triggered, DRAFT-only, hysteresis/cooldown) while the aggregate is new.
- **EAPs in Postgres with a CRUD editor** — rejected: breaks the air-gapped default
  (`FEATURE_STORE=memory`, `src/config/index.ts:36`), breaks replay pinning, and makes the doctrine
  un-reviewable as a diff; contradicts the locked master-plan decision (`CURRENT-MASTER-PLAN.md:209-210`).
  A reviewed file + version control *is* the approval workflow at this scale.
- **Copying `schemas/threshold-rule.schema.json` as the "config as validated data" template** — rejected on
  finding 1: it is never loaded by any code and has drifted from its own domain type
  (`schemas/threshold-rule.schema.json:43-52` vs `src/domain/threshold-rule.ts:19-20`). Copying it would
  propagate a dead, inconsistent pattern. The executed pattern is
  `src/adapters/compliance/policy-loader.ts:34-47`.
- **Deriving a member count from the GloFAS reporting-point probability** (e.g. `round(p × 51)`) — rejected
  outright: that is an invented figure (Art. XII) and would violate FUW-3
  (`docs/requirements/EARS_FINAL_VERSION.md:156-157`). The two evidence kinds stay disjoint (§3).
- **A runtime `if (drillMode) return;` guard inside the send path** — rejected: FUW-7 forbids
  convention-only enforcement (`docs/requirements/EARS_FINAL_VERSION.md:260-261`), a boolean in a hot path is
  one bad merge away from inversion, and it would leave the *import* of a live transport in the drill graph.
  Layers 1–3 make the failure a compile error or a build failure instead.
- **A separate `DrillAlert` entity distinct from `Alert`** — considered, not chosen: it would duplicate every
  alert field and every serializer, and the drill would then exercise a *copy* of the emit path rather than the
  real one — defeating the purpose. `capStatus: 'EXERCISE'` on the real entity keeps one code path and gets
  the type-level refusal for free from `EmittableAlert` (`src/ports/logistics.ts:41-44`).
- **Recording transitions on the EAP entity as a history array** — rejected: no aggregate in the codebase does
  this (finding 4), an entity-local array is not tamper-evident, and the ledger already must record the same
  facts for FR-GOV-1. One record, one place.
- **Letting the LLM summarize the trigger decision as part of the decision** — rejected (Art. XII, FUW-4). The
  narrator may *describe* an already-computed, already-ledgered decision, exactly as it narrates SitRep facts;
  it never participates in producing `fired`, the evidence, or the state transition.

## Implementation status

Not started — this ADR is the S02 architecture record for wave MW-D (`CURRENT-MASTER-PLAN.md:154-158`).
Implementation follows at S03 (schemas: `schemas/eap.schema.json`, the `EXERCISE` enum delta,
`AuditPayload.evidenceDigest`; `CONFIGURATION.md` + `.env.example` rows for `FEATURE_ANTICIPATORY`,
`NEXT_PUBLIC_FEATURE_ANTICIPATORY`, `DRILL_MODE`) and S04/S05+ under the golden-thread
requirement→spec→test→code discipline. Sibling records: ADR-033 (likelihood classes this engine maps onto),
ADR-035 (the impact figures shown beside an activation), ADR-036 (the CAP `EXERCISE` status and lifecycle this
ADR depends on).
