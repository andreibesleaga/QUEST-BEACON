# BEACON — Drizzle Migration Plan (S03)

*How `schemas/schema.sql` (the human-authored reference DDL) maps to **Drizzle ORM /
drizzle-kit** migrations (ADR-013), how the GeoJSON-jsonb ↔ PostGIS switch works behind the
SpatialPort flag (ADR-005), and the seed strategy. Source of truth for the schema itself is
`docs/architecture/DOMAIN_MODEL.md`.*

> **Phase note:** the project is PAUSED at S04 (AGENTS.md §14). This plan is the *target*
> workflow for S05 scaffolding — no `package.json`, `drizzle.config.ts`, or `src/` exists yet.
> Do not run any of these commands until the S04 gate is approved.

---

## 1. Approach — Drizzle schema-file is the source of truth (code-first)

Per ADR-013, Drizzle is SQL-first and ships **no engine binary**, sitting behind the
`RepositoryPort` (Article II — the only layer touching the ORM). We adopt the **schema-file**
workflow:

- The TypeScript schema in `src/adapters/persistence/schema.ts` is authoritative for migrations.
- `schemas/schema.sql` in this repo is the **human-readable reference / contract** — it must stay
  behaviorally equivalent to the Drizzle schema (same tables, columns, enums-as-CHECK, FKs,
  indexes). A small drift test (§6) asserts the generated SQL matches this reference.
- `drizzle-kit generate` diffs the TS schema against migration history and emits SQL files into
  `drizzle/` (e.g. `drizzle/0000_init.sql`). `drizzle-kit migrate` applies them.

```
src/adapters/persistence/
  schema.ts          <- Drizzle tables (authoritative for migrations)
  client.ts          <- drizzle(pg) over DATABASE_URL (ADR-012)
  repository.ts      <- RepositoryPort adapter (only ORM consumer)
  spatial/
    turf.ts          <- SpatialPort default (GeoJSON in jsonb)
    postgis.ts       <- SpatialPort flag (raw ST_* SQL via drizzle `sql``)
drizzle/             <- generated migration SQL + meta/_journal.json
drizzle.config.ts    <- drizzle-kit config (schema path, out dir, dialect: postgresql)
schemas/schema.sql   <- this repo's reference DDL (review + drift target)
```

### `drizzle.config.ts` (target)

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/adapters/persistence/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! }, // ADR-012; local Postgres or Neon, no code change
  verbose: true,
  strict: true,
});
```

---

## 2. Mapping rules — schema.sql → Drizzle `pg-core`

