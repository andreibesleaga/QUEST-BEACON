# Epic E6 — LLM ladder · VisionPort · AI Compliance Proxy · Cost guardrails · Observability

> Owner personas: **ops-security · prod-safety-engineer · eng-ml** (tests **eng-qa**) · Wave W2 · IDs
> `E6·T-240…T-292` · **ALL tasks [SEC]/SECURITY-HIGH.** FR-15 (CORE): a mandatory proxy in front of every
> LLM+Vision call. Fitness fns **F16** (stamp/fail-closed), **F17** (budget soft/HITL), **F19** (cost
> attribution), **F3** (LLM never computes). Safety = **fail-closed**.
>
> **⛔ STRICT SEQUENTIAL SAFETY CHAIN — never [PARALLEL] within it, each impl gated by its RED test:**
> policy loader (T-241) → AICompliancePort+stamp (T-256) → role-scope (T-258) → [breaker T-260 / rate-limit
> T-262] → firewall-injection (T-264) → firewall-blocked-cmds (T-266) → fail-closed wrapper (T-268) →
> policy-as-code (T-270) → PII detect/redact (T-272) → PII fail-closed (T-274) → hash-chained audit (T-276)
> → 403/503 dispatch (T-278). The proxy MUST exist before any E5/E7 LLM/Vision consumer.
>
> *Note: E6 IDs T-240…T-249 overlap E5's numerically — disambiguated by epic.*

| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-240 | Failing test: `policies.yml` validates vs `policies.schema.json` at boot | eng-qa | — | W2 | [SEC] {policy-as-code} | FR-15/ADR-017/F10/CM-C33 | valid passes; bad-version rejected |
| T-241 | Implement fail-fast policy loader (validates `policies.yml`) | ops-security | T-240 | W2 | [SEC] {policy-as-code} | ADR-017/F10/CM-C33 | boot aborts on schema violation; returns typed Policy |
| T-242 | Failing test: unknown/missing required policy key aborts boot | eng-qa | T-241 | W2 | [SEC] {policy-as-code} | ADR-017/U5/CM-C33 | removing `budget` block → fail-fast throw |
| T-243 | Failing test: `LLMPort` contract (narrate-only, no tools) | eng-qa | — | W2 | [SEC] {ai-safety-guardrails} | ADR-007/F3/CM-C5 | asserts no tool-invocation method exists |
| T-244 | Implement `LLMPort` interface + typed request/response VOs | eng-ml | T-243 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/CM-C5 | response carries model tier + usage fields |
| T-245 | Failing test: LiteLLM adapter calls `default` (Groq) tier | eng-qa | T-244 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/CM-C16 | env `LLM_TIER_DEFAULT` routes to Groq id |
| T-246 | Implement LiteLLM adapter default-tier call (env-switchable provider) | eng-ml | T-245 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/CM-C16 | provider/model/base from env only |
| T-247 | Failing test: fallback `default→fallback` (Haiku) on error | eng-qa | T-246 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/CM-C16 | Groq failure descends to `claude-haiku-4-5` |
| T-248 | Implement ladder descent to `fallback` tier | eng-ml | T-247 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/CM-C16 | fallback green; descent logged |
| T-249 | Failing test: ladder descends `fallback→local` (Ollama) | eng-qa | T-248 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/CM-C16 | both cloud tiers failing → local Ollama |
| T-250 | Implement ladder descent to `local` Ollama tier | eng-ml | T-249 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/CM-C16 | no egress on local rung |
| T-251 | Failing test: all tiers down → deterministic-only rung | eng-qa | T-250 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/F3/CM-C16 | AI-disabled returns deterministic-only marker, never dead-ends |
| T-252 | Implement deterministic-only final rung (no narrative, numbers retained) | eng-ml | T-251 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/F3/CM-C16 | degradation labeled |
| T-253 | Failing test: LLM output rejected on schema/citation-validation fail | eng-qa | T-252 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/F3/CM-C6 | ungrounded/malformed rejected → deterministic fallback |
| T-254 | Implement schema+citation output validator (reject-to-deterministic) | eng-ml | T-253 | W2 | [SEC] {ai-safety-guardrails} | ADR-007/F3/CM-C6 | no unvalidated narrative surfaces |
| T-255 | Failing test: `AICompliancePort` interface + gateway-stamp contract | eng-qa | — | W2 | [SEC] {ai-safety-guardrails} | FR-15/ADR-017/F16/CM-C1 | adapter rejects any call lacking a gateway stamp |
| T-256 | Implement `AICompliancePort` interface + gateway stamp token | ops-security | T-255 | W2 | [SEC] {ai-safety-guardrails} | FR-15/ADR-017/F16/CM-C1 | un-stamped call to LLM/Vision refused |
| T-257 | Failing test: stage 1 JWT/role-scope deny-by-default | eng-qa | T-241,T-256 | W2 | [SEC] {rbac} | ADR-017/CM-C2/LLM06 | role absent or model not allowed → 403 |
| T-258 | Implement JWT/role-scope stage (roles→allowed_models/tools/max_tokens) | ops-security | T-257 | W2 | [SEC] {rbac} | ADR-017/CM-C2/ASI03 | deny-by-default; over-max_tokens rejected |
| T-259 | Failing test: stage 2 circuit-breaker opens after N failures | eng-qa | T-258 | W2 | [SEC] {ai-safety-guardrails} | ADR-017/ADR-018/CM-C15/LLM10 | 5 failures → open → 503/ladder-descent |
| T-260 | Implement circuit-breaker stage (open→half-open→degrade to ladder) | prod-safety-engineer | T-259 | W2 | [SEC] {ai-safety-guardrails} | ADR-017/ADR-018/CM-C15 | open descends ladder, never dead-ends |
| T-261 | Failing test: stage 3 rate-limit per caller → 429 | eng-qa | T-258 | W2 | [SEC] {ai-safety-guardrails} | ADR-017/CM-C12/ASI04 | exceeding `max_requests` in window → 429 Retry-After |
| T-262 | Implement sliding-window rate-limit stage from `policies.yml` | ops-security | T-261 | W2 | [SEC] {ai-safety-guardrails} | ADR-017/CM-C12/LLM10 | per-caller window enforced |
| T-263 | Failing test: firewall detects prompt-injection/instruction-override | eng-qa | T-258 | W2 | [SEC] {prompt-injection-defense} | ADR-017/CM-C3/LLM01 | injection flagged; NL treated as data not instructions |
| T-264 | Implement semantic-firewall injection detection (regex+classifier) | ops-security | T-263 | W2 | [SEC] {prompt-injection-defense} | ADR-017/CM-C3/AML.T0051 | hit lowers confidence + audits (content redacted) |
| T-265 | Failing test: firewall blocks destructive/SSRF/secret-file patterns | eng-qa | T-264 | W2 | [SEC] {prompt-injection-defense} | ADR-017/CM-C4/ASI02 | `rm -rf`, `169.254.169.254`, `/etc/passwd` → 403 fail-closed |
| T-266 | Implement blocked-command-pattern firewall stage from `policies.yml` | ops-security | T-265 | W2 | [SEC] {prompt-injection-defense} | ADR-017/CM-C4/AML.T0057 | short-circuits 403 + audit |
| T-267 | Failing test: firewall control error FAILS CLOSED (blocks call) | eng-qa | T-266 | W2 | [SEC] {prompt-injection-defense} | ADR-017/F16/CM-C3 | detector throwing → call blocked, never forwarded |
| T-268 | Implement fail-closed wrapper for all safety stages | prod-safety-engineer | T-267 | W2 | [SEC] {ai-safety-guardrails} | ADR-017/F16/CM-C1 | safety-stage exception blocks; availability stages degrade |
| T-269 | Failing test: policy-as-code maps role→allowed models/tools | eng-qa | T-258 | W2 | [SEC] {policy-as-code} | ADR-017/CM-C33/LLM06 | disallowed model/tool for role → 403 |
| T-270 | Implement policy-as-code enforcement stage (consumes loaded Policy) | ops-security | T-269 | W2 | [SEC] {policy-as-code} | ADR-017/CM-C33/ASI03 | decision cites policy `version` |
| T-271 | Failing test: PII detect matches email/ssn/phone/cc | eng-qa | T-270 | W2 | [SEC] {pii-redaction} | ADR-017/CM-C8/LLM02 | each pattern detected; class logged, never value |
| T-272 | Implement PII detect+redact stage (redact/block/hash per action) | ops-security | T-271 | W2 | [SEC] {pii-redaction} | ADR-017/CM-C8/EU-AI-Act-Art.10 | no raw PII egresses; redact swaps reversible token |
| T-273 | Failing test: PII detector error FAILS CLOSED (blocks egress) | eng-qa | T-272 | W2 | [SEC] {pii-redaction} | ADR-017/F16/CM-C8 | detector exception blocks upstream, no raw PII sent |
| T-274 | Implement fail-closed PII egress guard | prod-safety-engineer | T-273 | W2 | [SEC] {pii-redaction} | ADR-017/F16/CM-C8/AML.T0057 | fail-closed PII test green |
| T-275 | Failing test: hash-chained append-only audit writer links prev hash | eng-qa | T-270 | W2 | [SEC] {audit-trail} | ADR-017/ADR-022/CM-C23 | tampered/skipped link detected; verify fails on gap |
| T-276 | Implement hash-chained AUDIT_EVENT writer (append-only, fail-closed) | ops-security | T-275 | W2 | [SEC] {audit-trail} | ADR-022/CM-C23/EU-AI-Act-Art.12 | no audit write ⇒ no commit; chain verifies |
| T-277 | Failing test: short-circuit 403 (policy/firewall) vs 503 (breaker) | eng-qa | T-268,T-270 | W2 | [SEC] {ai-safety-guardrails} | ADR-017/F16/CM-C1 | firewall→403, breaker-open→503 |
| T-278 | Implement 403/503 dispatcher + EU-AI-Act transparency headers | ops-security | T-277 | W2 | [SEC] {policy-as-code} | ADR-017/CM-C28/EU-AI-Act-Art.13 | codes correct; AI-involvement header stamped |
| T-278a | **Output/response firewall stage** (egress screen — symmetric to input T-264/266/272): screen the upstream RESPONSE before it reaches the app for leaked-instructions / PII / policy-violating content / disallowed tool-call echoes; **heuristic firewall** = layered regex + classifier + allowlist per `policies.yml`; on hit → redact-or-block fail-closed + audit; passes to schema+citation validator (T-254). Makes the gateway bidirectional (input AND output); **reuses the T-272 PII detector** (no second PII impl) | ops-security | T-274,T-254 | W2 | [SEC] {ai-safety-guardrails}{prompt-injection-defense} | ADR-017/F16/CM-C3-C8/LLM02/D-35 | injected/PII/policy content in a model response is blocked/redacted before surfacing; fail-closed on detector error |
| T-279 | Failing test: 5 cost guardrails (consumption/temporal/loop/delegation/idempotency) | eng-qa | T-241 | W2 | [SEC] {cost-guardrails} | ADR-018/F17/CM-C13/LLM10 | each counter trips at cap; retried step debits once |
| T-280 | Implement 5 deterministic-floor cost guardrail counters | prod-safety-engineer | T-279 | W2 | [SEC] {cost-guardrails} | ADR-018/F17/CM-C13/ASI04 | model cannot reason past floor |
| T-281 | Failing test: pre-step reservation reserve→execute→reconcile | eng-qa | T-280 | W2 | [SEC] {cost-guardrails} | ADR-018/F17/CM-C13 | `can_afford` false → reject; over-reserve reconciled |
| T-282 | Implement pre-step cost reservation (reserve/reconcile/forecast) | prod-safety-engineer | T-281 | W2 | [SEC] {cost-guardrails} | ADR-018/F17/CM-C13 | deterministic estimate |
| T-283 | Failing test: breaker escalates degrade→escalate→terminate | eng-qa | T-282 | W2 | [SEC] {cost-guardrails} | ADR-018/CM-C15/ASI04 | rising spend descends → holds for human → terminates |
| T-284 | Implement degrade→escalate→terminate cost circuit-breaker | prod-safety-engineer | T-283 | W2 | [SEC] {cost-guardrails} | ADR-018/CM-C15 | escalation green |
| T-285 | Failing test: reserved cost ≥ `escalation_threshold_usd` HARD-BLOCKS for HITL | eng-qa | T-282 | W2 | [SEC] {cost-guardrails} | ADR-018/F17/CM-C14/EU-AI-Act-Art.14 | above-cap held for approval; below-cap auto-proceeds |
| T-286 | Implement HITL hard-block above threshold/cap (soft within budget) | prod-safety-engineer | T-285 | W2 | [SEC] {cost-guardrails} | ADR-018/F17/CM-C14 | approver recorded in AUDIT_EVENT |
| T-287 | Failing test: OTel GenAI 5-level span hierarchy (L0→L4) with `gen_ai.usage.*` | eng-qa | T-276 | W2 | [SEC] {observability-stack-setup} | ADR-022/F19/CM-C24/OTel-GenAI | span tree L0→L4; usage tokens per LLM span |
| T-288 | Implement OTel GenAI spans + per-step cost on AUDIT_EVENT (tokens_in/out, cost_usd, model_tier) | ops-security | T-287 | W2 | [SEC] {observability-stack-setup} | ADR-022/F19/CM-C25/EU-AI-Act-Art.12 | per-step cost attributed; content-capture off in prod |
| T-289 | Failing test + stub: verifier-agent (different model family), advisory-only | eng-ml | T-288 | W2 | [SEC] {ai-safety-guardrails} | ADR-022/CM-C26/LLM09 | cross-checks critical output, never overrides deterministic/human |
| T-290 | Failing test: `VisionPort` cloud→LLaVA→skip ladder + consent/PII-screen gate | eng-qa | T-274 | W2 | [SEC] {ai-safety-guardrails} | ADR-008/CM-C10/ASI06 | unconsented/PII-unscreened image rejected before processing |
| T-291 | Implement `VisionPort` adapter (advisory/cited/confidence-scored, degrade to skip) | eng-ml | T-290 | W2 | [SEC] {ai-safety-guardrails} | ADR-008/CM-C10 | vision never auto-alerts/overrides geometry |
| T-292 | Write MODEL_CARD/SYSTEM_CARD stub (tiers, limits, standards mapping) | ops-security | T-289 | W2 | [SEC] {ai-safety-guardrails} | ADR-022/CM-C28/EU-AI-Act-Art.13 | lists tiers, intended use, limitations, standards refs |
| T-292a | **I/O guardrail red-team corpus suite (D-35)** — one parametrized suite exercising **BOTH directions** of the gateway with golden/error/edge cases: **INPUT** firewall corpus (prompt-injection incl. indirect-via-cited-source, destructive/SSRF/secret patterns, unicode/bidi/zero-width evasion, role-scope bypass attempts) and **OUTPUT** firewall corpus (uncited fields, schema violations, number-hallucination vs engine, PII egress, leaked instructions, refusal handling); asserts fail-closed on every safety case + ladder-degrade on every availability case; corpus feeds EVAL_PLAN §2 `adversarial/pii/no-number-leak` tags and runs in eval-tier1 (PR-blocking) | eng-qa | T-268

