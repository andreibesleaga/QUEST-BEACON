// BEACON — default offline core seed (E-main). RAW INPUTS only: each incident carries the hazard geometry,
// candidate lifeline nodes, wind/gauge inputs, and escalation readings the derivation seam needs — the
// exposure count, top-priority asset, and escalation trend surfaced in the SitRep are all COMPUTED at read
// time (src/application/derivation), never hand-authored here (Art. XII). A tiny air-gapped demo dataset so
// the channels work out-of-the-box with MOCK-mode provenance (never presented as live). Real deployments
// override this via the Postgres read-model (config switch).
import { asId } from '@/domain/value-objects/ids.js';
import type { SourceId, CitationId, RegionId } from '@/domain/value-objects/ids.js';
import type { BBox } from '@/domain/value-objects/geo.js';
import type { CoreSeed, IncidentSeed } from '@/adapters/memory/memory-core.js';
import type { RegionView } from '@/application/interaction/command-router.js';
import { shippedRegion } from '@/config/regions.js';
import {
  SEEDED_AT,
  US_CA,
  RO,
  ES,
  GR,
  PH,
  CA_INCIDENT,
  RO_INCIDENT,
  ES_INCIDENT,
  GR_INCIDENT,
  PH_INCIDENT,
  CA_HAZARDS,
  CA_NODES,
  CA_TREND_READINGS,
  CA_TREND_SIGNAL_LABEL,
  CA_TREND_SOURCE,
  CA_EXPOSED_POPULATION,
  CA_WIND_SPEED_KMH,
  RO_HAZARDS,
  RO_NODES,
  RO_TREND_READINGS,
  RO_TREND_SIGNAL_LABEL,
  RO_TREND_SOURCE,
  RO_EXPOSED_POPULATION,
  RO_RETURN_PERIOD_LABEL,
  RO_FLOOD_CATEGORY_LABEL,
  RO_CREST_TIME,
  RO_EXCEEDANCE_PROBABILITY,
  ES_HAZARDS,
  ES_NODES,
  ES_TREND_READINGS,
  ES_TREND_SIGNAL_LABEL,
  ES_TREND_SOURCE,
  ES_EXPOSED_POPULATION,
  ES_WIND_SPEED_KMH,
  GR_HAZARDS,
  GR_NODES,
  GR_TREND_READINGS,
  GR_TREND_SIGNAL_LABEL,
  GR_TREND_SOURCE,
  GR_EXPOSED_POPULATION,
  GR_WIND_SPEED_KMH,
  PH_HAZARDS,
  PH_NODES,
  PH_TREND_READINGS,
  PH_TREND_SIGNAL_LABEL,
  PH_TREND_SOURCE,
  PH_EXPOSED_POPULATION,
  PH_RETURN_PERIOD_LABEL,
  PH_FLOOD_CATEGORY_LABEL,
  PH_CREST_TIME,
  PH_EXCEEDANCE_PROBABILITY,
  DEFAULT_BUFFERS,
} from './scenario-inputs.js';

const caIncident: IncidentSeed = {
  id: CA_INCIDENT,
  regionId: US_CA,
  type: 'WILDFIRE',
  status: 'ACTIVE',
  headline: 'Bear Ridge Fire — active wildfire, Butte County',
  provenance: [
    { sourceId: 'firms', mode: 'MOCK', fetchedAt: SEEDED_AT }, // fire HOTSPOTS
    { sourceId: 'nifc', mode: 'MOCK', fetchedAt: SEEDED_AT }, // fire PERIMETER (FIRMS ≠ perimeters)
    { sourceId: 'open-meteo', mode: 'MOCK', fetchedAt: SEEDED_AT },
  ],
  freshness: SEEDED_AT,
  derivation: {
    incidentId: CA_INCIDENT,
    hazards: CA_HAZARDS,
    infrastructure: CA_NODES,
    buffers: DEFAULT_BUFFERS,
    exposedPopulation: CA_EXPOSED_POPULATION,
    assetLabel: 'electrical substations',
    trendReadings: CA_TREND_READINGS,
    trendSignalLabel: CA_TREND_SIGNAL_LABEL,
    trendSourceId: CA_TREND_SOURCE,
    grounding: {
      exposure: {
        field: 'exposure',
        sourceId: asId<SourceId>('firms'),
        citationId: asId<CitationId>('seed-cit-ca-exposure'),
      },
      priorities: {
        field: 'priorities',
        sourceId: asId<SourceId>('firms'),
        citationId: asId<CitationId>('seed-cit-ca-priorities'),
      },
    },
    weather: {
      input: { speedKmh: CA_WIND_SPEED_KMH, fromLabel: 'NE', spreadLabel: 'south-westward' },
      grounding: {
        field: 'weather',
        sourceId: asId<SourceId>('open-meteo'),
        citationId: asId<CitationId>('seed-cit-ca-weather'),
      },
    },
    computedAt: SEEDED_AT,
  },
};

