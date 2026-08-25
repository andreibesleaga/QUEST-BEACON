# BEACON — S05 Readiness (capstone audit + build advisory)

*IEEE Response Quest 2026 · Phase 3 · 2026-07-04 (D-34). The final pre-implementation check: three parallel
lenses (fresh-eyes red-team · prod-tech-lead advisory · whole-tree coherence, 129 files) on top of the
14 prior audit lenses. Companion to `FINAL_AUDIT.md`, `EXTERNAL_VERIFICATION.md`, `PRE_IMPLEMENTATION_AUDIT.md`.*

## Verdict: **READY FOR S05.** ~496 atomic tasks, all audits green, no open blockers.
Everything found by the capstone lenses was **fixed in this pass** (below) or recorded as an S05
recommendation. The spec base is correct, complete, non-redundant, honest, and change-tolerant.

---

## 1. Fixed in this pass (fresh-eyes + coherence findings, all applied)

| Gap (who missed it: 14 prior lenses) | Fix applied |
|---|---|
| 🔴 No `README.md` (judge/cloner has no entry point) | **Created** — what/why, quick start, orientation table, layout note, disclosure link |
| 🔴 **i18n blind spot** — Romanian data (ANM/MeteoAlarm CAP, RO RSS, RO SOS) through an implicitly-English pipeline | **SPEC §3.5 added**: `lang` tag on every text datum; CAP `xml:lang` selection; narrate in `REGION_LANG`, cite original; engine language-independent. `regions.json` now carries `lang/tz/units` per region |
| 🔴 "Responsive PWA / offline in the field" claimed but no client-side task | **E8·T-350a added**: manifest + service-worker shell/LKG cache; installable; airplane-mode acceptance |
| 🟡 Timezone rule unspecified (PST↔EET) | SPEC §3.5: **store UTC, render region TZ** (`America/Los_Angeles` / `Europe/Bucharest`) |
| 🟡 Units unspecified (NWPS feet vs GloFAS meters vs SI thresholds) | SPEC §3.5: **SI at the ACL**, per-region display formatting; contract-tested |
| 🟡 `purgeAfter` modeled but never executed | **E3·T-129a added**: retention purge cron (QueuePort) + audit event (Art. XIV/UW6) |
| 🟡 No `.nvmrc` (first command `nvm use` fails) | **Created** (`24` — current LTS major; exact pin at E0·T-001) |
| 🟡 No SECURITY.md pre-build | **Created** (private-advisory disclosure channel + posture summary) |
| 🟡 "E2 missing" confusion | Numbering note added in TASKS.md (E2 consolidated into E3; labels kept stable) |
| 🟡 Two audit dirs unclear | README layout note (root `audit/` = Phase-2 carry-over; `docs/audit/` = SDLC gates) |
| 🔴🔴 Stale status surfaces (SDLC_TRACKER @S03, gabbe.config @S02, SUMMARY @S03 + 7-vs-9-schema contradiction) | **All synced to S04-complete/paused**; manifest Articles XI–XVI; PROJECT_STATE/CONTINUITY refreshed; **S04 SESSION_SNAPSHOT created** |
| 🟢 Demo-day concurrency unplanned | DEMO_SCRIPT: N≥20 concurrent sessions check + SSE cap note |

Whole-tree verdict (129 files): **no orphans, stubs, duplicates, or leftover TODO/placeholder; no secrets
in committed files** (targeted grep clean). Counts machine-verified: **496 tasks · 21 paths/22 ops ·
19 tables · 23 ADRs · 12 JSON files valid**.

## 2. Build advisory (prod-tech-lead — recommendations, not gates)

- **Critical path = the E6 compliance-proxy serial chain, not the adapters.** Run it on one dedicated
  agent **from Week 1**, concurrently with the W1 fan-out (~120 [PARALLEL] tasks). Week gates: **W4** =
  scaffold+domain+persistence+adapter-framework+FIRMS; **W8** = proxy done + engine + golden-path backend;
  **W11 feature-freeze**; **W12–13 record video** (never on the deadline); submit Week 13 (due 9 Oct).
- **Demo-critical adapter set (~14):** the 8 golden-path (FIRMS live, NWS, Overpass, NWPS, USGS, GDELT,
  ReliefWeb, ORS) + NIFC-WFIGS + RO quartet (EFFIS/GloFAS/MeteoAlarm-RO/Open-Meteo) + CEMS-RM (EMSR758) +
  outage-proxy. Everything else lands post-video as manifest rows (zero core change).
- **Cut order if behind:** D-32 deep-catalog extras → D-31 extras (keep WFIGS) → out-of-core plugins →
  vision → mutation/chaos depth. **Never cut:** the 3 redundancy tests, the proxy, provenance/citations.
- **Leverage:** parametrized adapter contract-harness over the manifest (adapters become boilerplate);
  shared BDD step library; E8 shell/tokens start in W1 against MSW fixture mocks.
- **Judge quick wins (ranked):** live offline-toggle → citations panel → AI-off degrade → EMSR758 real-flood
  replay → outage-proxy novelty → CA→RO region switch.
- **Process:** pour agents into W1/W4 density; prompt-cache the adapter template context; route boilerplate
  to a cheap tier, reserve the strong model for E6/E5; `gabbe sync` + session-state refresh on every task DONE.

## 3. Standing risks (tracked, accepted)

Live-source re-verify gate before any `SOURCE_*_MODE=live` flip · PurpleAir ToS conflict (mock until
re-verified) · MeteoAlarm free-feed continuity (GDACS = labeled fallback) · CAP adoption gaps outside
~130–150 countries ("official where available") · solo-timeline pressure (mitigated by the cut order).

**Next action on user GO:** S05 Wave W0 — `E0·T-001` (.nvmrc pin) → scaffold spine → W1 fan-out + E6 proxy
agent. *(Per the session-state tracker.)*
