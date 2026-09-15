'use client';
// BEACON — the honest "this text is English" chip (FR-I18N; Art. XVI degrade-with-a-label).
//
// Deterministic content — reporter claims, news-grounded facts, engine-built strings — is authored in
// English and is NOT machine-translated: a reporter's claim is evidence a verifier judges, and a
// translated claim is no longer the reporter's words; the news facts carry cited figures the LLM is
// forbidden to restate (Art. XII). When the UI language is not English that policy must be VISIBLE, not
// silent — an untranslated string with no label reads as a bug (which is exactly how it was reported,
// 2026-08-04). The chip renders nothing when the UI is English, and otherwise a small "EN" marker whose
// hover/title says plainly that the content is shown in English. AI-narrated prose does NOT get the chip:
// since the beacon-locale cookie now reaches NarrativeRequest.locale, the model writes it in the UI
// language directly.
import type { ReactNode } from 'react';
import { useLocaleId, useT } from '../../_lib/i18n.js';

export function OriginalLanguageChip(): ReactNode {
  const locale = useLocaleId();
  const t = useT('content');
  if (locale === 'en') return null;
  return (
    <span
      title={t('untranslatedHint')}
      aria-label={t('untranslatedHint')}
      data-testid="original-language-chip"
      className="ms-1 inline-flex shrink-0 cursor-help items-center rounded border border-line px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
    >
      {t('originalLanguage')}
    </span>
  );
}
