// BEACON — natural-key resolvers: the translation layer the FKs were missing (ADR-039 §2; V2·A2).
//
// THE DEFECT CLASS, STATED ONCE. The schema addresses rows by SURROGATE uuid; the domain addresses them by
// NATURAL key — an incident is `us-ca-wildfire-demo`, a source is `firms` or `news:apnews.com`. No layer
// translated between the two, so two write paths were dead on arrival and stayed uncomposed for a release:
// `sitrep.incident_id` rejected the domain incident id, and every `citation.source_id` violated its FK,
// rolling back the whole SitRep because that write is all-or-nothing.
//
// WHY NOT WIDEN THE COLUMNS. Turning those FKs into text would make the writes succeed and quietly delete
// the guarantee the entire product rests on: that every figure an operator reads can be walked back to a
// stored source row. The FKs stay; this file does the translating.
//
// UPSERT-ON-MISS, FOR SOURCES ONLY. A citation may name a source the COP has cited but not yet polled — a
// news host, typically — and refusing to record it would lose the grounding entirely. So a source row is
// created on demand. An INCIDENT is never invented: a SitRep whose incident cannot be resolved is skipped
// and logged, because fabricating a parent row to make an insert succeed would put a fictional lineage into
// the audit trail judges are asked to trust.
import { count, eq, isNull, sql } from 'drizzle-orm';
import type { SourceMode } from '@/domain/source-record.js';
import {
  NEWS_OUTLET_LICENSE,
  isNewsOutletSourceId,
} from '@/application/sitrep-synthesis/news-grounding.js';
import type { Db } from './client.js';
import { incident, region, resource, sourceRecord } from './schema.js';

/**
 * Context recorded when a cited-but-unpolled source is materialised.
 *
 * `mode` is deliberately the THREE-RUNG `SourceMode`, not the four-value served vocabulary A12 introduced
 * (ADR-041 §3). Everything this resolver can ever create is an ADAPTER source a SitRep cited — a news host,
 * typically — and an operator-maintained `DB` row is by construction not one of those: nothing types a panel
 * row into a citation. Taking the wider type here would let a value that cannot legitimately occur compile,
 * which is the same silent-mis-rank hazard `news-grounding.ts` closes one layer up.
 */
export interface SourceKeyContext {
  readonly adapter?: string;
  readonly mode?: SourceMode;
  readonly fetchedAt?: string;
  /** The licence to record; an outlet key (`news:<host>`) defaults to NEWS_OUTLET_LICENSE. */
  readonly license?: string;
}

/**
 * The licence a materialised row carries. A source row without one is refused by the domain (Art. XI), and
 * the only sources this resolver ever creates on demand are cited outlets — so an outlet key gets the
 * outlet licence, a caller may supply one, and any other unknown key records none (never a guessed one).
 */
function licenseFor(sourceKey: string, ctx: SourceKeyContext): string | undefined {
  if (ctx.license !== undefined) return ctx.license;
  return isNewsOutletSourceId(sourceKey) ? NEWS_OUTLET_LICENSE : undefined;
}

/**
 * Resolve a source's natural key to the uuid `citation.source_id` must carry, creating the row when the
 * source has not been seen yet.
 *
 * `ON CONFLICT DO UPDATE` rather than `DO NOTHING` is deliberate: `DO NOTHING` returns no row on conflict,
 * which would report "missing" for a source that plainly exists. The update is a self-assignment — it
 * changes nothing and makes RETURNING yield the surviving row's id, which is exactly the stable uuid the
 * provenance sink maintains for that source.
 */
export async function resolveSourceRowId(
  db: Db,
  sourceKey: string,
  ctx: SourceKeyContext = {},
): Promise<string> {
  const license = licenseFor(sourceKey, ctx);
  const rows = await db
    .insert(sourceRecord)
    .values({
      source: sourceKey,
      adapter: ctx.adapter ?? sourceKey,
      mode: ctx.mode ?? 'MOCK', // unknown provenance is labelled at its WEAKEST, never assumed LIVE (Art. XI)
      ...(ctx.fetchedAt !== undefined ? { fetchedAt: new Date(ctx.fetchedAt) } : {}),
      ...(license !== undefined ? { license } : {}),
    })
    .onConflictDoUpdate({
      target: sourceRecord.source,
      // Self-assignment so RETURNING yields the surviving row; the licence is HEALED where the row holds
      // NULL (an outlet materialised before 2026-09-15) and never overwritten where it holds one.
      set: {
        source: sourceKey,
        license: sql`coalesce(${sourceRecord.license}, excluded.license)`,
      },
    })
    .returning({ id: sourceRecord.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`source_record upsert returned no row for '${sourceKey}'`);
  return id;
}

/**
 * Resolve an incident's domain id to its stored uuid, or `null` when no such incident exists.
 *
 * `null` is a first-class answer, not a failure: the caller SKIPS the write rather than inventing a parent.
 * A uuid-shaped id is matched against the primary key as well, so a DB-minted incident resolves without a
 * natural key ever having been assigned.
 */
export async function resolveIncidentRowId(
  db: Db,
  domainIncidentId: string,
): Promise<string | null> {
  const byDomain = await db
    .select({ id: incident.id })
    .from(incident)
    .where(eq(incident.domainId, domainIncidentId))
    .limit(1);
  if (byDomain[0] !== undefined) return byDomain[0].id;
  if (!isUuid(domainIncidentId)) return null; // not a natural key we know, and not a uuid to try
  const byPk = await db
    .select({ id: incident.id })
    .from(incident)
    .where(eq(incident.id, domainIncidentId))
    .limit(1);
  return byPk[0]?.id ?? null;
}

/** RFC 4122 shape check — guards a uuid-typed column from being queried with a domain string (a pg type error). */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Resolve a region's config id (`us-ca`) to its stored uuid, or `null` when that region has never been
 * seeded. Same shape as {@link resolveIncidentRowId}, and for the same reason: `incident.region_id` is a
 * uuid FK while every other layer of BEACON names regions by their config id.
 */
export async function resolveRegionRowId(db: Db, domainRegionId: string): Promise<string | null> {
  const byDomain = await db
    .select({ id: region.id })
    .from(region)
    .where(eq(region.domainId, domainRegionId))
    .limit(1);
  if (byDomain[0] !== undefined) return byDomain[0].id;
  if (!isUuid(domainRegionId)) return null;
  const byPk = await db
    .select({ id: region.id })
    .from(region)
    .where(eq(region.id, domainRegionId))
    .limit(1);
  return byPk[0]?.id ?? null;
}

/**
 * How many region rows carry no natural key. On a seeded database the answer is 0; anything else means the
 * seed has never run against this database (or ran before migration 0009 and never again), which is the
 * one condition that silently empties every mirror and every operator table (2026-09-14, live).
 */
export async function regionsWithoutNaturalKey(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(region).where(isNull(region.domainId));
  return Number(row?.n ?? 0);
}

/**
 * Whether the reference seed must run against this database: region rows without a natural key (the
 * seed's first statement writes it), or an empty `resource` table (the operators' roster is reference
 * data the seed owns). Both are observable in one round trip and both mean the same thing — the seed has
 * not reached this database — which on the live deployment was the case after two redeploys with the
 * pre-deploy command configured (2026-09-14). ADR-046: the app then seeds itself.
 */
export async function needsSeed(db: Db): Promise<boolean> {
  if ((await regionsWithoutNaturalKey(db)) > 0) return true;
  const [row] = await db.select({ n: count() }).from(resource);
  return Number(row?.n ?? 0) === 0;
}
