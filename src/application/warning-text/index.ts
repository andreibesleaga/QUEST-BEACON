// BEACON — warning-text barrel (D3.5; ADR-036 §4/§6). Deterministic, locale-aware plain-language warning
// composition + the 3GPP cell-broadcast PREVIEW. Pure application layer: no adapters, no IO, no model.
export { buildWarningText, WARNING_SECTION_IDS } from './warning-text.js';
export type {
  WarningText, WarningTextInput, WarningSection, WarningSectionId, WarningTranslate,
} from './warning-text.js';

export {
  renderCellBroadcastPages, CELL_BROADCAST_NOTICE, CELL_BROADCAST_PAGE_CHARS, CELL_BROADCAST_MAX_PAGES,
} from './cell-broadcast.js';
export type { CellBroadcastPreview } from './cell-broadcast.js';
