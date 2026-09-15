// BEACON — cell-broadcast page-splitting tests (D3.5; ADR-036 §6, V10/V11). Two categories:
// the ARITHMETIC (93-septet boundaries, the 15-page cap, GSM-7 encodability), and the HONESTY (this is a
// preview; it must be impossible to render a page count without the caveat, and impossible for this module
// to touch the network).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  CELL_BROADCAST_MAX_PAGES,
  CELL_BROADCAST_NOTICE,
  CELL_BROADCAST_PAGE_CHARS,
  renderCellBroadcastPages,
} from './cell-broadcast.js';

const repeat = (n: number, ch = 'A'): string => ch.repeat(n);

describe('page splitting (V10)', () => {
  it('fits exactly 93 characters on one page', () => {
    const out = renderCellBroadcastPages(repeat(CELL_BROADCAST_PAGE_CHARS));
    expect(out.pageCount).toBe(1);
    expect(out.pages[0]).toHaveLength(93);
    expect(out.fitsSinglePage).toBe(true);
  });

  it('splits at the 92/93/94 boundary exactly', () => {
    expect(renderCellBroadcastPages(repeat(92)).pageCount).toBe(1);
    expect(renderCellBroadcastPages(repeat(93)).pageCount).toBe(1);
    const over = renderCellBroadcastPages(repeat(94));
    expect(over.pageCount).toBe(2);
    expect(over.pages[0]).toHaveLength(93);
    expect(over.pages[1]).toHaveLength(1);
    expect(over.fitsSinglePage).toBe(false);
  });

  it('reports a page count that matches the pages returned', () => {
    for (const length of [0, 1, 93, 94, 200, 1394]) {
      const out = renderCellBroadcastPages(repeat(length));
      expect(out.pageCount).toBe(out.pages.length);
    }
  });

  it('handles an empty message without inventing a page', () => {
    const out = renderCellBroadcastPages('');
    expect(out.pages).toEqual([]);
    expect(out.pageCount).toBe(0);
    expect(out.truncated).toBe(false);
    expect(out.fitsSinglePage).toBe(true);
  });

  it('accepts exactly 15 pages and enforces the cap at 16', () => {
    const exact = renderCellBroadcastPages(
      repeat(CELL_BROADCAST_PAGE_CHARS * CELL_BROADCAST_MAX_PAGES),
    );
    expect(exact.pageCount).toBe(15);
    expect(exact.truncated).toBe(false);

    const over = renderCellBroadcastPages(
      repeat(CELL_BROADCAST_PAGE_CHARS * CELL_BROADCAST_MAX_PAGES + 1),
    );
    expect(over.pageCount).toBe(15); // the 16th page is DROPPED, as the standard requires
    expect(over.truncated).toBe(true); // …and the operator is told, rather than silently losing the tail
  });

  it('normalises whitespace so a stray newline cannot shift the page boundaries shown', () => {
    const out = renderCellBroadcastPages('  EVACUATE\n\nNOW  ');
    expect(out.pages).toEqual(['EVACUATE NOW']);
  });
});

describe('GSM-7 encodability', () => {
  it('counts an extension-table character as TWO septets (a page holds fewer of them)', () => {
    // '€' is on the GSM 03.38 extension table: 46 euro signs = 92 septets (fits), 47 = 94 (does not).
    expect(renderCellBroadcastPages(repeat(46, '€')).pageCount).toBe(1);
    expect(renderCellBroadcastPages(repeat(47, '€')).pageCount).toBe(2);
  });

  it('REPORTS a non-GSM-7 character rather than transliterating it', () => {
    // Romanian ș/ț are not in GSM 03.38. Silently folding them to s/t can change a word in an instruction,
    // so the operator is told and chooses — the machine does not choose for them.
    const out = renderCellBroadcastPages('Plecați acum din zonă');
    expect(out.gsm7).toBe(false);
    expect(out.unencodable).toContain('ț');
    // The reported characters are de-duplicated and the pages show exactly what GSM-7 would carry.
    expect(new Set(out.unencodable).size).toBe(out.unencodable.length);
    expect(out.pages.join('')).not.toContain('ț');
  });

  it('accepts plain English protective-action text as pure GSM-7', () => {
    const out = renderCellBroadcastPages(
      'FLOOD - Severe. Leave the floodplain now. Do not drive through water.',
    );
    expect(out.gsm7).toBe(true);
    expect(out.unencodable).toEqual([]);
  });
});

describe('honesty (V11) — this is a preview and must be unable to pretend otherwise', () => {
  it('carries the caveat WITH the data, so no surface can render a page count without it', () => {
    const out = renderCellBroadcastPages('EVACUATE NOW');
    expect(out.notice).toBe(CELL_BROADCAST_NOTICE);
  });

  it('states, verbatim, that BEACON is not a Cell Broadcast Entity and has no telco delivery path', () => {
    expect(CELL_BROADCAST_NOTICE).toContain('Preview only');
    expect(CELL_BROADCAST_NOTICE).toContain('not a Cell Broadcast Entity');
    expect(CELL_BROADCAST_NOTICE).toContain('no telco delivery path');
    expect(CELL_BROADCAST_NOTICE).toContain('cannot transmit');
  });

  it('performs NO network call — the module source contains no egress primitive at all', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./cell-broadcast.ts', import.meta.url)),
      'utf8',
    );
    // Asserted against the SOURCE rather than by mocking, because the claim is "there is no such code path",
    // not "the path we know about was not taken today".
    for (const primitive of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'http.request', 'require(']) {
      expect(source, `cell-broadcast.ts must not reference ${primitive}`).not.toContain(primitive);
    }
    expect(source).not.toMatch(/^import .*(node:http|node:net|undici|axios)/m);
  });
});
