// BEACON — plain-language warning composition (D3.5; ADR-036 §4, FR-WARN-4 / FEV-17). PURE and
// DETERMINISTIC: one alert in, the same words out, every run, in every locale. No clock, no IO, no model.
//
// Art. XII is the reason this module exists and the reason it looks like this. Protective-action wording is
// the highest-consequence text in the product — "EVACUATE NOW" vs "monitor conditions" is the difference
// between a correct and a fatal instruction — so it is TEMPLATED, reviewable as a diff, and identical on
// every run. The narrator may explain the situation around a warning; it never composes the instruction.
//
// It also never computes a number. Every value interpolated below arrives in `WarningTextInput`, already
// computed by the deterministic engine. This module resolves a catalog key and substitutes; that is all.
//
// TEMPLATES ARE DATA (ADR-012 + ADR-030): the strings live in `messages/<locale>.json` under `warning.*`,
// so new phrasing or a new language is a catalog edit, not a code change. `t` is injected rather than
// imported so the application layer stays free of the i18n framework (Art. II) — the adapter supplies a
// `next-intl` translator, a test supplies whatever it wants to assert against.
import type { AlertResponseType, AlertSeverity } from '@/domain/alert.js';

/**
 * A catalog lookup: key + ICU arguments → the rendered string. The contract is ADR-030's ladder — a key the
 * active locale lacks resolves to the ENGLISH source text, never to a blank and never to the raw key.
 */
export type WarningTranslate = (key: string, args?: Readonly<Record<string, string | number>>) => string;

/** Everything the templates interpolate. All of it pre-computed by the caller (Art. XII). */
export interface WarningTextInput {
  /** Localized event name, e.g. "Flood" / "Inundație". The CAP `<event>` text for this language. */
  readonly event: string;
  readonly severity: AlertSeverity;
  /** Human description of the affected area, e.g. "Argeș floodplain". Never coordinates. */
  readonly areaDesc: string;
  /** The recommended action, selecting the ACTION sentence. Absent ⇒ `Monitor` (the weakest instruction). */
  readonly responseType?: AlertResponseType;
  /** Pre-formatted time phrase ("from 22:00 UTC", "now"). A STRING — this module formats no dates. */
  readonly when?: string;
  /** Pre-computed impact sentence(s) from the deterministic engine. Omitted ⇒ the section is omitted. */
  readonly impacts?: string;
}

/**
 * The composed warning. `headline` is the CAP `<headline>`; `description` is the What/Where/When/Impacts
 * body (CAP `<description>`); `instruction` is the protective action (CAP `<instruction>`). The three map
 * 1:1 onto the CAP elements on purpose: the panel, the Telegram digest and the emitted document then render
 * from ONE composition instead of the three separate fabrications that existed before ADR-036.
 */
export interface WarningText {
  readonly headline: string;
  readonly description: string;
  readonly instruction: string;
  /** The body split into its labelled sections, in order — for a panel that renders them as a list. */
  readonly sections: readonly WarningSection[];
}

export interface WarningSection {
  readonly id: WarningSectionId;
  readonly label: string;
  readonly text: string;
}

/**
 * The NWS Hazard-Simplification section grammar: HAZARD headline, then What / Where / When / Impacts /
 * Action. Order is part of the design — a reader who stops after two lines has still read the hazard and
 * the place.
 */
export const WARNING_SECTION_IDS = ['what', 'where', 'when', 'impacts', 'action'] as const;
export type WarningSectionId = (typeof WARNING_SECTION_IDS)[number];

/** The action sentence key for a response type. Closed CAP vocabulary ⇒ exhaustive ⇒ `tsc` guards it. */
const ACTION_KEY: Readonly<Record<AlertResponseType, string>> = {
  Shelter: 'warning.action.Shelter',
  Evacuate: 'warning.action.Evacuate',
  Prepare: 'warning.action.Prepare',
  Execute: 'warning.action.Execute',
  Avoid: 'warning.action.Avoid',
  Monitor: 'warning.action.Monitor',
  Assess: 'warning.action.Assess',
  AllClear: 'warning.action.AllClear',
  None: 'warning.action.None',
};

/**
 * The weakest instruction is the default. If an alert does not say what to do, the text says "monitor" —
 * never "evacuate" and never a blank line where the action belongs. Escalating on missing data would be the
 * dangerous direction; under-instructing is recoverable by the operator reading the draft.
 */
const DEFAULT_RESPONSE_TYPE: AlertResponseType = 'Monitor';

/** The severity WORD (localized). Reuses the existing `ui.severity.*` keys — one label, one place. */
function severityLabel(severity: AlertSeverity, t: WarningTranslate): string {
  return t(`ui.severity.${severity}`);
}

/**
 * Compose the plain-language warning for ONE language.
 *
 * The headline is HAZARD-IN-CAPS: emphasis carried by the words themselves, so it survives being read
 * aloud, truncated into a 93-character cell-broadcast page, or rendered by a client with no styling —
 * three places where colour and weight do not exist (ADR-036 §3's "colour is never the sole carrier",
 * applied to text).
 */
export function buildWarningText(input: WarningTextInput, t: WarningTranslate): WarningText {
  const severity = severityLabel(input.severity, t);
  const responseType = input.responseType ?? DEFAULT_RESPONSE_TYPE;
  const headline = t('warning.headline', { event: input.event.toLocaleUpperCase(), severity });
  const instruction = t(ACTION_KEY[responseType], { area: input.areaDesc });

  const sections: WarningSection[] = [
    { id: 'what', label: t('warning.label.what'), text: t('warning.what', { event: input.event, severity }) },
    { id: 'where', label: t('warning.label.where'), text: t('warning.where', { area: input.areaDesc }) },
  ];
  if (input.when !== undefined && input.when !== '') {
    sections.push({ id: 'when', label: t('warning.label.when'), text: t('warning.when', { when: input.when }) });
  }
  if (input.impacts !== undefined && input.impacts !== '') {
    sections.push({
      id: 'impacts',
      label: t('warning.label.impacts'),
      text: t('warning.impacts', { impacts: input.impacts }),
    });
  }
  sections.push({ id: 'action', label: t('warning.label.action'), text: instruction });

  return {
    headline,
    // The CAP <description> is the body WITHOUT the action — the action is CAP's own <instruction> element,
    // and duplicating it into both would have a screen reader and a broadcast read the same sentence twice.
    description: sections
      .filter((s) => s.id !== 'action')
      .map((s) => `${s.label}: ${s.text}`)
      .join(' '),
    instruction,
    sections,
  };
}
