// BEACON — the shipped reference dataset is held to the SAME invariants an operator's Directus edit is.
//
// The point of these tests is not that the loader parses JSON. It is that `config/reference-data.json`
// cannot drift into a state the product would refuse to serve: every row here goes through the real domain
// and application factories, so a supply lot with a bare number, a callsign that reads like a person's name
// or a NEED entry carrying a damage severity fails the SUITE, long before it fails a seed run against a
// live database.
//
// Each rejection case below was mutation-checked the only way that proves anything: the guard was disabled,
// the test was watched to go red, and only then was it kept. That pass also recorded WHICH guard catches
// each case, and two of them are not the factory — `unit` and `licence` are required fields, so the
// structural check refuses them before any factory runs. The test names below say so, because a test named
// after a guard that is not the one doing the work is how a suite starts describing a system it isn't
// testing.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadReferenceRegistry } from './reference-registry';

/** Write a throwaway document and load it. Keeps every negative case off the shipped file. */
function loadDoc(doc: unknown): ReturnType<typeof loadReferenceRegistry> {
  const path = join(mkdtempSync(join(tmpdir(), 'beacon-ref-')), 'reference-data.json');
  writeFileSync(path, JSON.stringify(doc), 'utf8');
  return loadReferenceRegistry(path);
}

/** A minimal valid document; each test below breaks exactly one thing in it. */
function baseDoc(): Record<string, unknown> {
  return {
    version: 1,
    supply_lots: [{ domain_id: 's1', region_id: 'us-ca', quantity: 10, unit: 'EACH' }],
    volunteer_teams: [
      {
        domain_id: 't1',
        region_id: 'us-ca',
        callsign: 'TEAM ALPHA 3',
        headcount: 4,
        skills: ['first aid'],
        availability: 'AVAILABLE',
      },
    ],
    damage_assessment_entries: [
      {
        domain_id: 'd1',
        incident_domain_id: 'inc-1',
        report_status: 'VERIFIED',
        category: 'DAMAGE',
        severity: 'MINOR',
        site_count: 1,
      },
    ],
    ems_overlay_products: [
      {
        domain_id: 'EMSR999',
        region_id: 'es',
        activation_code: 'EMSR999',
        product_type: 'DELINEATION',
        area_of_interest: 'Test AOI',
        produced_at: '2026-07-01T00:00:00Z',
        provider: 'Copernicus Emergency Management Service',
        licence: 'CC BY 4.0',
        view_url: 'https://rapidmapping.emergency.copernicus.eu/EMSR999',
      },
    ],
  };
}

describe('the shipped reference dataset', () => {
  it('loads, and every row survives its own factory', () => {
    const registry = loadReferenceRegistry();
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    // Non-empty on all four, because an empty dataset would make every assertion below vacuous — the
    // "gate that cannot fail for the thing it covers" defect this project keeps finding.
    expect(registry.value.supplyLots.length).toBeGreaterThan(0);
    expect(registry.value.volunteerTeams.length).toBeGreaterThan(0);
    expect(registry.value.damageEntries.length).toBeGreaterThan(0);
    // EMS product rows are intentionally deferred until product-detail ids are available.
    expect(registry.value.emsProducts.length).toBe(0);
  });

  it('scopes every region-scoped row to a region that exists in config/regions.json', async () => {
    const registry = loadReferenceRegistry();
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const { loadRegionRegistry } = await import('./region-registry');
    const regions = loadRegionRegistry();
    expect(regions.ok).toBe(true);
    if (!regions.ok) return;
    const known = new Set(regions.value.regions.map((r) => r.configId));
    const scoped = [
      ...registry.value.supplyLots.map((r) => r.regionConfigId),
      ...registry.value.volunteerTeams.map((r) => r.regionConfigId),
      ...registry.value.emsProducts.map((r) => r.regionConfigId),
    ];
    expect(scoped.length).toBeGreaterThan(0);
    for (const id of scoped) expect(known).toContain(id);
  });

  it('gives every row a domain id that is unique within its dataset', () => {
    const registry = loadReferenceRegistry();
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    // The DB enforces this with a UNIQUE constraint, which means a duplicate does not fail the seed — the
    // ON CONFLICT DO NOTHING swallows it and one of the two rows silently never arrives.
    for (const rows of [
      registry.value.supplyLots.map((r) => r.domainId),
      registry.value.volunteerTeams.map((r) => r.domainId),
      registry.value.damageEntries.map((r) => r.domainId),
      registry.value.emsProducts.map((r) => r.domainId),
    ]) {
      expect(new Set(rows).size).toBe(rows.length);
    }
  });

  it('states a licence on every EMS overlay row', () => {
    const registry = loadReferenceRegistry();
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    // Art. XI — an overlay whose terms nobody recorded may not be shown at all.
    for (const p of registry.value.emsProducts) expect(p.licence.trim()).not.toBe('');
  });

  it('links every EMS overlay to the publisher, never to a BEACON-hosted copy', () => {
    const registry = loadReferenceRegistry();
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    // FR-D4-5 is LINK-ONLY: BEACON never mirrors, re-hosts or dereferences a rapid-mapping product.
    for (const p of registry.value.emsProducts) {
      expect(p.viewUrl.startsWith('https://rapidmapping.emergency.copernicus.eu/')).toBe(true);
      expect(p.viewUrl).toContain(p.activationCode);
    }
  });
});

