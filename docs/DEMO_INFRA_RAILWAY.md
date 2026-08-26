# BEACON — Railway demo infrastructure (app · database · Directus admin)

> The three things shown in the demo video and how to reach each one. Project: **sunny-stillness**
> (Railway, `production` environment). Secrets live only in Railway variables and the entrant's local
> `.env` — never in this repository.

## The three services

| Service | What it is | URL |
|---|---|---|
| **Quest-BEACON** | The product — the live COP | https://quest-beacon.up.railway.app |
| **Postgres** | The live database (`postgres-ssl:18`) | internal only, plus an on-demand TCP proxy |
| **directus** | Database admin UI over that same Postgres | https://directus-production-6b36.up.railway.app |

All three run in one Railway project, so the video can show the deployment graph, the app, and the
database administration side by side.

## Directus — database administration UI

Directus runs from the official `directus/directus:latest` image and is pointed at the **same Postgres
instance the application uses**, via Railway's service reference `${{Postgres.DATABASE_URL}}` — so no
credential is copied anywhere; Railway injects it at deploy time.

- **Admin UI:** https://directus-production-6b36.up.railway.app/admin
- **Credentials:** in the entrant's local `.env`-adjacent notes (never committed). Sign in at `/admin`.
- What it demonstrates on camera: the live schema, row-level data, and the fact that BEACON's
  persistence is a **real relational database**, not fixtures — browsable and editable by an operator
  with no SQL client installed.

### Configuration (Railway variables on the `directus` service)

| Variable | Value | Why |
|---|---|---|
| `DB_CLIENT` | `pg` | PostgreSQL driver |
| `DB_CONNECTION_STRING` | `${{Postgres.DATABASE_URL}}` | service reference — no copied secret |
| `DB_SSL__REJECT_UNAUTHORIZED` | `false` | Railway's Postgres uses a self-signed certificate |
| `KEY` / `SECRET` | generated | Directus session/token signing |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | set at install | creates the first admin **only on a fresh database** |
| `PUBLIC_URL` | **`https://<domain>`** — full URL, scheme included | see the gotcha below |
| `WEBSOCKETS_ENABLED` | `true` | live updates in the admin UI |
| `TELEMETRY` | `false` | no outbound telemetry from the demo |

### Three gotchas that cost real time — all fixed, recorded so they are not re-hit

1. **`PUBLIC_URL` must include the scheme.** Railway's `${{RAILWAY_PUBLIC_DOMAIN}}` expands to a bare
   hostname. Directus builds its admin asset paths from `PUBLIC_URL`, so a scheme-less value makes every
   JS/CSS request 404 and the admin UI renders as a blank page with a console full of failed loads. Set
   the full `https://…` URL.
2. **`ADMIN_EMAIL` is read only when the database is empty.** If the service ever boots against a database
   that already has `directus_*` tables, Directus logs `Database already initialized, skipping install`
   and **creates no admin at all** — so nobody can sign in, and changing the variable afterwards does
   nothing. Fix: drop the `directus_*` tables and let it bootstrap, or create the user via the Directus CLI.
3. **Use a real top-level domain in `ADMIN_EMAIL`.** Directus validates the address against the IANA TLD
   list on *every login*, so something like `admin@example.demo` is accepted at install and then rejected
   at sign-in with `"email" must be a valid email`.

### Making BEACON's tables visible in Directus

Directus only shows tables registered in its own data model, and its API **refuses** to register a table
that already exists (`Collection "x" already exists`). Pre-existing tables are therefore registered by
inserting their `directus_collections` rows directly:

```sql
insert into directus_collections (collection, icon, note)
values ('incident', 'local_fire_department', 'BEACON — incident')
on conflict (collection) do nothing;
```

All 19 BEACON tables are registered this way, each with an icon.

## Database

- Engine: PostgreSQL 18 (`ghcr.io/railwayapp-templates/postgres-ssl:18`), TLS required.
- The app reaches it over Railway's private network; nothing is exposed publicly by default.
- For external access (a SQL client, a migration run from a laptop), add a proxy and remove it after:

```bash
railway tcp-proxy create --service Postgres --port 5432   # returns host:port
railway tcp-proxy list   --service Postgres
railway tcp-proxy delete --service Postgres --proxy-id <id>
```

- `PostGIS is not installed` on this image. BEACON's default spatial engine is **Turf (in-process)**,
  which is why this does not affect the product; only `FEATURE_SPATIAL=postgis` would need a PostGIS
  image.

## Persistence posture — as currently deployed

`FEATURE_STORE=postgres` with `DATABASE_URL=${{Postgres.DATABASE_URL}}`, so the app and Directus share one
database and anything done in the COP becomes a row an operator can open in Directus.

**Migrations run automatically.** Railway's *pre-deploy command* is `node scripts/migrate.mjs` — the
production migrator that exists precisely because the runtime image prunes devDependencies, so
`drizzle-kit` is unavailable there. It is idempotent and fail-fast: a broken migration blocks the deploy
rather than shipping an app whose inserts would fail at runtime.

> Setting `FEATURE_STORE=postgres` **without** that pre-deploy step is a silent trap: the app boots, the
> COP loads, and only endpoints touching the store fail — `/sources` returns a `source_record` missing-table
> error. Migrate first.

**Reference seed.** `region` (5 zones), `shelter`, `app_user` (4 roles) and `source_record` are seeded from
the project's own `buildSeed()` (`src/adapters/persistence/seed.ts`), generated rather than hand-written so
the demo data can never drift from the code. Locally the same thing is `npm run demo:reset` with
`FEATURE_STORE=postgres`. The operational tables (incidents, tasks, alerts, reports, audit) start empty by
design and fill as the product is used — which is the loop worth filming.

## Recording order that tells the clearest story

1. **The product** — the COP at the app URL, signed in, driving the golden path.
2. **The deployment** — the Railway project: three services, deploy history, green checks.
3. **The database** — Directus at `/admin`: the schema, then a table whose rows you just created in
   step 1. That closes the loop from operator action → durable, inspectable record.

*Related: [`docs/CLOUD_DEPLOY_RAILWAY.md`](CLOUD_DEPLOY_RAILWAY.md) (deploy runbook) ·
[`docs/LIVE_PRODUCTION_GUIDE.md`](LIVE_PRODUCTION_GUIDE.md) (running every source live) ·
[`docs/OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md) (using the product).*
