// BEACON — server-side catalog access for the outbound messaging digest "chrome" (ADR-030 §7; FR-I18N-2/6;
// A4.3b). `renderDigest` (handle-inbound.ts) composes a short text reply from labels ("trend:", "citations:",
// "sources:", "freshness:", "(no claim)") plus deterministic engine facts. The LABELS are presentation and
// belong in the message catalogs (`messages/*.json`, namespace `channels.digest`); the facts themselves
// (field claims, provenance ids, ISO timestamps, CAP/EDXL enum tokens) stay exactly as the engine produced
// them, in English, never routed through a translator (Art. XII — the LLM/catalog never emits a figure).
//
// WHY THIS FILE EXISTS RATHER THAN REUSING app/_lib/i18n.tsx / app/_lib/messages.server.ts: those are a
// 'use client' React module and a next/headers-dependent Next.js server module respectively — src/ MUST NOT
// import from app/ (dependency-cruiser boundary, ADR-001; see .dependency-cruiser.cjs and the
// f9-domain-purity precedent this mirrors one layer up). This module is the src/-side equivalent, built on
// the SAME access idiom: next-intl's CORE translator (`createTranslator` — the identical ICU engine
// app/_lib/i18n.tsx's `useT` is built on, imported directly rather than through the React hook), with the
// SAME two-layer English-fallback doctrine as app/_lib/messages.server.ts#loadMessages (deep-merge the
// active catalog OVER English; a missing/unparseable catalog degrades to English rather than throwing,
// Art. XVI) and the SAME allowlist coercion as src/config/locales.ts#toLocaleId (NFR-F7 — an untrusted
// `InteractionRequest.locale` can never reach a dynamic-import path).
import { createTranslator } from 'next-intl';
import enMessages from '../../../../messages/en.json';
import { DEFAULT_LOCALE, toLocaleId, type LocaleId } from '@/config/locales.js';

/** A nested catalog tree: objects of strings (ICU messages) at the leaves. Mirrors messages.server.ts. */
type MessageTree = { readonly [key: string]: string | MessageTree };

const DIGEST_NAMESPACE = 'channels.digest';

/** The digest chrome labels this module resolves — one field per literal the pre-i18n code hardcoded. */
export interface DigestChrome {
  readonly trend: string;
  readonly noClaim: string;
  readonly citations: string;
  readonly sources: string;
  readonly freshness: string;
}

const DIGEST_KEYS = ['trend', 'noClaim', 'citations', 'sources', 'freshness'] as const;

/**
 * Deep-merge `override` onto `base`, keeping `base` wherever the override is absent, empty, or a type
 * mismatch. Empty strings count as "not translated" — a blank label is worse than an English one.
 * Duplicated from app/_lib/messages.server.ts#mergeMessages (src/ cannot import it — see file header);
 * kept deliberately identical so the two loaders behave the same way.
 */