| DDL construct (schema.sql) | Drizzle equivalent |
|---|---|
| `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | `uuid("id").primaryKey().defaultRandom()` |
| `text NOT NULL` | `text("...").notNull()` |
| `timestamptz NOT NULL DEFAULT now()` | `timestamp("...", { withTimezone: true }).notNull().defaultNow()` |
| `jsonb` (GeoJSON + payloads) | `jsonb("...")` (typed `.$type<GeoJSON.Geometry>()` etc.) |
| `double precision` | `doublePrecision("...")` |
| `integer` | `integer("...")` |
| `boolean ... DEFAULT false` | `boolean("...").default(false)` |
| enum via `CHECK (col IN (...))` | **`check()` in table extra-config** (we keep CHECK enums, not `pgEnum`, to match DOMAIN_MODEL and ease future value additions) |
| FK `REFERENCES x(id) ON DELETE ...` | `.references(() => x.id, { onDelete: "cascade" \| "set null" \| "restrict" })` |
| `CREATE INDEX` | `index("name").on(table.col)` in table extra-config |
| `UNIQUE (a,b)` | `unique("name").on(table.a, table.b)` |
| composite `CHECK` (e.g. alert approval) | `check("name", sql\`...\`)` in extra-config |

**Enums:** we deliberately model enums as **CHECK constraints** (not `CREATE TYPE`/`pgEnum`) so the
allowed values live in one place that mirrors `DOMAIN_MODEL.md`, and adding a value is a cheap
migration rather than an `ALTER TYPE`. Drizzle expresses these with `check(... sql\`col IN (...)\`)`.

**Triggers / `set_updated_at()` / optional alert-approval trigger:** drizzle-kit does not manage
triggers or functions. They are added via a **custom SQL migration** (`drizzle-kit generate
--custom`) and committed alongside the generated table migrations.

---

## 3. Migration workflow

```bash
# 0. pin Node + install (S05)
nvm use && npm install

# 1. author/edit src/adapters/persistence/schema.ts (authoritative)

# 2. generate a migration from the schema diff
npx drizzle-kit generate            # writes drizzle/NNNN_*.sql + meta/_journal.json

# 2b. hand-written pieces (triggers, functions, seed) when needed
npx drizzle-kit generate --custom --name add_triggers

# 3. review the generated SQL  <-- MANDATORY (ADR-013 risk: young tooling)
#    diff it against schemas/schema.sql; never apply un-reviewed migrations

# 4. apply migrations
npx drizzle-kit migrate             # AGENTS.md §2 canonical migrate command

# (dev only, throwaway DB) push without a migration file:
# npx drizzle-kit push

# inspect:
npx drizzle-kit studio              # optional GUI
```

- **Migrations are immutable + ordered** (`drizzle/meta/_journal.json`); never edit an applied
  migration — add a new one.
- **CI** runs `drizzle-kit migrate` against a throwaway Postgres (Gate 4, Docker Compose) and the
  drift test (§6) before merge.
- **Cloud parity:** identical migrations run against Neon by swapping only `DATABASE_URL`
  (ADR-012) — no code change.

---

## 4. GeoJSON-jsonb ↔ PostGIS switch (SpatialPort flag — ADR-005)

The geometry **storage type** is the only schema-level difference between the two spatial modes,
and it is gated by `FEATURE_SPATIAL` (`turf` default | `postgis`).

### Default — `FEATURE_SPATIAL=turf` (no extension, air-gapped, ~$0)
- Geometry columns are `jsonb` holding GeoJSON (the active columns in `schema.sql`).
- The **Turf SpatialPort** (`spatial/turf.ts`) reads the GeoJSON in-process and computes
  intersection/distance/buffer with Turf.js (deterministic, server + client, Article XII).
- Cheap spatial pre-filtering uses cached `bbox` jsonb + a GIN index (already in `schema.sql`).
- Drizzle: `jsonb("geom").$type<GeoJSON.Geometry>()`.

### Flag — `FEATURE_SPATIAL=postgis` (indexed server-side joins at scale)
- Run `CREATE EXTENSION postgis;`, switch the geometry columns to `geometry(Geometry,4326)`
  (the `-- [POSTGIS]` lines in `schema.sql`), and create the GIST indexes (bottom of `schema.sql`).
- The **PostGIS SpatialPort** (`spatial/postgis.ts`) issues raw spatial SQL via Drizzle's
  first-class `sql\`\`` escape hatch (e.g. `ST_Intersects`, `ST_DWithin`, `ST_GeomFromGeoJSON`).
- **Same SpatialPort contract**, same behavior contract tests run against both adapters
  (ADR-005) — the only consumer-visible difference is performance.

### Switch strategy (no data-loss, reversible)
1. The two modes are **separate migration sets** selected by env at migrate time, OR a single
   migration that branches on `FEATURE_SPATIAL`. Recommended: keep the **GeoJSON-jsonb schema as
   the baseline** and provide a **PostGIS upgrade migration** that:
   - `CREATE EXTENSION IF NOT EXISTS postgis;`
   - adds a `geometry(...,4326)` column per geometry field,
   - back-fills it with `ST_SetSRID(ST_GeomFromGeoJSON(geom_jsonb), 4326)`,
   - swaps the column (drop jsonb or keep both during transition), adds GIST indexes.
2. Authored as a **custom drizzle migration** (drizzle-kit cannot infer the PostGIS types) and
   guarded so it is only applied when the operator opts into PostGIS.
3. **Downgrade** is the inverse: regenerate GeoJSON via `ST_AsGeoJSON(geom)::jsonb`, drop the
   PostGIS column + extension. Because the canonical form is portable GeoJSON, switching either way
   never loses geometry (ADR-005 "geometry persisted in a portable form usable by either engine").
4. Application code never branches on storage type — it only depends on the active SpatialPort, so
   the switch is a deploy/config concern, contained to the persistence adapter (Article II/XV).

---

## 5. Seed strategy

- **Reference seed** (single-sourced here — `schemas/schema.sql` points back to this section) covers a
  CA flagship region (LIVE) + the **Romania (EU) flood region (CACHED)** (confirmed by Entrant 2026-06-29,
  D-25), one `SOURCE_RECORD` per mode, agency-seeded shelters, and one `APP_USER` per RBAC role. Flood is
  seeded with **`copernicus-glofas` / "Copernicus GloFAS"** (the global product) and fire with
  **`copernicus-effis` / "Copernicus EFFIS"**. **GloFAS ≠ EFAS** (distinct Copernicus CEMS products): for
  the Romania (European) region, **EFAS** (European Flood Awareness System — higher resolution over Europe)
  is the natural *live* upgrade the same CEMS/`copernicus-glofas` adapter can target; the demo seeds GloFAS
  for global uniformity. **MeteoAlarm-RO** + **Open-Meteo** provide the Romania weather/alert equivalents;
  US-only sources (NFHL/EAGLE-I/NRI) return `NOT_COVERED` for RO (OP4):

```sql
-- Regions ------------------------------------------------------------------
INSERT INTO region (id, name, scope, bbox, enabled_adapters, source_mode_overrides) VALUES
  ('00000000-0000-0000-0000-0000000000ca', 'California (Flagship)', 'STATE',
   '{"type":"Polygon","coordinates":[[[-124.48,32.53],[-114.13,32.53],[-114.13,42.01],[-124.48,42.01],[-124.48,32.53]]]}'::jsonb,
   '["firms-adapter","nws-adapter","overpass-adapter","nwps-adapter","usgs-water-adapter","ors-adapter"]'::jsonb,
   '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000eu', 'Romania (EU Flood)', 'COUNTRY',
   '{"type":"Polygon","coordinates":[[[20.2,43.6],[29.7,43.6],[29.7,48.3],[20.2,48.3],[20.2,43.6]]]}'::jsonb,
   '["gdacs-adapter","open-meteo-adapter","meteoalarm-ro-adapter","copernicus-glofas-adapter","copernicus-effis-adapter","worldpop-adapter"]'::jsonb,
   '{"copernicus-glofas-adapter":"CACHED","copernicus-effis-adapter":"CACHED","meteoalarm-ro-adapter":"CACHED","google-floodhub-adapter":"CACHED"}'::jsonb);

-- Source records -----------------------------------------------------------
INSERT INTO source_record (id, source, adapter, license, mode) VALUES
  ('00000000-0000-0000-0000-00000000s001', 'NASA FIRMS', 'firms-adapter', 'NASA open', 'LIVE'),
  ('00000000-0000-0000-0000-00000000s002', 'Copernicus GloFAS', 'copernicus-glofas-adapter', 'Copernicus', 'CACHED'),
  ('00000000-0000-0000-0000-00000000s003', 'Copernicus EFFIS', 'copernicus-effis-adapter', 'Copernicus', 'CACHED'),
  ('00000000-0000-0000-0000-00000000s004', 'MeteoAlarm (Romania)', 'meteoalarm-ro-adapter', 'EUMETNET MeteoAlarm', 'CACHED');

-- App users (one per role) -------------------------------------------------
INSERT INTO app_user (id, role, org) VALUES
  ('00000000-0000-0000-0000-0000000usr01', 'PUBLIC',    NULL),
  ('00000000-0000-0000-0000-0000000usr02', 'RESPONDER', 'CAL FIRE'),
  ('00000000-0000-0000-0000-0000000usr03', 'VERIFIER',  'Cal OES'),
  ('00000000-0000-0000-0000-0000000usr04', 'EM',        'Cal OES EOC');

-- Shelters (agency-seeded) -------------------------------------------------
INSERT INTO shelter (geom, capacity, occupancy, status, org) VALUES
  ('{"type":"Point","coordinates":[-121.49,38.58]}'::jsonb, 500, 120, 'OPEN', 'American Red Cross'),
  ('{"type":"Point","coordinates":[-119.77,36.74]}'::jsonb, 300,  90, 'OPEN', 'Cal OES'),
  ('{"type":"Point","coordinates":[26.10,44.43]}'::jsonb,   200,   0, 'OPEN', 'IGSU (Romania)');
```

- **Runtime seed** is a Drizzle script `src/adapters/persistence/seed.ts` run via
  `npm run db:seed` (idempotent upserts keyed by the fixed demo UUIDs), invoked after `migrate` in
  local `docker compose up` and in CI integration (Gate 4).
- Seeds insert **GeoJSON** (default). Under PostGIS the same script wraps geometry with
  `sql\`ST_GeomFromGeoJSON(${json})\``, so one seed source feeds both modes.
- Seed data respects invariants: shelters `occupancy <= capacity`; `public_report.consent = true`;
  no `ACTUAL` alert without `approved_by`. No PII in seeds (UW6).
- Larger demo fixtures (live-ish CA incident + EU cached flood) load from recorded adapter
  fixtures (`SOURCE_*_MODE=cached|mock`, OP3), not from this DDL seed.

---

## 6. Quality gates for migrations

- **Drift test:** generate SQL from `schema.ts` into a scratch DB, dump it, and assert table/
  column/enum-CHECK/FK/index parity with `schemas/schema.sql` (catches reference vs Drizzle drift).
- **Round-trip test:** `migrate` up on a clean Postgres in CI (Gate 4) succeeds; SpatialPort
  contract tests pass against **both** `turf` and `postgis` (ADR-005).
- **Review every generated migration** before merge (ADR-013 risk mitigation: drizzle-kit is young).
- **Invariant tests:** the `alert` ACTUAL-requires-approved_by CHECK, shelter occupancy CHECK,
  public_report consent CHECK, and SITREP↔CITATION FK integrity are asserted at S03 contract-test
  level; app-layer guards cover `geom_precise` responder-only (Art. XIV — not a DB constraint).

---

## 7. References
- `docs/architecture/DOMAIN_MODEL.md` — canonical ER (source of truth).
- `docs/architecture/decisions/ADR-013-orm-prisma-vs-drizzle.md` — Drizzle decision.
- `docs/architecture/decisions/ADR-005-persistence-postgres-turf-postgis-flag.md` — geo flag.
- `docs/architecture/decisions/ADR-012` — `DATABASE_URL` local↔cloud parity.
- AGENTS.md §2 — `npx drizzle-kit migrate` canonical command.
- orm.drizzle.team (schema, drizzle-kit) ; postgis.net ; postgresql.org/docs.
