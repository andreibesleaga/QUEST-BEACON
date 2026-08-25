// BEACON — authoritative post-event DAMAGE OVERLAY product (MW-D/D5.5; FR-D4-5 `FEATURE_D4_EMS_OVERLAY`,
// FEV-24, ADR-036 §7, link-only doctrine ADR-027/ADR-028). Pure domain: no framework/HTTP/DB imports (F9).
//
// ⚠ WHAT "EMS" MEANS HERE — read this before extending the file.
// `FEATURE_D4_EMS_OVERLAY` is the **Copernicus Emergency Management Service** (rapid-mapping DELINEATION and
// GRADING products), NOT Emergency Medical Services. The requirement of record is FEV-24
// (`docs/requirements/EARS_FINAL_VERSION.md:283-284`): "WHEN an authoritative damage-assessment product is
// configured for the incident, THE SYSTEM SHALL display it as an attributed overlay labeled with its
// production date." There is no patient, no transport and no casualty concept anywhere in this module, and
// none may be added: an aggregate casualty tally is FR-D6-5, hosted on the D4 damage report and owned by the
// D6 lane (ADR-035 §4). See finding F-150.
//
// CONSUME-ONLY, BY CONSTRUCTION. BEACON ingests PUBLISHED products. It never requests an EMS activation
// (that is Authorised-User-gated and BEACON is not one). Structurally: this module has no port, no client
// and no URL-fetching code — a product carries a LINK that is validated and never dereferenced (ADR-028).
//
// NO GEOMETRY, DELIBERATELY. A product's footprint is NOT modelled. Rehosting or re-deriving a
// rapid-mapping polygon would (a) breach the link-only/no-rehost doctrine and (b) put a foreign,
// differently-scaled polygon within reach of the exposure engine — precisely the failure F-48 was solved by
// making structurally impossible for PAGASA's basin-wide AOR. The overlay is an attributed, dated CARD +
// link; the authoritative geometry stays with its publisher.
//
// AGGREGATE-ONLY (Art. XIV, ADR-035 §4 Layer A): the factory returns
// `AggregateOverlayProduct = AggregateOnly<DamageOverlayProduct>`, so adding a person-identifying key to the
// interface breaks `tsc`. Product metadata describes an AREA, never a person.
import type { AggregateOnly } from './shared/aggregate-only.js';
import { assertLinkOnlyUrl } from './shared/link-policy.js';
import { invariant, definedOnly } from './shared/guard.js';

/** The Copernicus EMS rapid-mapping product classes BEACON displays. Closed vocabulary. */
export const OVERLAY_PRODUCT_TYPES = ['DELINEATION', 'GRADING'] as const;
export type OverlayProductType = (typeof OVERLAY_PRODUCT_TYPES)[number];

export interface DamageOverlayProduct {
  /** Publisher's product id (e.g. `EMSR773_AOI01_DEL_PRODUCT_r1`). */
  readonly productId: string;
  /** Publisher's activation code (e.g. `EMSR773`) — the correlation key across a mapping activation. */
  readonly activationCode: string;
  readonly productType: OverlayProductType;
  /** Publisher's area-of-interest label (a PLACE, never a person). */
  readonly areaOfInterest: string;
  /** ISO-8601 PRODUCTION date of the product. REQUIRED by FEV-24 — an undated overlay may not be shown. */
  readonly producedAt: string;
  /** Attribution string rendered with the overlay. REQUIRED — an unattributed overlay may not be shown. */
  readonly provider: string;
  /** Licence/terms under which the product is reproduced. REQUIRED (NOTICE discipline). */
  readonly licence: string;
  /** The publisher's product page — https, link-only, NEVER fetched by BEACON. */
  readonly viewUrl: string;
}

/** Layer A (ADR-035 §4): resolves to the error-carrying shape if a person-identifying key ever appears. */
export type AggregateOverlayProduct = AggregateOnly<DamageOverlayProduct>;

export interface MakeDamageOverlayProductInput {
  readonly productId: string;
  readonly activationCode: string;
  readonly productType: OverlayProductType;
  readonly areaOfInterest: string;
  readonly producedAt: string;
  readonly provider: string;
  readonly licence: string;
  readonly viewUrl: string;
}

function assertNonEmpty(value: string, field: string): void {
  invariant(
    typeof value === 'string' && value.trim() !== '',
    `DamageOverlayProduct.${field} must be a non-empty string, got ${String(value)}`,
  );
}

/**
 * Construct a displayable damage-overlay product. Every FEV-24 display precondition is an INVARIANT, not a
 * render-time `if`: attribution, licence and production date are required, so an unattributed or undated
 * product cannot exist as a value at all — the honest failure is at construction, never a silently
 * unlabelled layer.
 */
export function makeDamageOverlayProduct(input: MakeDamageOverlayProductInput): AggregateOverlayProduct {
  assertNonEmpty(input.productId, 'productId');
  assertNonEmpty(input.activationCode, 'activationCode');
  assertNonEmpty(input.areaOfInterest, 'areaOfInterest');
  assertNonEmpty(input.provider, 'provider');
  assertNonEmpty(input.licence, 'licence');
  invariant(
    OVERLAY_PRODUCT_TYPES.includes(input.productType),
    `DamageOverlayProduct.productType must be one of ${OVERLAY_PRODUCT_TYPES.join('|')}, got ${String(input.productType)}`,
  );
  invariant(
    Boolean(input.producedAt) && !Number.isNaN(Date.parse(input.producedAt)),
    `DamageOverlayProduct.producedAt must be a valid ISO timestamp: ${String(input.producedAt)}`,
  );
  assertLinkOnlyUrl(input.viewUrl, 'DamageOverlayProduct.viewUrl');

  const product: DamageOverlayProduct = definedOnly({
    productId: input.productId,
    activationCode: input.activationCode,
    productType: input.productType,
    areaOfInterest: input.areaOfInterest,
    producedAt: input.producedAt,
    provider: input.provider,
    licence: input.licence,
    viewUrl: input.viewUrl,
  }) as DamageOverlayProduct;
  // The Layer-A gate: assignable ONLY while DamageOverlayProduct is person-identifying-key free.
  return product;
}