const roIncident: IncidentSeed = {
  id: RO_INCIDENT,
  regionId: RO,
  type: 'FLOOD',
  status: 'ACTIVE',
  headline: 'Siret River flood — minor flooding, Galați County',
  provenance: [{ sourceId: 'glofas', mode: 'MOCK', fetchedAt: SEEDED_AT }],
  freshness: SEEDED_AT,
  derivation: {
    incidentId: RO_INCIDENT,
    hazards: RO_HAZARDS,
    infrastructure: RO_NODES,
    buffers: DEFAULT_BUFFERS,
    exposedPopulation: RO_EXPOSED_POPULATION,
    assetLabel: 'lifeline facilities',
    trendReadings: RO_TREND_READINGS,
    trendSignalLabel: RO_TREND_SIGNAL_LABEL,
    trendSourceId: RO_TREND_SOURCE,
    grounding: {
      exposure: {
        field: 'exposure',
        sourceId: asId<SourceId>('glofas'),
        citationId: asId<CitationId>('seed-cit-ro-exposure'),
      },
      priorities: {
        field: 'priorities',
        sourceId: asId<SourceId>('glofas'),
        citationId: asId<CitationId>('seed-cit-ro-priorities'),
      },
    },
    crest: {
      input: {
        returnPeriodLabel: RO_RETURN_PERIOD_LABEL,
        floodCategory: RO_FLOOD_CATEGORY_LABEL,
        crestTime: RO_CREST_TIME,
        exceedanceProbability: RO_EXCEEDANCE_PROBABILITY,
      },
      grounding: {
        field: 'crest',
        sourceId: asId<SourceId>('glofas'),
        citationId: asId<CitationId>('seed-cit-ro-crest'),
      },
    },
    computedAt: SEEDED_AT,
  },
};

// ── B3.5 — offline scenarios for the three DEMO-GRADE zones (es · gr · ph) ───────────────────────────
// Same shape as the two above, so the same generic composition (B1.8) picks them up with no code that knows
// their ids. Every provenance ref is MOCK and every headline is ILLUSTRATIVE over real geography — a seeded
// scenario must never read as a real, current incident. Each zone cites ONLY sources it actually enables:
// no US-only row appears here, and the grounding sources are the ones that own the fact in that zone.

const esIncident: IncidentSeed = {
  id: ES_INCIDENT,
  regionId: ES,
  type: 'WILDFIRE',
  status: 'ACTIVE',
  headline: 'Culebra Ridge Fire — active wildfire, Zamora (illustrative)',
  provenance: [
    { sourceId: 'firms', mode: 'MOCK', fetchedAt: SEEDED_AT }, // fire HOTSPOTS
    { sourceId: 'effis', mode: 'MOCK', fetchedAt: SEEDED_AT }, // fire PERIMETER (FIRMS ≠ perimeters)
    { sourceId: 'open-meteo', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'meteoalarm-es', mode: 'MOCK', fetchedAt: SEEDED_AT }, // AEMET warnings via MeteoAlarm
  ],
  freshness: SEEDED_AT,
  derivation: {
    incidentId: ES_INCIDENT,
    hazards: ES_HAZARDS,
    infrastructure: ES_NODES,
    buffers: DEFAULT_BUFFERS,
    exposedPopulation: ES_EXPOSED_POPULATION,
    assetLabel: 'lifeline facilities',
    trendReadings: ES_TREND_READINGS,
    trendSignalLabel: ES_TREND_SIGNAL_LABEL,
    trendSourceId: ES_TREND_SOURCE,
    grounding: {
      exposure: {
        field: 'exposure',
        sourceId: asId<SourceId>('effis'),
        citationId: asId<CitationId>('seed-cit-es-exposure'),
      },
      priorities: {
        field: 'priorities',
        sourceId: asId<SourceId>('effis'),
        citationId: asId<CitationId>('seed-cit-es-priorities'),
      },
    },
    weather: {
      input: { speedKmh: ES_WIND_SPEED_KMH, fromLabel: 'W', spreadLabel: 'eastward' },
      grounding: {
        field: 'weather',
        sourceId: asId<SourceId>('open-meteo'),
        citationId: asId<CitationId>('seed-cit-es-weather'),
      },
    },
    computedAt: SEEDED_AT,
  },
};

