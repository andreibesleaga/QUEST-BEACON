# ADR-039 — The database fills itself from the live world: provenance, incidents and the two FK defects

- **Status:** Accepted (2026-09-10) — decided and implemented in V2 work package A2.
- **Deciders:** Entrant (V2 plan §2·A2) + prod-architect
- **Relates to:** ADR-001 (ports & adapters), ADR-013 (Drizzle behind RepositoryPort), ADR-012 (config for
  everything), CONSTITUTION Art. XI (provenance is structural), Art. XVI (total redundancy — a storage
  failure must never dead-end the COP)
- **Closes:** `docs/audit/UNIMPLEMENTED_REGISTER.md` rows for `sitrep`/`citation`/`evac_route`
  (built-not-composed) and the two latent FK defects recorded there in the 2026-08-08 S3 sweep.

## Context

Under `FEATURE_STORE=postgres` the deployment came up with an **empty `/sources`**. Nothing was broken in
the read path: `makePgSourceReadModel` projects `source_record` faithfully. The table was simply empty,
because **nothing writes provenance at runtime**. Live provenance existed only inside the in-memory seed
that `live-composition.ts` assembles per region; the durable posture read a table that only the reference
seed ever populated.

The same shape of gap covers three more tables. `makePgSitRepHistoryStore` and `makePgEvacRouteStore` are
implemented, exported and **composed nowhere** — zero callers. And the register records why naively wiring
the SitRep pair would fail:

- **(a)** `sitrep.incident_id` is `uuid REFERENCES incident(id)`, but domain incident ids are strings like
  `us-ca-wildfire-demo`. The insert is rejected before it reaches the FK.
- **(b)** `citation.source_id` is `uuid REFERENCES source_record(id)`, but citations carry *source keys* —
  `firms`, `news:apnews.com` — not the uuid of a stored row. Because `sitrep-history.ts` writes
  all-or-nothing, one unresolvable citation rolls the whole SitRep back.

Both are the same underlying mistake, stated twice: **the schema addresses rows by surrogate uuid while the
domain addresses them by natural key**, and no layer translated between the two.

## Decision

### 1. Provenance is persisted where it is already assembled, keyed by its natural key

A `ProvenanceSinkPort` (one method, `record(entries)`) is written to from `live-composition.ts` at the
exact point each region's `SourceView[]` is assembled — the same projection `/sources` renders, so the
durable table mirrors what the COP actually consulted rather than a parallel truth.

The pg adapter **upserts on `source_record.source`** (new unique index, migration 0007), so the table holds
**one current row per source** instead of one row per poll. Two consequences make this the right key:
growth is bounded no matter how long the deployment runs, and — decisively — **each source's uuid becomes
stable**, which is exactly what a citation needs to point at.

Composed **only** under `FEATURE_STORE=postgres`; the memory posture passes no sink and is byte-identical.
The call is **fail-open**: a sink error is logged and the COP continues (Art. XVI). Provenance is a mirror
of what happened, never a gate on serving it.

### 2. The two FK defects are fixed by translating at the boundary, not by loosening the schema

The tempting fix — make the columns `text`, drop the FKs — would trade a write failure for silent
referential rot, in the one part of the system whose entire value is that every figure is traceable to a
stored source. The FKs stay. A resolver translates instead:

- **(b) `citation.source_id`**: resolve the citation's source key against `source_record.source`, and
  **upsert on miss** so a source the COP cited but has not yet polled (a news host such as
  `news:apnews.com`) materialises a row rather than failing the write. The upsert is the same one §1 uses,
  which is why the two halves of this ADR are one decision: the sink and the resolver share a key space.
- **(a) `sitrep.incident_id`**: resolve the domain incident id to its stored row. Incidents whose id is
  already a uuid resolve directly; a domain-keyed incident resolves through the same
  natural-key-to-surrogate lookup. When no incident row can be resolved, the SitRep is **skipped, not
  faked** — history is an audit artifact, and inventing a parent row to make an insert succeed would put a
  fictional lineage into the record judges are asked to trust.

### 3. Writes are advisory, everywhere

Every write path added here is wrapped so that a failure degrades to "not persisted" and is logged —
never a failed read, never a dead-ended operator action. This is the same posture the adapters already
take toward upstream sources, applied to our own storage.

## Consequences

**Good.** The durable posture stops being a claim and becomes observable: `/sources` fills within one poll
cycle, and the rows are the same ones the COP used. The tables Directus exposes are genuinely populated by
the live world, which is the "most real data possible" requirement, self-refreshing, per region. Two
long-recorded FK defects are closed properly rather than routed around, and `evac_route` / `sitrep` /
`citation` gain their first real write paths.

**Costs and limits, stated plainly.** `source_record` now holds one row per source rather than a fetch
log: current state, not history — the audit ledger, not this table, is where per-call history lives.
`source_record` still has no region column (the pre-existing documented limitation), so `/sources` remains
region-agnostic under postgres. Upsert-on-miss means a cited-but-unpolled source appears with the mode the
citation context reports, which is honest but is not evidence that source was *fetched*. And a SitRep whose
incident cannot be resolved is not persisted at all; that is a deliberate silence, logged, and preferable
to a fabricated parent.

**Rejected alternatives.** *Decorating all 44 adapters* — a uniform seam existed (`SourceAdapterPort.fetch`)
but it fires per fetch, multiplying writes for the same information the region assembly already aggregates.
*Appending a row per fetch* — unbounded growth, and no stable uuid for citations to reference. *Widening the
FK columns to text* — cheapest to write, and it silently discards the referential guarantee that makes the
provenance claim checkable.
