// BEACON — FR-D6-3 family-reunification LINK-OUT (ADR-035 §4; FEATURE_D6_REUNIFICATION_LINKS).
// A pure function of a region id → the official reunification services to send a person TO. BEACON handles
// ZERO reunification data: there is no input field, no query, no form, no POST, no fetch and no result in
// this module or its DTO, and there is no shape in which one could be added — a safe-and-well /
// reunification REGISTRY is PERMANENTLY OUT of scope (ADR-035 §4; CURRENT-PLAN-3-DIFFERENTIATORS.md:134-137)
// because it is the single highest-harm dataset in disaster response. Handling zero data is precisely what
// makes this constitutional; the useful 90% at 0% of the data risk.
//
// Link-only doctrine, deliberately the same posture and the same {label, provider, url} vocabulary as
// ADR-028's external views (src/application/external-views/external-views.ts): pure, offline, no key, no
// clock, no state, so it is trivially correct and fully unit-testable.
//
// Art. XVI ladder: the GLOBAL rung (ICRC Family Links Network) is emitted for EVERY region, including a
// region with no national entry and an unknown region id — a caller therefore always has somewhere to send
// someone, and the `rung` field labels which one served. Never a dead end, always labelled.
//
// ── URL PROVENANCE, stated honestly rather than implied ───────────────────────────────────────────────────
// These are static, human-curated links, checked by fetch on 2026-07-31. They are NOT monitored endpoints and
// BEACON never fetches, follows, embeds or parses one at runtime, so a link that later rots degrades to a
// broken hyperlink — never to a wrong fact and never to a leaked query.
//   VERIFIED (HTTP 200, content confirmed to be the named organisation's own site):
//     crucearosie.ro · www2.cruzroja.es · www.redcross.gr · redcross.org.ph ·
//     www.icrc.org/en/what-we-do/restoring-family-links
//   NOT VERIFIED (the host answers an automated request with HTTP 403 bot protection, so liveness could not
//   be confirmed by this lane — this is an absence of evidence, not evidence of a dead link):
//     familylinks.icrc.org — corroborated INDIRECTLY: the verified ICRC RFL page above links to it by name
//       as the Family Links Network portal.
//     www.redcross.org/…/restoring-family-links.html — no corroboration was obtained. Flagged here so a
//       reviewer can check it by hand; it is the one URL below carrying no positive evidence.
import type { AggregateOnly } from '@/domain/shared/aggregate-only.js';
import { shippedRegion } from '@/config/regions.js';

/** Which rung of the Art. XVI ladder produced a link. */
export const REUNIFICATION_RUNGS = ['NATIONAL', 'GLOBAL'] as const;
export type ReunificationRung = (typeof REUNIFICATION_RUNGS)[number];

export interface ReunificationLink {
  readonly label: string;
  /** The ORGANISATION owning the linked service and the data behind it — never a person. */
  readonly provider: string;
  readonly rung: ReunificationRung;
  /** ISO-3166-1 alpha-2 the NATIONAL rung serves; absent on the GLOBAL rung. */
  readonly iso?: string;
  readonly url: string;
}

/**
 * Layer A in load-bearing position: this alias is the element type the builder returns, so adding any
 * person-identifying key (a `surname` query field, a `contact`, a `dob`) to `ReunificationLink` resolves it
 * to the error-carrying branch and stops `buildReunificationLinks` compiling (Gate 2).
 */
export type CheckedReunificationLink = AggregateOnly<ReunificationLink>;

/** The always-present GLOBAL rung. */
const GLOBAL_LINK: CheckedReunificationLink = Object.freeze({
  label: 'ICRC Family Links Network — trace a missing relative',
  provider: 'ICRC',
  rung: 'GLOBAL',
  url: 'https://familylinks.icrc.org/',
});

/**
 * National societies of the Family Links Network, by ISO-3166-1 alpha-2. Keyed by ISO — NOT by BEACON region
 * id — so a new region in config/regions.json for an already-listed country inherits its link with zero
 * change here, and the ISO itself is read from the region registry rather than restated (F-24's lesson).
 */
const NATIONAL_LINKS: Readonly<Record<string, CheckedReunificationLink>> = Object.freeze({
  US: {
    label: 'American Red Cross — Restoring Family Links',
    provider: 'American Red Cross',
    rung: 'NATIONAL',
    iso: 'US',
    url: 'https://www.redcross.org/about-us/our-work/international-services/restoring-family-links.html',
  },
  RO: {
    label: 'Crucea Roșie Română — restabilirea legăturilor de familie',
    provider: 'Crucea Roșie Română',
    rung: 'NATIONAL',
    iso: 'RO',
    url: 'https://crucearosie.ro/',
  },
  ES: {
    label: 'Cruz Roja Española — restablecimiento del contacto familiar',
    provider: 'Cruz Roja Española',
    rung: 'NATIONAL',
    iso: 'ES',
    url: 'https://www2.cruzroja.es/',
  },
  GR: {
    label: 'Ελληνικός Ερυθρός Σταυρός — αναζήτηση συγγενών',
    provider: 'Hellenic Red Cross',
    rung: 'NATIONAL',
    iso: 'GR',
    url: 'https://www.redcross.gr/',
  },
  PH: {
    label: 'Philippine Red Cross — Restoring Family Links',
    provider: 'Philippine Red Cross',
    rung: 'NATIONAL',
    iso: 'PH',
    url: 'https://redcross.org.ph/',
  },
});

/**
 * The reunification link-out set for a region: the region's national society first (when one is listed),
 * then the global ICRC network, which is ALWAYS present.
 *
 * Total and pure: an unknown/absent region id yields the GLOBAL rung alone rather than an empty list or a
 * throw — the degrade-not-break floor (Art. XVI). The caller renders nothing at all when
 * FEATURE_D6_REUNIFICATION_LINKS is off (src/application/aggregate/d6-flags.ts); this function does not
 * read the flag, so it stays a pure function of its argument.
 */
export function buildReunificationLinks(regionId?: string): readonly CheckedReunificationLink[] {
  const iso = regionId === undefined ? undefined : shippedRegion(regionId)?.iso;
  const national = iso === undefined ? undefined : NATIONAL_LINKS[iso];
  return national === undefined ? [GLOBAL_LINK] : [national, GLOBAL_LINK];
}

/** The ISO codes with a national entry — exported so a test can enumerate them without re-declaring them. */
export const REUNIFICATION_NATIONAL_ISOS: readonly string[] = Object.keys(NATIONAL_LINKS);
