# Epic E3 — Persistence (Drizzle 19 tables) · Spatial compute · Region registry · Seed

> Owner personas: **eng-database · eng-data** (tests **eng-qa**) · Waves W1–W2 · IDs `E3·T-090…T-129`
> Drizzle behind RepositoryPort; Turf.js default ↔ PostGIS flag (SpatialPort); regions from config
> (California LIVE + **Romania CACHED**). TDD-first for repo/spatial. Trace keys point at
> table/ADR/§MIGRATION_PLAN.
>
> *Note: E3 IDs T-090…T-129 overlap E1's port IDs T-090…T-093 numerically — they are disambiguated by
> epic (`E3·T-090` = drizzle.config vs `E1·T-090` = ports/infra). Cross-epic deps use `E1:`/`E0:` labels.*

| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-090 | Write `drizzle.config.ts` (dialect postgresql, schema/out paths) | eng-database | E0:drizzle-setup | W1 | [PARALLEL] {database-design} | §MIGRATION_PLAN §1 | drizzle-kit reads config; out=`./drizzle` |
| T-091 | Define Drizzle CHECK-enum helper + shared column mixins (id/timestamps) | eng-database | T-090 | W1 | {database-design} | §MIGRATION_PLAN §2 | helper emits `check(sql\`col IN (...)\`)`; unit test passes |
| T-092 | Drizzle schema: `source_record` table + indexes | eng-database | T-091 | W1 | [PARALLEL] {database-design} | source_record | table+3 indexes+mode CHECK match schema.sql |
| T-093 | Drizzle schema: `region` table + scope CHECK + index | eng-database | T-091 | W1 | [PARALLEL] {database-design} | region/ADR-011 | scope CHECK COMMUNITY/STATE/COUNTRY; jsonb bbox present |
| T-094 | Drizzle schema: `incident` + `hazard_geometry` (group) | eng-database | T-093,T-092 | W1 | [PARALLEL] {database-design} | incident,hazard_geometry | type/status/kind CHECKs + FKs + bbox GIN index |
| T-095 | Drizzle schema: `gauge` + `infrastructure_node` + `exposure` (group) | eng-database | T-094 | W1 | [PARALLEL] {database-design} | gauge,infrastructure_node,exposure | flood_category/type/status/reason CHECKs; uq_exposure UNIQUE |
| T-096 | Drizzle schema: `prediction` table + indexes | eng-database | T-094 | W1 | [PARALLEL] {database-design} | prediction | kind CHECK + incident FK cascade |
| T-097 | Drizzle schema: `app_user` table + role CHECK + index | eng-database | T-091 | W1 | [PARALLEL] {database-design} | app_user | role CHECK PUBLIC/RESPONDER/VERIFIER/EM |
| T-098 | Drizzle schema: `public_report` + consent CHECK (group) | eng-database | T-094,T-092 | W1 | [PARALLEL] {database-design} | public_report | chk consent=true + confidence 0..1 CHECK present |
| T-099 | Drizzle schema: `sitrep` + `citation` (group) | eng-database | T-094,T-092 | W1 | [PARALLEL] {database-design} | sitrep,citation | trend/ai_mode CHECKs; citation source FK RESTRICT |
| T-100 | Drizzle schema: `threshold_rule` + region scope FK | eng-database | T-093 | W1 | [PARALLEL] {database-design} | threshold_rule | target/operator CHECKs; scope FK cascade |
| T-101 | Drizzle schema: `alert` + ACTUAL-approved composite CHECK | eng-database | T-094,T-097,T-100 | W1 | [PARALLEL][SEC] {database-design} | alert/Art.XIII | chk cap_status<>ACTUAL OR approved_by NOT NULL |
| T-102 | Drizzle schema: `resource` + `shelter` (group) | eng-database | T-091 | W1 | [PARALLEL] {database-design} | resource,shelter | kind/status CHECKs; shelter occupancy<=capacity CHECK |
| T-103 | Drizzle schema: `resource_task` + `evac_route` (group) | eng-database | T-102,T-094 | W1 | [PARALLEL] {database-design} | resource_task,evac_route | status CHECK PROPOSED..CLEARED; shelter FK set null |
| T-104 | Drizzle schema: `audit_event` + cost-attribution + **hash-chain (`prev_hash`,`hash`)** columns | eng-database | T-097 | W1 | [PARALLEL] {database-design} | audit_event/ADR-022/D-27 | model_tier CHECK; actor FK set null; prev_hash/hash present |
| T-105 | Barrel `schema.ts` re-exporting all table groups | eng-database | T-092,T-093,T-094,T-095,T-096,T-097,T-098,T-099,T-100,T-101,T-102,T-103,T-104 | W1 | {database-design} | §MIGRATION_PLAN §1 | single import resolves all 19 tables |
| T-106 | Generate baseline migration `drizzle/0000_init.sql` | eng-database | T-105 | W1 | {database-design} | §MIGRATION_PLAN §3 | `drizzle-kit generate` emits journal + SQL |
| T-107 | Custom migration for `set_updated_at()` trigger + attachments | eng-database | T-106 | W1 | {database-design} | schema.sql L452 | 11 triggers created via `generate --custom` |
| T-108 | Migration round-trip test: `migrate` up on clean test DB | eng-qa | T-107 | W1 | [SEC] {integration-testing} | §MIGRATION_PLAN §6 | all 19 tables exist post-migrate |
| T-109 | Migration rollback test: down/teardown leaves clean DB | eng-qa | T-108 | W2 | {integration-testing} | §MIGRATION_PLAN §6 | rollback drops all tables; re-migrate succeeds |
| T-110 | Drift test: generated SQL vs `schema.sql` table/column parity | eng-qa | T-106 | W2 | [PARALLEL] {integration-testing} | §MIGRATION_PLAN §6 | every table+column present in both |
| T-111 | Parity test: CHECK-constraint/enum equivalence vs schema.sql | eng-qa | T-106 | W2 | [PARALLEL][SEC] {integration-testing} | §MIGRATION_PLAN §6 | each enum's allowed-value set matches |
| T-112 | Parity test: FK targets + ON DELETE actions vs schema.sql | eng-qa | T-106 | W2 | [PARALLEL] {integration-testing} | §MIGRATION_PLAN §6 | every FK action matches |
| T-113 | Parity test: index + UNIQUE constraint presence vs schema.sql | eng-qa | T-106 | W2 | [PARALLEL] {integration-testing} | §MIGRATION_PLAN §6 | uq_exposure + named indexes all present |
| T-114 | Write failing RepositoryPort adapter contract test (findById) | eng-qa | E0:drizzle-setup,E1:RepositoryPort | W1 | [PARALLEL] {tdd-cycle} | Art.II | Red: no adapter yet |
| T-115 | Drizzle client `client.ts` over DATABASE_URL | eng-database | T-090 | W1 | [PARALLEL][SEC] {database-design} | ADR-012 | `drizzle(pg)` connects with env URL |
| T-116 | Postgres repo adapter: incident aggregate findById/save | eng-database | T-114,T-115,E1:INCIDENT | W1 | {database-design} | Art.II,incident | contract test green for incident |
| T-117 | Postgres repo adapter: hazard_geometry findById/save/query | eng-database | T-116,E1:HAZARD-GEOMETRY | W2 | [PARALLEL] {database-design} | hazard_geometry | save+findByIncident round-trips GeoJSON |
| T-118 | Postgres repo adapter: source_record + citation save/query | eng-database | T-116,E1:SOURCE-RECORD | W2 | [PARALLEL] {database-design} | source_record,citation | provenance row persists; citation FK enforced |
| T-119 | Postgres repo adapter: exposure upsert (unique incident,node) | eng-database | T-116,E1:EXPOSURE | W2 | [PARALLEL] {database-design} | exposure/EV2 | recompute upserts, no duplicate row |
| T-120 | Postgres repo adapter: alert save w/ approval invariant | eng-database | T-116,T-097,E1:ALERT | W2 | [SEC] {database-design} | alert/Art.XIII | ACTUAL without approver rejected by DB |
| T-121 | Postgres repo adapter: region + threshold_rule read/write | eng-database | T-116,E1:REGION | W2 | [PARALLEL] {database-design} | region,threshold_rule | region findById + rules-by-scope query |
| T-122 | Repo integration test: query/save across aggregates on real test DB | eng-qa | T-117,T-118,T-119,T-120,T-121 | W2 | [SEC] {integration-testing} | Art.II | findById/save/query pass against live Postgres |
| T-123 | Write failing SpatialPort contract test (point-in-polygon/buffer/intersect) | eng-qa | E1:SpatialPort | W1 | [PARALLEL] {tdd-cycle} | ADR-005/Art.XII | Red: no adapter yet |
| T-124 | Turf.js SpatialPort default: pointInPolygon impl | eng-data | T-123 | W1 | [PARALLEL] {geospatial} | ADR-005 | pointInPolygon test green, deterministic |
| T-125 | Turf.js SpatialPort default: buffer + intersect impl | eng-data | T-124 | W1 | {geospatial} | ADR-005/EV2 | buffer+intersect tests green |
| T-126 | SpatialPort integration test: exposure geometry via Turf on fixtures | eng-qa | T-125 | W2 | {integration-testing} | ADR-005/EV2 | node-in-hazard computed deterministically |
| T-127 | PostGIS SpatialPort stub behind FEATURE_SPATIAL flag | eng-data | T-125 | W2 | [PARALLEL] {geospatial} | ADR-005/§MIGRATION_PLAN §4 | flag selects stub; same contract signature |
| T-128 | CachePort last-known-good store (in-memory default) + test | eng-data | E1:CachePort | W1 | [PARALLEL][SEC] {caching} | F6 | get returns last good value after source miss |
| T-129 | Region registry seed loader: CA LIVE + Romania CACHED from config | eng-data | T-093,T-121 | W2 | [SEC] {database-design} | ADR-011/§D-U4 | loader test asserts 2 regions + per-region modes |
| T-129b | **Backup/restore drill**: `pg_dump` snapshot script + documented restore + a test asserting a round-trip restore reproduces seed+data (demo-day DR; SECURITY_BASELINE §3) | eng-database | T-116 | W2 | [PARALLEL] {database-design} | SECURITY_BASELINE §3/D-35 | dump→drop→restore reproduces row counts |
| T-129a | **Retention purge job** (QueuePort cron): delete/anonymize `public_report` rows past `purgeAfter` + expired precise-geom; hash-chained AUDIT_EVENT per purge run (D-34 — enforces the domain's no-PII-retention promise, Art. XIV/UW6) | eng-data | T-098,T-116,E1:PUBLIC_REPORT | W2 | [SEC] {database-design} | UW6/Art.XIV/E1·T-061/D-34 | test: expired report purged, unexpired kept, audit event written |

**Cross-epic:** E4 needs `RepositoryPort.save` (provenance→source_record, T-118), `CachePort` (T-128, F6), `SpatialPort` (T-124/125). E5 needs deterministic SpatialPort + exposure upsert (T-119) + threshold reads (T-121) + DB alert-approval invariant (T-120).
**✅ RESOLVED (D-27):** the seed is now **Romania (EU Flood)** — `MIGRATION_PLAN.md §5` region name→"Romania (EU Flood)", scope→COUNTRY, bbox→RO polygon, `enabled_adapters`→+meteoalarm-ro +worldpop, +a MeteoAlarm-RO `source_record`, shelter→Bucharest/IGSU; `schema.sql` seed comment + SPEC §3.4 updated. **EFAS vs GloFAS reconciled:** GloFAS (global) is seeded for uniformity; **EFAS** (European Flood Awareness System, higher-res over Europe) is documented as the *live* European upgrade the same CEMS adapter can target — they are distinct Copernicus products, not a naming clash. T-104 now mirrors the persisted `prev_hash/hash` audit columns (D-27).
**Remaining (S05):** finalize exact RO endpoints/keys at build; US-only sources return `NOT_COVERED` for RO.
