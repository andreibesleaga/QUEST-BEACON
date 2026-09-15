// BEACON — WorldPop anti-corruption layer (E4·T-worldpop; adapter-contract §4, PopulationPort P12,
// Art. XII). Maps a WorldPop "stats" API response (dataset=wpgppop — gridded, modeled population summed
// over a queried polygon) → a canonical PopulationEstimate. This is the ONLY place the raw WorldPop
// response shape exists; no WorldPop field name escapes above this module (AGENTS.md §3). `count` is
// ROUNDED here, deterministically — never by the LLM (Art. XII).
//
// VERIFIED LIVE (2026-07-15, curl against api.worldpop.org — see worldpop-adapter.ts header for the exact
// commands). Both the async "finished task" response and the `runasync=false` synchronous response share
// this envelope:
//   { status, status_code, error, error_message, data: { total_population: number } | null, taskid,
//     startTime, endTime, executionTime }
// `data.total_population` is the MODELED population sum over the queried polygon (WorldPop wpgppop,
// ~100 m gridded, top-down disaggregated census/UN-adjusted) — a modeled estimate, not a live census
// count (honest limitation; DATA_SOURCE_VERIFICATION.md population row: verdict CACHED).
//
// The WorldPop API does not echo the query geometry back in the response, so the adapter (never this ACL)
// stitches the queried Region.bbox onto the raw row before mapping — WorldPopRaw.bbox is adapter-supplied,
// not part of the wire response; this ACL never invents the area itself.
import type { PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type { BBox } from '@/domain/value-objects/geo.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** Raw WorldPop stats-API JSON body (wire shape only — before the adapter stitches on the query bbox). */
export interface WorldPopStatsBody {
  readonly status?: string;
  readonly status_code?: number;
  readonly error?: boolean;
  readonly error_message?: string | null;
  readonly data?: { readonly total_population?: number | null } | null;
  readonly taskid?: string;
}

/** One WorldPop stats response bound to the bbox that was queried (stitched on by the adapter). */
export interface WorldPopRaw extends WorldPopStatsBody {
  readonly bbox: BBox;
}

/** Parse the WorldPop stats-API JSON body (shared by the async-finished and runasync=false shapes). */
export function parseWorldPopResponse(text: string): WorldPopStatsBody {
  return JSON.parse(text) as WorldPopStatsBody;
}

// No MapContext field is needed (PopulationEstimate carries no sourceId) — the mapper takes only `raw`,
// which TS/JS happily assigns to the two-arg AntiCorruptionMapper shape (extra caller args are ignored).
export const worldPopMapper: AntiCorruptionMapper<WorldPopRaw, PopulationEstimate> = {
  toCanonical(raw: WorldPopRaw): PopulationEstimate {
    if (raw.error === true) {
      throw makeAdapterError(
        'PARSE',
        `WorldPop task reported an error: ${raw.error_message ?? 'unknown'}`,
      );
    }
    const total = raw.data?.total_population;
    if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
      throw makeAdapterError(
        'PARSE',
        `WorldPop response missing/invalid data.total_population: ${JSON.stringify(raw.data)}`,
      );
    }
    return { area: raw.bbox, count: Math.round(total) };
  },
};