const grIncident: IncidentSeed = {
  id: GR_INCIDENT,
  regionId: GR,
  type: 'WILDFIRE',
  status: 'ACTIVE',
  headline: 'North Evia Fire — active wildfire, Euboea (illustrative)',
  provenance: [
    { sourceId: 'firms', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'effis', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'open-meteo', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'meteoalarm-gr', mode: 'MOCK', fetchedAt: SEEDED_AT }, // EMY/HNMS warnings via MeteoAlarm
  ],
  freshness: SEEDED_AT,
  derivation: {
    incidentId: GR_INCIDENT,
    hazards: GR_HAZARDS,
    infrastructure: GR_NODES,
    buffers: DEFAULT_BUFFERS,
    exposedPopulation: GR_EXPOSED_POPULATION,
    assetLabel: 'lifeline facilities',
    trendReadings: GR_TREND_READINGS,
    trendSignalLabel: GR_TREND_SIGNAL_LABEL,
    trendSourceId: GR_TREND_SOURCE,
    grounding: {
      exposure: {
        field: 'exposure',
        sourceId: asId<SourceId>('effis'),
        citationId: asId<CitationId>('seed-cit-gr-exposure'),
      },
      priorities: {
        field: 'priorities',
        sourceId: asId<SourceId>('effis'),
        citationId: asId<CitationId>('seed-cit-gr-priorities'),
      },
    },
    weather: {
      input: { speedKmh: GR_WIND_SPEED_KMH, fromLabel: 'N', spreadLabel: 'southward' },
      grounding: {
        field: 'weather',
        sourceId: asId<SourceId>('open-meteo'),
        citationId: asId<CitationId>('seed-cit-gr-weather'),
      },
    },
    computedAt: SEEDED_AT,
  },
};

// PH cites `wmo-swic` (PAGASA's CAP relay) as an ALERT/NEWS source only — never as the source of a geometry
// or a number: the adapter cannot produce a HazardGeometry at all (F-48), and every figure below is grounded
// on GloFAS, which is what actually supplies PH's flood evidence (F-51: no PH gauge network was verified).
const phIncident: IncidentSeed = {
  id: PH_INCIDENT,
  regionId: PH,
  type: 'FLOOD',
  status: 'ACTIVE',
  headline: 'Mindanao river flood — minor flooding, Maguindanao (illustrative)',
  provenance: [
    { sourceId: 'glofas', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'wmo-swic', mode: 'MOCK', fetchedAt: SEEDED_AT }, // PAGASA CAP via the WMO SWIC relay
  ],
  freshness: SEEDED_AT,
  derivation: {
    incidentId: PH_INCIDENT,
    hazards: PH_HAZARDS,
    infrastructure: PH_NODES,
    buffers: DEFAULT_BUFFERS,
    exposedPopulation: PH_EXPOSED_POPULATION,
    assetLabel: 'lifeline facilities',
    trendReadings: PH_TREND_READINGS,
    trendSignalLabel: PH_TREND_SIGNAL_LABEL,
    trendSourceId: PH_TREND_SOURCE,
    grounding: {
      exposure: {
        field: 'exposure',
        sourceId: asId<SourceId>('glofas'),
        citationId: asId<CitationId>('seed-cit-ph-exposure'),
      },
      priorities: {
        field: 'priorities',
        sourceId: asId<SourceId>('glofas'),
        citationId: asId<CitationId>('seed-cit-ph-priorities'),
      },
    },
    crest: {
      input: {
        returnPeriodLabel: PH_RETURN_PERIOD_LABEL,
        floodCategory: PH_FLOOD_CATEGORY_LABEL,
        crestTime: PH_CREST_TIME,
        exceedanceProbability: PH_EXCEEDANCE_PROBABILITY,
      },
      grounding: {
        field: 'crest',
        sourceId: asId<SourceId>('glofas'),
        citationId: asId<CitationId>('seed-cit-ph-crest'),
      },
    },
    computedAt: SEEDED_AT,
  },
};

