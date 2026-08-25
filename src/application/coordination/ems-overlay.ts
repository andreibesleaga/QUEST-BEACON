// BEACON — AUTHORITATIVE DAMAGE-ASSESSMENT OVERLAY (Copernicus EMS rapid mapping) — MW-D/D5.5;
// FR-D4-5 `FEATURE_D4_EMS_OVERLAY`, FEV-24, ADR-036 §7, ADR-027/028 link-only doctrine.
// Pure application layer: PORTS + DOMAIN only (F9/ADR-001). No clock — `asOf` is INJECTED (Art. XII).
//
// "EMS" = Copernicus **Emergency Management Service**, not Emergency Medical Services. See the header of
// `src/domain/damage-overlay.ts` and finding F-150 before adding anything patient- or transport-shaped here.
//
// FEV-24 IN ONE LINE: an authoritative post-event damage product is displayed as an ATTRIBUTED overlay
// LABELLED WITH ITS PRODUCTION DATE. Both preconditions are domain invariants (an unattributed or undated
// product cannot be constructed at all), so this module cannot render an unlabelled layer even by mistake.
//
// CONSUME-ONLY AND LINK-ONLY, STRUCTURALLY: there is no client, no fetch, no port and no activation request
// in this module or in the entity it projects — a product carries a validated https link that BEACON never
// dereferences. (A test asserts the source text of both files contains no network primitive, the same shape
// of guard ADR-036 §6/V11 uses for the cell-broadcast preview.)
//
// A FUTURE-DATED PRODUCT IS FLAGGED, NOT SILENTLY AGED. A product whose production date is after the
// injected `asOf` means a clock or a feed is wrong; rendering "produced in −3 days" would be a confident
// falsehood, so the product is EXCLUDED and listed in `rejected` with its reason (Art. XVI: labelled
// degradation, never a dead end and never a silently-wrong figure).
import type { DamageOverlayProduct, OverlayProductType } from '@/domain/damage-overlay.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';

const DAY_MS = 86_400_000;

export const EMS_OVERLAY_CAVEAT =
  'Post-event damage-assessment products published by their producer and shown as an attributed, dated ' +
  'link-out. BEACON does not rehost, re-clip or re-derive the product geometry, does not use it in any ' +
  'exposure calculation, and never requests a mapping activation.';

/** Why a supplied product was not rendered. Closed vocabulary. */
export const EMS_REJECTION_REASONS = ['PRODUCED_AFTER_AS_OF'] as const;
export type EmsRejectionReason = (typeof EMS_REJECTION_REASONS)[number];

export interface EmsOverlayProductView {
  readonly productId: string;
  readonly activationCode: string;
  readonly productType: OverlayProductType;
  readonly areaOfInterest: string;
  readonly producedAt: string;
  readonly provider: string;
  readonly licence: string;
  readonly viewUrl: string;
  /** Whole days between production and the injected `asOf`. Deterministic; never negative (see header). */
  readonly ageDays: number;
  /** The mandatory FEV-24 label, assembled deterministically from the product's own fields. */
  readonly productionLabel: string;
  /** Literal `true`: a product view is a link-out. No code path fetches, embeds or rehosts the product. */
  readonly linkOnly: true;
}

export interface EmsRejectedProduct {
  readonly productId: string;
  readonly reason: EmsRejectionReason;
  readonly producedAt: string;
}

export interface EmsOverlay {
  /** Renderable products, ascending by production date then product id (deterministic, newest last). */
  readonly products: readonly EmsOverlayProductView[];
  /** Distinct `provider — licence` credits, ascending. Every render site shows these. */
  readonly attribution: readonly string[];
  /** The injected as-of instant every `ageDays` is measured against. */
  readonly asOf: string;
  readonly rejected: readonly EmsRejectedProduct[];
  readonly caveat: string;
}

export interface EmsOverlayInput {
  readonly products: readonly DamageOverlayProduct[];
  /** ISO-8601 instant this view is rendered for — injected, never read from a wall clock here. */
  readonly asOf: string;
}

function ageDays(producedAt: string, asOfMs: number): number {
  return Math.floor((asOfMs - Date.parse(producedAt)) / DAY_MS);
}

function productViewOf(product: DamageOverlayProduct, asOfMs: number): EmsOverlayProductView {
  const days = ageDays(product.producedAt, asOfMs);
  const age = days === 1 ? '1 day' : `${days} days`;
  return {
    productId: product.productId,
    activationCode: product.activationCode,
    productType: product.productType,
    areaOfInterest: product.areaOfInterest,
    producedAt: product.producedAt,
    provider: product.provider,
    licence: product.licence,
    viewUrl: product.viewUrl,
    ageDays: days,
    productionLabel:
      `${product.provider} ${product.productType} product ${product.productId} — produced ${product.producedAt} ` +
      `(${age} before this view).`,
    linkOnly: true,
  };
}

function compareProductViews(a: EmsOverlayProductView, b: EmsOverlayProductView): number {
  return Date.parse(a.producedAt) - Date.parse(b.producedAt) || a.productId.localeCompare(b.productId);
}

/**
 * Project published damage-assessment products into the attributed, dated overlay. Deterministic and total:
 * same products + same `asOf` ⇒ same overlay. Fails only on an unusable `asOf` (an unparsable as-of instant
 * would make every age a NaN, which is worse than refusing).
 */
export function buildEmsOverlay(input: EmsOverlayInput): Result<EmsOverlay, DomainError> {
  const asOfMs = Date.parse(input.asOf);
  if (Number.isNaN(asOfMs)) {
    return err(new DomainError('PARSE_ERROR', `EMS overlay asOf must be a valid ISO timestamp: ${input.asOf}`));
  }

  const rejected: EmsRejectedProduct[] = [];
  const views: EmsOverlayProductView[] = [];
  for (const product of input.products) {
    if (Date.parse(product.producedAt) > asOfMs) {
      rejected.push({ productId: product.productId, reason: 'PRODUCED_AFTER_AS_OF', producedAt: product.producedAt });
      continue;
    }
    views.push(productViewOf(product, asOfMs));
  }
  views.sort(compareProductViews);

  return ok({
    products: views,
    attribution: [...new Set(views.map((v) => `${v.provider} — ${v.licence}`))].sort((a, b) => a.localeCompare(b)),
    asOf: input.asOf,
    rejected,
    caveat: EMS_OVERLAY_CAVEAT,
  });
}
