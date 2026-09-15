'use client';
// BEACON — the region delta channel's MOUNT POINT (F-320). Before this component existed, `_lib/sse.ts`
// was imported by exactly one file — its own test — so the COP never updated after first load. This is the
// component that makes the transport run in the product: it is rendered by the COP page with the active
// region, opens the stream through `useRegionSync`, and turns every delta into a TanStack Query
// invalidation (the mapping lives in `_lib/hooks.ts`, beside the keys it targets).
//
// Art. XII: nothing on this path reads a value out of a delta. A delta names WHAT changed; the invalidated
// query then REFETCHES it over REST, where provenance[]/freshness/RBAC all apply. No number, no geometry
// and no narration ever arrives over the stream, so there is nothing here for the UI to render.
//
// Art. XVI: the ladder is SSE → polling, and `data-transport` publishes which rung is live, so the fallback
// is observable rather than silent and the channel never dead-ends. Deliberately renders NO visible chrome
// and NO copy: adding a visible transport badge needs a new message key in all 14 `messages/*.json`
// catalogs (key-parity is enforced) and would move the frozen visual baselines — both outside this lane.
// Nothing anywhere claims a push channel it does not have; per-datum LIVE/CACHED/MOCK labelling continues
// to come from each refetched envelope's own provenance, which is exactly where it belongs.
import type { ReactNode } from 'react';
import { useRegionSync } from '../_lib/hooks.js';

export interface RegionStreamProps {
  /** The COP's active region. Undefined/empty ⇒ nothing is subscribed (transport 'idle'). */
  readonly regionId: string | undefined;
}

export function RegionStream({ regionId }: RegionStreamProps): ReactNode {
  const transport = useRegionSync(regionId);
  return <span hidden data-testid="region-stream" data-transport={transport} />;
}
