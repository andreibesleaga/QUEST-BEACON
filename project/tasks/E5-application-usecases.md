# Epic E5 — Application use-cases (deterministic engine + AI orchestration)

> Owner personas: **eng-backend · eng-ml** (tests **eng-qa**) · Waves W2–W3 · IDs `E5·T-190…T-249`
> Use-cases import **ports only** (never adapters). Keystone: **deterministic → AI → human**. ALL numbers
> from deterministic code (**F3**); SitRep fields carry citations[] (**F2**); AI-off degrades to
> deterministic-only. LLM calls route ONLY through **E6 AICompliancePort**.
>
> *Note: E5 IDs T-240…T-249 overlap E6's T-240s numerically — disambiguated by epic. Cross-epic deps use
> `E1:`/`E3:`/`E6:` labels.*

| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-190 | Define `ExposureQuery`/`ExposureResult` DTOs | eng-backend | E1 | W2 | [PARALLEL] {dto-design} | FR-3/§5.1 | types compile; carry `reason` enum IN_POLYGON\|IN_BUFFER\|OUTAGE |
| T-191 | Failing unit tests for `risk-intersection` inside/buffer/outside/empty | eng-qa | T-190,E1,E3 | W2 | [PARALLEL] {tdd-cycle} | FR-3/§5.1 | Red: point-in-polygon, ≤buffer, >buffer, empty-geom fail |
| T-192 | Implement `risk-intersection` over SpatialPort | eng-backend | T-191 | W2 | {tdd-cycle} | FR-3/§5.1 | all T-191 green; distances from SpatialPort only |
| T-193 | Property test: exposure monotonic in buffer size | eng-qa | T-192 | W2 | [PARALLEL] {pbt-strategy} | FR-3/F3/§5.1 | larger buffer never reduces AT_RISK set |
| T-194 | No-adapter-import boundary check for `risk-intersection` | eng-qa | T-192 | W2 | [PARALLEL][SEC] {arch-lint} | ADR-001/§4 | zero adapters/infra/framework imports |
| T-195 | Define `PriorityInput`/`PriorityScore` DTOs | eng-backend | E1 | W2 | [PARALLEL] {dto-design} | FR-13/§5.2 | holds proximity/vulnerability/population + tie-break key |
| T-196 | Failing tests for priority weights 0.45/0.35/0.20 | eng-qa | T-195 | W2 | [PARALLEL] {tdd-cycle} | FR-13/§5.2 | Red: known inputs assert exact weighted score |
| T-197 | Failing test for inside_hazard⇒proximity=1.0 clamp | eng-qa | T-195 | W2 | [PARALLEL] {tdd-cycle} | FR-13/§5.2 | Red: inside node forces proximity=1.0 |
| T-198 | Failing test for deterministic tie-break ordering | eng-qa | T-195 | W2 | [PARALLEL] {tdd-cycle} | FR-13/F3/§5.2 | Red: equal-score nodes sort by stable key |
| T-199 | Implement `priority-ranking` pure function (weights from config) | eng-backend | T-196,T-197,T-198 | W2 | {tdd-cycle} | FR-13/§5.2 | tests green; weights injected, not hardcoded |
| T-200 | Property test: priority score ∈ [0,1], weight-sum invariant | eng-qa | T-199 | W2 | [PARALLEL] {pbt-strategy} | FR-13/F3/§5.2 | score bounded; permuting inputs never crashes |
| T-201 | No-adapter-import check for `priority-ranking` | eng-qa | T-199 | W2 | [PARALLEL][SEC] {arch-lint} | ADR-001/§4 | zero adapter/framework imports |
| T-202 | Define `ThresholdRule`/`RuleEvalContext` DTOs | eng-backend | E1 | W2 | [PARALLEL] {dto-design} | FR-11/ADR-014 | matches schema target/operator/value/scope/hysteresis/cooldown |
| T-203 | Failing edge-trigger tests (crosses vs holds) | eng-qa | T-202 | W2 | [PARALLEL] {tdd-cycle} | FR-11/ADR-014/§5.3 | Red: fires on transition, not each cycle held |
| T-204 | Failing hysteresis dwell + exactly-on-dead-band tests | eng-qa | T-202 | W2 | [PARALLEL] {tdd-cycle} | FR-11/ADR-014/§5.3 | Red: sub-dwell no-fire; boundary value pinned |
| T-205 | Failing cooldown de-dup test | eng-qa | T-202 | W2 | [PARALLEL] {tdd-cycle} | FR-11/ADR-014/§5.3 | Red: repeat fire within cooldown suppressed |
| T-206 | Implement `threshold-eval` pure evaluator (edge+hysteresis+cooldown) | eng-backend | T-203,T-204,T-205 | W2 | {tdd-cycle} | FR-11/ADR-014/§5.3 | all green; emits intent to DRAFT only |
| T-207 | Implement DRAFT-ALERT construction with provenance→SOURCE_RECORD | eng-backend | T-206,E1 | W2 | [SEC] {tdd-cycle} | FR-11/F8/§5.3 | fire yields cap_status=DRAFT + citation; never ACTUAL |
| T-208 | Property test: threshold evaluator flap-free under noise | eng-qa | T-206 | W2 | [PARALLEL] {pbt-strategy} | FR-11/ADR-014 | noisy signal within dead-band never fires |
| T-209 | No-adapter-import check for `threshold-eval` | eng-qa | T-206 | W2 | [PARALLEL][SEC] {arch-lint} | ADR-001/§4 | zero adapter/framework imports |
| T-210 | Define `PredictionInput`/`Prediction` DTO (method/inputs/uncertainty/horizon) | eng-ml | E1 | W2 | [PARALLEL] {dto-design} | FR-12/§5.6 | type carries first-order label fields |
| T-211 | Failing tests for wind-buffer fire cone geometry | eng-qa | T-210,E3 | W2 | [PARALLEL] {tdd-cycle} | FR-12/§5.6 | Red: bearing=wind dir, length∝speed×horizon |
| T-212 | Failing empty-geometry / zero-wind edge tests | eng-qa | T-210 | W2 | [PARALLEL] {tdd-cycle} | FR-12/§5.6 | Red: no hotspots / zero wind returns labeled null |
| T-213 | Implement `prediction-projection` fire cone (Turf directional buffer) | eng-ml | T-211,T-212 | W2 | {tdd-cycle} | FR-12/§5.6 | cone labeled "first-order projection" |
| T-214 | Failing tests for crest ∩ NFHL flood inundation | eng-qa | T-210,E3 | W2 | [PARALLEL] {tdd-cycle} | FR-12/§5.6 | Red: NWPS-crest × FEMA-NFHL intersection + caveat |
| T-215 | Implement flood-inundation projection (crest × NFHL) | eng-ml | T-214 | W2 | {tdd-cycle} | FR-12/§5.6 | carries lead-time + NFHL-effective caveat |
| T-216 | No-adapter-import check for `prediction-projection` | eng-qa | T-213,T-215 | W2 | [PARALLEL][SEC] {arch-lint} | ADR-001/§4 | zero adapter/framework imports |
| T-217 | Define `TrendSignal`/`TrendResult` DTOs | eng-ml | E1 | W2 | [PARALLEL] {dto-design} | FR-4/§5.7 | holds window/slope/samples/deadband |
| T-218 | Failing tests: too-few-samples ⇒ STEADY | eng-qa | T-217 | W2 | [PARALLEL] {tdd-cycle} | FR-4/§5.7 | Red: <TREND_MIN_SAMPLES returns STEADY |
| T-219 | Failing tests: monotonic-vs-noisy + exactly-on-dead-band | eng-qa | T-217 | W2 | [PARALLEL] {tdd-cycle} | FR-4/§5.7 | Red: slope on/at ±deadband boundary pinned |
| T-220 | Implement `escalation-trend` least-squares slope classifier | eng-ml | T-218,T-219 | W2 | {tdd-cycle} | FR-4/§5.7 | ESCALATING/STEADY/DEESCALATING per dead-band |
| T-221 | Property test: trend classifier sign-stable under scaling | eng-qa | T-220 | W2 | [PARALLEL] {pbt-strategy} | FR-4/F3/§5.7 | positive-slope series never DEESCALATING |
| T-222 | No-adapter-import check for `escalation-trend` | eng-qa | T-220 | W2 | [PARALLEL][SEC] {arch-lint} | ADR-001/§4 | zero adapter/framework imports |
| T-223 | Define `RouteRequest`/`EvacRoute` DTOs | eng-backend | E1 | W2 | [PARALLEL] {dto-design} | FR-7/§5.5 | carries avoids_hazard + quality/freshness label |
| T-224 | Failing tests for hazard-polygon avoidance constraint | eng-qa | T-223,E3 | W2 | [PARALLEL] {tdd-cycle} | FR-7/ADR-016/§5.5 | Red: route excludes hazard polygon |
| T-225 | Failing ladder-fallback test (ORS→heuristic, no dead-end) | eng-qa | T-223 | W2 | [PARALLEL] {tdd-cycle} | FR-7/ADR-016/§5.5 | Red: RoutingPort fail ⇒ heuristic avoids_hazard=false labeled |
| T-226 | Implement `evac-routing` over RoutingPort ladder | eng-backend | T-224,T-225 | W3 | {tdd-cycle} | FR-7/ADR-016/§5.5 | sets avoids_hazard; never dead-ends |
| T-227 | Implement `suggested_start` deterministic computation | eng-backend | T-226,T-213 | W3 | {tdd-cycle} | FR-7/§5.7 | arrival−clearance−margin; null when arrival unknown |
| T-228 | No-adapter-import check for `evac-routing` | eng-qa | T-226 | W3 | [PARALLEL][SEC] {arch-lint} | ADR-001/§4 | only RoutingPort imported, no adapters |
| T-229 | Define `CapacityDemand`/`ShelterMatch` DTOs | eng-backend | E1 | W2 | [PARALLEL] {dto-design} | FR-8/§5.5 | holds capacity−occupancy + status OPEN |
| T-230 | Failing tests: capacity=demand boundary + all-full | eng-qa | T-229 | W2 | [PARALLEL] {tdd-cycle} | FR-8/§5.5 | Red: zero-availability shelter excluded; tie-break |
| T-231 | Implement `capacity-match` shelter ranking (distance×availability) | eng-backend | T-230,E3 | W3 | {tdd-cycle} | FR-8/§5.5 | ranks OPEN shelters deterministically |
| T-232 | No-adapter-import check for `capacity-match` | eng-qa | T-231 | W3 | [PARALLEL][SEC] {arch-lint} | ADR-001/§4 | zero adapter/framework imports |
| T-233 | Define `ReportTriageInput`/`ConfidenceComponents` DTOs | eng-backend | E1 | W2 | [PARALLEL] {dto-design} | FR-5/ADR-015 | four component fields + blended score |
| T-234 | Failing tests for confidence weights 0.40/0.30/0.20/0.10 | eng-qa | T-233 | W2 | [PARALLEL] {tdd-cycle} | FR-5/ADR-015/§5.4 | Red: known components assert exact blend ∈[0,1] |
| T-235 | Failing test: LLM geocode/classifier are inputs only | eng-qa | T-233 | W2 | [PARALLEL][SEC] {tdd-cycle} | FR-5/F3/ADR-015 | Red: blend computed in code, LLM never sets number |
| T-236 | Implement `confidence-blend` pure function + component surfacing | eng-backend | T-234,T-235 | W3 | {tdd-cycle} | FR-5/ADR-015/§5.4 | returns components, not just number |
| T-237 | Implement `report-triage` use-case (UNVERIFIED + confidence) | eng-backend | T-236,E1 | W3 | [SEC] {tdd-cycle} | FR-5/F8/§5.4 | new report starts UNVERIFIED; no auto-verify |
| T-238 | No-adapter-import check for `report-triage`/`confidence-blend` | eng-qa | T-236,T-237 | W3 | [PARALLEL][SEC] {arch-lint} | ADR-001/F3/§4 | zero adapter/framework imports |
| T-239 | Define `SitRepFacts`/`SitRepDraft` DTO (fields + citations[]) | eng-backend | E1 | W3 | [PARALLEL] {dto-design} | FR-4/F2/§2.4 | each field slot carries citations[]→sourceId |
| T-240 | Failing test: assemble deterministic facts + citations coverage | eng-qa | T-239,T-192,T-199 | W3 | [PARALLEL] {tdd-cycle} | FR-4/F2/§2.4 | Red: 100% field-citation coverage required |
| T-241 | Failing test: AI-off degrades to deterministic-only | eng-qa | T-239 | W3 | [PARALLEL] {tdd-cycle} | FR-4/F4/§6.4 | Red: ai_mode="deterministic-only", priorities retained |
| T-242 | Failing test: numbers come from data, not LLM narration | eng-qa | T-239 | W3 | [PARALLEL][SEC] {tdd-cycle} | FR-4/F3/§2.4 | Red: engine figures win; LLM text never mutates numbers |
| T-243 | Implement `sitrep-synthesis` fact-assembly (deterministic, pre-LLM) | eng-backend | T-240,T-241 | W3 | {tdd-cycle} | FR-4/F2/§2.4 | builds cited fact bundle offline |
| T-244 | Wire LLM narration via **E6 AICompliancePort** only (not adapter) | eng-ml | T-243,E6 | W3 | [SEC] {ai-orchestration} | FR-4/§6.3/§6.5 | narration routes through AICompliancePort; schema-validated |
| T-245 | Implement citation-enforcement + reject→deterministic fallback | eng-ml | T-244 | W3 | [SEC] {ai-orchestration} | FR-4/F4/§6.3 | missing citation ⇒ reject, deterministic-only |
| T-246 | No-adapter-import check for `sitrep-synthesis` (port-only) | eng-qa | T-243,T-244 | W3 | [PARALLEL][SEC] {arch-lint} | ADR-001/F3/§4 | imports AICompliancePort only; no LLM adapter |
| T-247 | Define `DecisionSupport` DTO (numbers + narration + HITL gate) | eng-backend | E1 | W3 | [PARALLEL] {dto-design} | FR-13/F8/§5 | carries deterministic figures + approval state |
| T-248 | Failing test: decision-support blocks public action pre-HITL | eng-qa | T-247 | W3 | [PARALLEL][SEC] {tdd-cycle} | FR-13/F8/§5 | Red: unapproved ⇒ no public/task action |
| T-249 | Implement `decision-support` handshake (engine+narration+HITL) | eng-backend | T-248,T-243 | W3 | [SEC] {tdd-cycle} | FR-13/F3/F8/§5 | numbers deterministic; HITL gate enforced |

**Cross-epic / blast-radius:** T-244/T-245 (SitRep narration) and T-249 (decision narration) touch the LLM ONLY through **E6 AICompliancePort** — dep on E6, **not** [PARALLEL] with the proxy. Fact-assembly (T-243) is deterministic and precedes E6.
**F3 enforcement points:** T-193/T-200/T-221 (property bounds), T-235 (confidence in code), T-242 (SitRep numbers from data), T-249 (decision numbers deterministic).
**🟡 Open items — formulas to confirm with prod-architect (S05):** priority `vulnerability` boost factor + normalization ceiling; `population` normalization basis; `capacity-match` composite direction (minimize distance / maximize availability); `TREND_DEADBAND` boundary semantics (`slope==+deadband` → STEADY per strict `>`). All weights/buffers/margins are config-injected, never hardcoded.