/**
 * A seeded region view (what `GET /regions` serves in the offline/default profile, B1.2): identity +
 * display name from here, geography/locale from `config/regions.json` via the pure client-safe registry
 * view — NEVER re-typed here. A second copy of a bbox/iso/tz is exactly the duplication that let an
 * unconfigured region inherit California's geography (finding F-06), so a region the config does not know
 * keeps `id` + `name` ONLY: no borrowed extent, no defaulted timezone. A region the config DOES know is
 * complete by contract — `schemas/regions.schema.json` requires `iso`, `tz`, `languages` and a 4-number
 * `bbox` of every entry, enforced by `region-registry.schema.test.ts` — so there is nothing to default.
 *
 * The display `name` deliberately does NOT come from config: `name` there is the operator-facing string
 * ("California (Flagship)") while these are the demo-seed labels the channels have always returned
 * (ADR-031 §Decision-4 calls that baseline trap out explicitly).
 *
 * Exported for `seed.test.ts` — DEFAULT_SEED below is the only production caller.
 */
export function seededRegion(id: RegionId, name: string): RegionView {
  const config = shippedRegion(String(id));
  if (config === undefined) return { id, name };
  const bbox: BBox = [config.bbox[0]!, config.bbox[1]!, config.bbox[2]!, config.bbox[3]!];
  return { id, name, iso: config.iso, tz: config.tz, languages: config.languages, bbox };
}

export const DEFAULT_SEED: CoreSeed = {
  defaultRegionId: 'us-ca',
  // Selector order = config/regions.json order. The English strings here are the demo-seed labels the
  // channels have always returned; the WEB UI takes its label from `shell.region.<id>` in the catalog
  // instead, so it translates (finding F-22).
  regions: [
    seededRegion(US_CA, 'California (US)'),
    seededRegion(RO, 'Romania (EU)'),
    seededRegion(ES, 'Spain (EU)'),
    seededRegion(GR, 'Greece (EU)'),
    seededRegion(PH, 'Philippines'),
  ],
  incidents: [caIncident, roIncident, esIncident, grIncident, phIncident],
  sources: {
    'us-ca': [
      { sourceId: 'firms', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'nifc', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'nws', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'open-meteo', mode: 'MOCK', fetchedAt: SEEDED_AT },
    ],
    ro: [
      { sourceId: 'glofas', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'meteoalarm-ro', mode: 'MOCK', fetchedAt: SEEDED_AT },
    ],
    // The three demo-grade zones. These lists are SHORTER than us-ca's on purpose: a zone's offline source
    // list states what actually backs its seeded picture, not everything its allowlist permits (the live
    // path rebuilds it from the real fetch). Padding it would inflate the zone's coverage claim (F-63).
    es: [
      { sourceId: 'firms', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'effis', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'open-meteo', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'meteoalarm-es', mode: 'MOCK', fetchedAt: SEEDED_AT },
    ],
    gr: [
      { sourceId: 'firms', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'effis', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'open-meteo', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'meteoalarm-gr', mode: 'MOCK', fetchedAt: SEEDED_AT },
    ],
    ph: [
      { sourceId: 'glofas', mode: 'MOCK', fetchedAt: SEEDED_AT },
      { sourceId: 'wmo-swic', mode: 'MOCK', fetchedAt: SEEDED_AT },
    ],
  },
};
