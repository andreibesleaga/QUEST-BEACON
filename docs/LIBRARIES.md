# BEACON — Library & API manifest (pinned free/OSS choices; don't reinvent)

> Every non-trivial capability names its **mature, free, open-source** library or standard, so S05 reuses
> instead of hand-rolling (Engineering Principle §2). All licenses are permissive + compatible with the
> Apache-2.0 product. Exact versions are pinned in `package.json` at S05 (E0·T-002) against current releases.
> One capability → one canonical library keeps the code searchable and simple.

## Core runtime & data
| Capability | Library / standard | License | Note |
|---|---|---|---|
| Web + API | **Next.js** (App Router) | MIT | UI + thin API routes (ADR-002/003) |
| Language | **TypeScript** (strict) | Apache-2.0 | no `any`; typed everywhere |
| ORM / migrations | **Drizzle** + drizzle-kit | Apache-2.0 | SQL-first, no engine binary (ADR-013) |
| DB | **PostgreSQL** | PostgreSQL | canonical store |
| Geo (default) | **Turf.js** | MIT | point-in-polygon/buffer/intersect (ADR-005) |
| Geo (scale flag) | **PostGIS** | GPL-2.0 (server ext., not linked) | behind SpatialPort flag |
| Config + input validation | **Zod** | MIT | env schema + request DTOs; fail-fast boot (ADR-012) |
| JSON-Schema validation | **Ajv** (+ ajv-formats) | MIT | CAP/EDXL/sustainability/manifest schemas (F15/F18) |
| XML build/parse (EDXL) | **fast-xml-parser** | MIT | pure-JS, **XXE-safe by default** (no external entities/DTD); ADR-010/T2.4 |
| Structured logging | **pino** | MIT | built-in redaction (PII-safe logs) |

## AI, safety, observability
| Capability | Library / standard | License | Note |
|---|---|---|---|
| LLM provider routing | **LiteLLM** (self-hosted OpenAI-compatible gateway) + **openai** TS client | MIT / Apache-2.0 | one client, provider-agnostic; Ollama's OpenAI-compatible API for local (ADR-007) |
| Local LLM / vision | **Ollama** (llama3, LLaVA), **Gemma** via Ollama | MIT / Gemma terms | offline rung (ADR-008/008a) |
| Compliance proxy | *(app code, thin)* over the above | — | our `AICompliancePort` governs every call (ADR-017); not a 3rd-party product |
| Hash-chained audit | **Node.js `crypto`** (SHA-256) | Node (MIT) | deterministic; no dep (Art. XII) |
| Resilience (retry/breaker/timeout/fallback) | **cockatiel** | MIT | composable policies — `withRedundancy` is a thin composition, not hand-rolled (ADR-009, E4·T-132/140) |
| Rate limiting | in-memory sliding window *(demo)* → **rate-limiter-flexible** (Redis, scale flag) | MIT | free; no external dep for the demo |
| Observability | **@opentelemetry/api + sdk-node + exporter-trace-otlp-http**; GenAI semconv | Apache-2.0 | per-step cost spans (ADR-022); exporter env-gated |
| Auth (JWT) | **jose** | MIT | Web-Crypto, works in Next.js edge + node (ADR §10.2) |

## Frontend
| Capability | Library | License | Note |
|---|---|---|---|
| Map | **MapLibre GL JS** | BSD-3 | tokenless open tiles (ADR-002) |
| Offline basemap | **PMTiles** (protomaps) | BSD-3 | optional bundled basemap for air-gapped demo |
| Data-viz layers | **deck.gl** | MIT | hazard/flood/exposure/route layers |
| UI state | **Zustand** | MIT | layer/region UI state |
| Server cache | **TanStack Query** | MIT | envelope-typed fetch |
| Styling | **Tailwind CSS** | MIT | design tokens, dark-first + light themes (UIUX §1) |
| Accessible primitives | **Radix UI** | MIT | dialog/menu/popover/tabs/tooltip — correct ARIA/focus for free (UIUX §3) |
| Icons | **lucide-react** | ISC | consistent stroke set, tree-shaken; no emoji in ops UI |
| Font | **@fontsource/inter** (variable) | OFL-1.1 | **self-hosted** (offline-identical, no CDN); tabular-nums |
| Motion | **motion** (Framer Motion) | MIT | 120–200 ms micro-interactions; `prefers-reduced-motion` honored |
| Command palette | **cmdk** | MIT | ⌘K actions/jump (UIUX §2) |
| Toasts | **sonner** | MIT | aria-live, action-able notifications |
| HTML sanitization | **DOMPurify** | (MPL-2.0 OR Apache-2.0) | sanitize any rich text before render (XSS; E8·T-394a) |
| a11y checks | **axe-core** / @axe-core/playwright | MPL-2.0 | WCAG 2.2 AA (F13) |

## Test / eval / CI
| Capability | Library / tool | License | Note |
|---|---|---|---|
| Unit/integration/contract | **Vitest** + @vitest/coverage-v8 | MIT | ≥99% gate |
| BDD | **@amiceli/vitest-cucumber** | MIT | Gherkin per FR |
| Property | **fast-check** | MIT | engine invariants |
| E2E + visual | **Playwright** | Apache-2.0 | golden path + visual regression |
| Mutation | **Stryker** | Apache-2.0 | nightly ≥80% |
| Chaos / fault-injection | **Toxiproxy** | MIT | source-down/latency |
| Lint / boundaries | **ESLint**, **Prettier**, **dependency-cruiser**, **madge** | MIT | F9 boundary + complexity |
| Secrets / SCA / SAST | **gitleaks**, **OSV-Scanner** (wired, non-blocking security lane); **Semgrep**, **CodeQL** (planned, not wired — `SECURITY.md`) | MIT / Apache-2.0 / LGPL / free-for-OSS | CI security lane |
| Supply chain | **CycloneDX** (SBOM), **cosign/sigstore**, **SLSA**, **OpenSSF Scorecard** | Apache-2.0 | release gate |
| Git hooks | **husky** + **lint-staged** + **commitlint** | MIT | pre-commit + conventional commits |

## Data & routing APIs (free/open — see `audit/DATA_SOURCE_VERIFICATION.md`)
NASA FIRMS · NWS api.weather.gov · OSM Overpass · NOAA NWPS · USGS Water (OGC) · GDELT · ReliefWeb v2 ·
OpenRouteService (routing; self-host **Valhalla/OSRM** fallback) · Copernicus EFAS/GloFAS/EFFIS · MeteoAlarm ·
Open-Meteo · WorldPop. All free; keys (where needed) are free-tier; golden path degrades to cached/mock offline.

---
*Rule: adding a dependency requires a row here + a one-line "why" + license check (Engineering Principle §2).
Prefer the standard-library or an already-listed lib before adding a new one.*
