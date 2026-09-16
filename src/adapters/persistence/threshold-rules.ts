// BEACON — operator-edited threshold rules, read back from the table (ADR-044 follow-up, 2026-09-14).
//
// The seed fills `threshold_rule` from config/reference-data.json so operators can SEE the rules; until now
// the live composition still evaluated the configuration file, so an operator's edit to the table changed
// nothing. This reader is the other half: the rows, scoped by the region's CONFIG id (`us-ca`), which is
// what the evaluator and GET /threshold-rules speak — the table stores the region's uuid (FK).
import { eq } from 'drizzle-orm';
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { RegionId } from '@/domain/value-objects/ids.js';
import type { Db } from './client.js';
import { thresholdRuleMapper } from './mappers.js';
import { region, thresholdRule } from './schema.js';

/**
 * Every rule row, as the domain rule the evaluator takes. A rule whose region row carries no natural key
 * (a pre-0009 database the seed has not upgraded) keeps the uuid scope — it then matches no region and
 * fires nothing, which is the honest reading of a rule nobody can attribute to a region.
 */
export async function loadThresholdRules(db: Db): Promise<readonly ThresholdRule[]> {
  const rows = await db
    .select({ rule: thresholdRule, regionDomainId: region.domainId })
    .from(thresholdRule)
    .leftJoin(region, eq(thresholdRule.scope, region.id));
  return rows.map(({ rule, regionDomainId }) => {
    const domain = thresholdRuleMapper.fromRow(rule);
    return typeof regionDomainId === 'string'
      ? { ...domain, scope: asId<RegionId>(regionDomainId) }
      : domain;
  });
}