describe('a malformed reference document', () => {
  it('is refused when a supply lot has no unit (structural check, before the factory)', () => {
    const doc = baseDoc();
    (doc['supply_lots'] as Record<string, unknown>[])[0]!['unit'] = undefined;
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('supply_lots');
  });

  it('is refused when a callsign is not an uppercase unit designator (the real factory)', () => {
    const doc = baseDoc();
    // The ADR-035 §4 shape rule: a callsign that reads like a person's name is refused on a SEEDED row too.
    (doc['volunteer_teams'] as Record<string, unknown>[])[0]!['callsign'] = 'Jane Smith';
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('volunteer_teams[t1]');
  });

  it('is refused when a NEED entry carries a damage severity (the real factory)', () => {
    const doc = baseDoc();
    const entry = (doc['damage_assessment_entries'] as Record<string, unknown>[])[0]!;
    entry['category'] = 'NEED';
    entry['need_kind'] = 'WATER';
    // Keeping `severity` is the defect: it would let a needs report be summed as damage severity.
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('damage_assessment_entries[d1]');
  });

  it('is refused when an EMS overlay has no licence (structural check, before the factory)', () => {
    const doc = baseDoc();
    (doc['ems_overlay_products'] as Record<string, unknown>[])[0]!['licence'] = '';
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('ems_overlay_products[EMSR999]');
  });

  it('is refused when an instant will not parse', () => {
    const doc = baseDoc();
    (doc['ems_overlay_products'] as Record<string, unknown>[])[0]!['produced_at'] = 'last Tuesday';
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('not a parseable instant');
  });

  it('returns an error rather than throwing when the file is missing', () => {
    const res = loadReferenceRegistry('config/does-not-exist.json');
    expect(res.ok).toBe(false);
  });

  it('is refused when an optional string is present with a non-string type', () => {
    const doc = baseDoc();
    (doc['damage_assessment_entries'] as Record<string, unknown>[])[0]!['severity'] = 123;
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('damage_assessment_entries[d1].severity');
  });

  it('is refused when an optional number is present with a non-number type', () => {
    const doc = baseDoc();
    (doc['damage_assessment_entries'] as Record<string, unknown>[])[0]!['site_count'] = '7';
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('damage_assessment_entries[d1].site_count');
  });

  it('is refused when a dataset contains duplicate domain ids', () => {
    const doc = baseDoc();
    const rows = doc['supply_lots'] as Record<string, unknown>[];
    rows.push({ ...rows[0]! });
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('duplicate domain_id');
  });

  it('returns an error rather than throwing when the JSON root is null', () => {
    const res = loadDoc(null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('root must be an object');
  });
});

// ── The five datasets added 2026-09-12 ────────────────────────────────────────────────────────────────
describe('the operational datasets', () => {
  it('ships a non-empty set of each, because an empty one would make every check below vacuous', () => {
    const registry = loadReferenceRegistry();
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    expect(registry.value.incidents.length).toBeGreaterThan(0);
    expect(registry.value.resources.length).toBeGreaterThan(0);
    expect(registry.value.resourceTasks.length).toBeGreaterThan(0);
    expect(registry.value.publicReports.length).toBeGreaterThan(0);
    expect(registry.value.thresholdRules.length).toBeGreaterThan(0);
  });

  it('is refused when a task names a resource that does not exist', () => {
    // The FK would catch this at INSERT with a constraint name and a uuid. Here it is caught at load,
    // with the domain ids an operator actually typed.
    const doc = baseDoc();
    doc['incidents'] = [
      { domain_id: 'inc-1', region_id: 'us-ca', type: 'WILDFIRE', status: 'ACTIVE' },
    ];
    doc['resources'] = [
      { domain_id: 'r1', region_id: 'us-ca', kind: 'ENGINE', status: 'AVAILABLE' },
    ];
    doc['resource_tasks'] = [
      {
        domain_id: 't1',
        resource_domain_id: 'r-nope',
        incident_domain_id: 'inc-1',
        status: 'TASKED',
      },
    ];
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain("names resource 'r-nope'");
  });

  it('is refused when a report names an incident that does not exist', () => {
    const doc = baseDoc();
    doc['public_reports'] = [
      {
        domain_id: 'rep-1',
        incident_domain_id: 'inc-nope',
        source: 'WEB',
        category: 'SOS',
        status: 'UNVERIFIED',
        text: 'test',
        purge_after: '2027-01-01T00:00:00Z',
      },
    ];
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain("names incident 'inc-nope'");
  });

  it('is refused when a threshold rule carries a negative cooldown (the real factory)', () => {
    const doc = baseDoc();
    doc['threshold_rules'] = [
      {
        domain_id: 'rule-1',
        region_id: 'us-ca',
        target: 'GAUGE_CATEGORY',
        operator: 'gte',
        value: 'MAJOR',
        cooldown: -60,
      },
    ];
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('threshold_rules[rule-1]');
  });

  it('is refused when a resource carries half a coordinate', () => {
    // Half a location is not a location: accepting it would put an engine on the null island.
    const doc = baseDoc();
    doc['resources'] = [
      { domain_id: 'r1', region_id: 'us-ca', kind: 'ENGINE', status: 'AVAILABLE', lon: -121.6 },
    ];
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('BOTH lon and lat');
  });

  it('is refused when an incident declares a type the domain does not have (the real factory)', () => {
    const doc = baseDoc();
    doc['incidents'] = [
      { domain_id: 'inc-1', region_id: 'us-ca', type: 'EARTHQUAKE', status: 'ACTIVE' },
    ];
    const res = loadDoc(doc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('incidents[inc-1]');
  });

  it('accepts a document written before these datasets existed', () => {
    // Additive, not breaking: the four original datasets are required, these five are not. Otherwise
    // every addition here would break every config file in the field.
    const res = loadDoc(baseDoc());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.incidents).toEqual([]);
    expect(res.value.thresholdRules).toEqual([]);
  });
});
