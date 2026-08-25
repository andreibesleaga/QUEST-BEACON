// BEACON — link-only URL policy (MW-D/D5; ADR-027/ADR-028 link-only doctrine, Art. XVI honesty).
// Pure TS — no framework/IO imports (F9).
//
// WHY THIS FILE EXISTS — and, since MW-E, why it is the ONLY implementation of this rule.
// The "an external link must be an absolute https URL to a NAMED host" rule was implemented SIX times in
// this repo, every one of them PRIVATE and therefore un-importable:
//   src/domain/camera-feed.ts (`isHttpsUrl`), src/domain/public-report.ts (`assertValidLiveViewUrl`, the
//   strictest — it also rejects IP literals and caps the length), and the four camera ACLs
//   (caltrans-cctv / alertwildfire / dot511 / windy-webcams).
// D5 needed the same rule for the Copernicus-EMS product link and created this module rather than typing a
// seventh copy — exactly the "re-declared contract" defect class this project has been bitten by repeatedly
// (F-24/F-140/F-141/…). F-153 (MW-E) then CONVERGED the other five onto it: every one of those private
// predicates is gone, and each call site now derives its guarantee from here.
//
// HOW A FUTURE DIVERGENCE IS CAUGHT AT COMPILE TIME (not at runtime, and not by review).
// `isLinkOnlyUrl` narrows to the BRANDED {@link LinkOnlyUrl}, and the converged call sites type the field
// that carries a validated link as `LinkOnlyUrl` (e.g. `CaltransCameraRow.viewUrl`). A future author who
// re-declares a private `isHttpsUrl(raw): boolean` cannot then assign the plain `string` it blessed into
// that field — `tsc --noEmit` fails (Gate 2). The brand is the anti-redeclaration device: it makes "I
// validated this some other way" un-typeable rather than merely discouraged.
//
// The one legitimate escape hatch is an explicit `as` cast (the `asId` idiom) — greppable, and never
// produced by an accidental refactor.
//
// The rule is the UNION of the strictest existing checks:
//   1. absolute `https:` only  — rejects `javascript:`/`data:`/`http:`/`mailto:` href injection;
//   2. a NAMED host           — rejects IPv4 dotted-quad and bracketed/colon'd IPv6 literals, the classic
//                               SSRF / cloud-metadata pivot (public-report.ts's rule, kept verbatim in intent);
//   3. a hard length cap      — an unbounded URL is a storage and log-injection hazard.
// A link validated here is still NEVER FETCHED by BEACON: link-only means link-only (ADR-028).
import { invariant } from './guard.js';

/** Hard cap on a stored external link (mirrors `PublicReport.liveViewUrl`'s 2048-char ceiling). */
export const LINK_POLICY_MAX_LENGTH = 2048;

declare const linkOnlyUrlBrand: unique symbol;

/**
 * A string PROVEN to satisfy the link-only policy — the only way to obtain one is to pass through
 * {@link isLinkOnlyUrl} / {@link assertLinkOnlyUrl} (or an explicit, greppable `as` cast at a test/fixture
 * boundary, the `asId` idiom). Fields that must only ever hold a policy-checked link are typed with it so a
 * re-declared private predicate becomes a tsc error rather than a silent runtime divergence (F-153).
 */
export type LinkOnlyUrl = string & { readonly [linkOnlyUrlBrand]: 'LinkOnlyUrl' };

/** A dotted-quad IPv4 literal (loose octet match — ANY IPv4 shape is disallowed as a link host). */
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The hostname of `raw` when it parses, else '' (never throws — an unparsable URL is simply not a link). */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}

/**
 * True when `raw` satisfies the link-only policy: an absolute https URL, at most
 * {@link LINK_POLICY_MAX_LENGTH} characters, whose host is a NAME (never an IP literal).
 */
export function isLinkOnlyUrl(raw: unknown): raw is LinkOnlyUrl {
  if (typeof raw !== 'string') return false;
  if (raw.length === 0 || raw.length > LINK_POLICY_MAX_LENGTH) return false;
  if (!raw.startsWith('https://')) return false;
  const host = hostOf(raw);
  return host !== '' && !host.includes(':') && !host.startsWith('[') && !IPV4_LITERAL.test(host);
}

/** Assert the link-only policy for `raw`, naming `label` (the field) in the InvariantViolation message. */
export function assertLinkOnlyUrl(raw: unknown, label: string): asserts raw is LinkOnlyUrl {
  invariant(
    isLinkOnlyUrl(raw),
    `${label} must be an https:// URL of at most ${LINK_POLICY_MAX_LENGTH} chars whose host is a name, ` +
      `not an IP literal: ${String(raw)}`,
  );
}
