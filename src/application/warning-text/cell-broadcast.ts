// BEACON — 3GPP cell-broadcast PREVIEW (D3.5; ADR-036 §6, FR-WARN-6 / FEV-18). Pure, offline, no network.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// READ THIS FIRST — WHAT THIS IS NOT.
//
// BEACON is **NOT a Cell Broadcast Entity**. It has **no telco delivery path**: no CBC/CBE interface, no
// operator agreement, no SBc/CBS integration, no MME/AMF connectivity, and no regulatory authorisation to
// originate a public warning on a mobile network. It cannot transmit a cell broadcast, cannot verify one was
// transmitted, and cannot know whether any handset displayed one.
//
// This module renders CB-READY TEXT for the authority that does have that path — an authoring aid, the same
// posture as ADR-010's "produce + validate CAP, no live IPAWS origination". `CELL_BROADCAST_NOTICE` below is
// the caveat every surface showing a page count MUST render, and a test asserts it is present. There is no
// network call anywhere in this file, and a test asserts that too.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The honesty label. Verbatim on every surface that displays a page or a page count (ADR-036 §6, V11).
 * Exported as a constant so the UI cannot paraphrase it into something weaker, and so a test can pin it.
 */
export const CELL_BROADCAST_NOTICE =
  'Preview only — BEACON is not a Cell Broadcast Entity and has no telco delivery path. This text is prepared for an authority that does; BEACON cannot transmit a cell broadcast or confirm one was displayed.';

/**
 * 93 characters per page for GSM-7 encoded cell-broadcast content: a CBS page carries 82 octets of content,
 * and 7-bit packing fits ⌊82 × 8 / 7⌋ = 93 septets into them (3GPP TS 23.041 CBS page structure).
 */
export const CELL_BROADCAST_PAGE_CHARS = 93;

/** A CBS message is a sequence of at most 15 pages (3GPP TS 23.041). Beyond that, content is DROPPED. */
export const CELL_BROADCAST_MAX_PAGES = 15;

/**
 * The GSM 03.38 default 7-bit alphabet, plus the characters reachable through the ESCAPE extension table.
 * Split in two because they do NOT cost the same: an extension character consumes TWO septets, so a page
 * holding 93 septets holds fewer than 93 extension characters. Getting that wrong would under-count pages
 * and silently truncate the end of a warning.
 */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€';

const BASIC = new Set([...GSM7_BASIC]);
const EXTENDED = new Set([...GSM7_EXTENDED]);

/** Septets one character costs in GSM-7, or `null` when the character is not encodable at all. */
function septetCost(ch: string): number | null {
  if (BASIC.has(ch)) return 1;
  if (EXTENDED.has(ch)) return 2;
  return null;
}

export interface CellBroadcastPreview {
  /** The pages, in order, each at most `CELL_BROADCAST_PAGE_CHARS` septets. */
  readonly pages: readonly string[];
  /** `pages.length` — carried explicitly because FEV-18 requires the count to be shown, not inferred. */
  readonly pageCount: number;
  /** True when the input did not fit in `CELL_BROADCAST_MAX_PAGES` and content was dropped. */
  readonly truncated: boolean;
  /**
   * Characters the GSM-7 alphabet cannot carry, de-duplicated, in first-appearance order. REPORTED, never
   * silently transliterated (ADR-036 §6): dropping the diacritic in a Romanian instruction can change the
   * word, so the operator chooses the substitution — the machine does not choose for them.
   */
  readonly unencodable: readonly string[];
  /** False when `unencodable` is non-empty — the text cannot be sent as GSM-7 as written. */
  readonly gsm7: boolean;
  /**
   * The ETWS primary-notification check: an ETWS primary notification carries a warning TYPE and no free
   * text, so only a very short lead line can be conveyed in it. True when the first page alone would carry
   * the whole message (3GPP TS 23.041 ETWS primary notification).
   */
  readonly fitsSinglePage: boolean;
  /** The mandatory caveat, carried WITH the data so a surface cannot render the count without it. */
  readonly notice: string;
}

/**
 * Split warning text into 93-septet cell-broadcast pages.
 *
 * Splitting is by SEPTET COST, not by string length or by code point: an extension-table character costs
 * two septets and a non-GSM-7 character costs nothing here (it is reported instead and excluded from the
 * pages, so the preview shows exactly what a GSM-7 channel would carry). Whitespace is normalised first —
 * a cell broadcast has no line breaks, and a stray newline would otherwise consume a septet and shift the
 * page boundaries the operator is being shown.
 */
export function renderCellBroadcastPages(text: string): CellBroadcastPreview {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const unencodable: string[] = [];
  const pages: string[] = [];
  let current = '';
  let cost = 0;

  for (const ch of normalized) {
    const septets = septetCost(ch);
    if (septets === null) {
      if (!unencodable.includes(ch)) unencodable.push(ch);
      continue;
    }
    if (cost + septets > CELL_BROADCAST_PAGE_CHARS) {
      pages.push(current);
      current = '';
      cost = 0;
    }
    current += ch;
    cost += septets;
  }
  if (current !== '') pages.push(current);

  const truncated = pages.length > CELL_BROADCAST_MAX_PAGES;
  const kept = truncated ? pages.slice(0, CELL_BROADCAST_MAX_PAGES) : pages;
  return {
    pages: kept,
    pageCount: kept.length,
    truncated,
    unencodable,
    gsm7: unencodable.length === 0,
    fitsSinglePage: kept.length <= 1,
    notice: CELL_BROADCAST_NOTICE,
  };
}