function mergeMessages(base: MessageTree, override: MessageTree): MessageTree {
  const out: Record<string, string | MessageTree> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (typeof value === 'string') {
      if (value !== '') out[key] = value;
    } else if (typeof current === 'object' && current !== null) {
      out[key] = mergeMessages(current, value);
    } else if (current === undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Import `messages/<locale>.json` if it exists. A missing or unparseable catalog is a DEGRADATION, not a
 * crash (Art. XVI): the caller falls back to English rather than failing the reply.
 */
async function importCatalog(locale: LocaleId): Promise<MessageTree | undefined> {
  try {
    const mod = (await import(`../../../../messages/${locale}.json`)) as { default?: MessageTree };
    return mod.default ?? (mod as unknown as MessageTree);
  } catch {
    return undefined;
  }
}

const ENGLISH: MessageTree = enMessages as unknown as MessageTree;

/** Load the catalog for `locale`, merged over English — identical contract to `loadMessages` in messages.server.ts. */
async function loadCatalog(locale: LocaleId): Promise<MessageTree> {
  if (locale === DEFAULT_LOCALE) return ENGLISH;
  const translated = await importCatalog(locale);
  if (translated === undefined) return ENGLISH;
  return mergeMessages(ENGLISH, translated);
}

/** Resolve a dotted key path inside a message tree. Returns undefined when absent (never throws). */
function messageAt(tree: unknown, path: readonly string[]): string | undefined {
  let node: unknown = tree;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

/** ICU/lookup problems must degrade, never break a reply. Surfaced in dev/test, silent in prod. */
function reportIntlError(error: unknown): void {
  /* c8 ignore next 3 -- diagnostic-only branch */
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[digest-i18n]', error instanceof Error ? error.message : String(error));
  }
}

/** A minimal callable shape for the translator — avoids fighting next-intl's strict Messages generic for
 *  what is, here, a fixed set of five plain (non-ICU-argument) lookups. Mirrors the cast the catalog-parity
 *  test (`tests/i18n/catalog-parity.test.ts`) already uses for the same reason. */
type Lookup = (key: string) => string;

/**
 * Resolve the digest chrome labels for a requester's locale (a raw, untrusted BCP-47-ish string or
 * undefined — e.g. `InteractionRequest.locale`, ADR-030 Finding 5). Unrecognised/unshipped/absent locale
 * resolves to English (`toLocaleId`, NFR-F7 allowlist) — so this is byte-identical to the pre-i18n
 * hardcoded literals for every request that does not carry a shipped, non-English locale.
 */
/** ICU params for the alert-broadcast headline. Enum tokens/ids are ENGINE facts and stay English. */
export interface AlertHeadlineParams {
  readonly severity: string;
  readonly category: string;
  readonly incidentId: string;
  readonly alertId: string;
}

const ALERT_HEADLINE_KEY = 'channels.alert.headline';

/**
 * Render the alert-broadcast headline in `locale` (catalog ICU template — deterministic, never an LLM;
 * the same Art. XII doctrine as the digest chrome above: LABELS localize, engine facts stay verbatim).
 * Any catalog/ICU problem degrades to the English template (Art. XVI), so a broadcast is never blocked
 * on a translation.
 */
export async function alertHeadlineFor(locale: string | undefined, params: AlertHeadlineParams): Promise<string> {
  const id = toLocaleId(locale);
  const messages = await loadCatalog(id);
  const t = createTranslator({ locale: id, messages: messages as never, onError: reportIntlError }) as unknown as (
    key: string,
    values?: Record<string, string>,
  ) => string;
  const rendered = t(ALERT_HEADLINE_KEY, { ...params });
  if (rendered !== ALERT_HEADLINE_KEY) return rendered;
  // Missing key (a stripped catalog) — fall back to the English source template, hand-substituted.
  const template = messageAt(ENGLISH, ALERT_HEADLINE_KEY.split('.'));
  return (template ?? 'BEACON ALERT — {severity} {category} for incident {incidentId} (alert {alertId})')
    .replace('{severity}', params.severity)
    .replace('{category}', params.category)
    .replace('{incidentId}', params.incidentId)
    .replace('{alertId}', params.alertId);
}

export async function digestChromeFor(locale: string | undefined): Promise<DigestChrome> {
  const id = toLocaleId(locale);
  const messages = await loadCatalog(id);
  // next-intl's generic `Messages` shape check is stricter than this file needs to be — the catalog is
  // already validated by tests/i18n/catalog-parity.test.ts (key parity, ICU validity for every locale).
  const t = createTranslator({ locale: id, messages: messages as never, onError: reportIntlError }) as unknown as Lookup;
  const fallback = (key: string): string => messageAt(ENGLISH, [...DIGEST_NAMESPACE.split('.'), key]) ?? key;
  const entries = DIGEST_KEYS.map((key) => {
    const rendered = t(`${DIGEST_NAMESPACE}.${key}`);
    // next-intl degrades a missing/erroring lookup to the raw key rather than throwing (Art. XVI); treat
    // that the same way the client-side ladder does — substitute the English source text.
    return [key, rendered === `${DIGEST_NAMESPACE}.${key}` ? fallback(key) : rendered] as const;
  });
  return Object.fromEntries(entries) as unknown as DigestChrome;
}