**Cross-epic:** the proxy (T-256…T-278) must exist before **E5** (SitRep/decision narration) and **E7** (`GET /incidents/:id/sitrep`, `POST /edxl/sitrep`) route every LLM+Vision call through it — adapters refuse un-stamped calls (T-256). LLM ladder (T-243…T-254) + cost guardrails (T-279…T-286) build in parallel with each other but both feed the proxy's breaker/budget stages. VisionPort (T-290/T-291) depends on the PII fail-closed guard (T-274).
**✅ RESOLVED (D-27):** ① **Cost-caps CONFIRMED (Conservative)** — `config/policies.yml` already carries `escalation_threshold_usd=0.50` (HITL/call), `per_incident_usd=5.00`, `per_region_usd=50.00`, `log_retention_days=365`, `rate_limit` at the gateway; soft-within-budget / hard-block+HITL above; safety fail-closed. Tunable at S05. ② **ADR-008a exists** — `docs/architecture/decisions/ADR-008a-vision-provider-profiles.md` documents the Gemma vision profile (the earlier "not found" was a glob miss). (Covered by F16/F17/F19/F3.)

**S05 impl-bindings (recorded 2026-07-01, D-29 — from the pre-implementation audit; bind these in code):**
- **Gate-token seal (T-255/T-256):** the compliance stamp is an **in-process capability token minted only at
  the composition root** (`src/main`) and passed in-memory to provider adapters — never over the wire — so an
  adapter cannot forge it. F16 asserts un-sealed calls are refused. *(closes A5 adapter-bypass.)*
- **Per-incident cost accounting (T-281/T-285):** `incident_id` comes from request context; the guard **sums
  recent `AUDIT_EVENT.cost_usd` for that incident** before reserving; hard-block when cumulative ≥
  `per_incident_usd`; F17 tests cumulative (not just per-call). *(closes A5 thin-slice bypass.)*
- **Regex-compile boot check (T-240/T-242):** boot compiles every `policies.yml` PII/blocked-command regex
  (Ajv `regex` format + smoke-compile); fail-fast on a bad pattern.
- **Breaker→ladder handoff (T-259/T-260):** proxy breaker-open **descends the AI ladder** (cloud→Haiku→
  Ollama→deterministic-only), never dead-ends.
- **Verifier-agent failure mode (T-289):** on failure/timeout → emit SitRep unchanged (advisory skipped); on
  disagreement → log AUDIT_EVENT + "flagged" note; never override deterministic/human.
- **AUDIT_EVENT cost non-null on AI calls (F19):** every `action=ai_call` event must carry all cost fields
  (deterministic floor if the estimator fails); reject-write otherwise (fail-closed).
