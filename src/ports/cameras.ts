// BEACON — Camera directory port (E11 "Live Views" · CW0; ADR-027). The outward seam for the live-camera
// source family (Caltrans CCTV, ALERTWildfire, Windy Webcams, 511 DOT, CNADNR-RO — wired as adapters in CW1).
// Interface signature only — anti-corruption boundary; every response carries freshness (Sourced<T>). Mirrors
// TelecomPort/OutagePort in infrastructure-sources.ts. Port-local DTOs (raw upstream shapes) live in each
// adapter's ACL, never here.
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CameraFeed } from '@/domain/camera-feed.js';
import type { Sourced } from './infra.js';
import type { AreaQuery } from './data-sources.js';

/** P16 — location-pinned live cameras for an area (link-out view pages; never embedded/proxied). */
export interface CameraDirectoryPort {
  fetchCameras(query: AreaQuery): Promise<Result<Sourced<readonly CameraFeed[]>, DomainError>>;
}
