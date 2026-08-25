// BEACON — Map module types (E8·T-358…T-370). The PURE vocabulary shared by the deck.gl layer builders,
// the injectable MapEngine, and the accessible list alternative. NO GL / deck / maplibre import here — the
// actual WebGL lives behind `MapEngine` (map-engine.ts) so every mapping fn stays unit-testable in happy-dom.
import type { Position } from '@/domain/value-objects/geo.js';
import type { ActorRole, LayerId } from '../../_lib/types.js';
import type { FreshnessMode } from '../ui/freshness-badge.js';
import type { Severity } from '../ui/severity-tag.js';

/** A GeoJSON polygon's rings (outer + holes), each a ring of [lon,lat] positions. */
export type PolygonRings = readonly (readonly Position[])[];

// ── Geolocated feature base (RBAC-aware, Art. XIV) ─────────────────────────────
// `position` is the PUBLIC / generalized location; `precisePosition` is the responder-only precise geom.

export interface GeoFeature {
  readonly id: string;
  readonly position: Position;
  readonly precisePosition?: Position;
}

// ── Per-layer input data shapes (deterministic, engine-supplied — no client scoring) ──

export interface FirePoint extends GeoFeature {
  readonly brightness?: number;
  readonly severity?: Severity;
}
export interface FireData {
  readonly hotspots: readonly FirePoint[];
  readonly perimeter?: PolygonRings;
}

export interface GaugeFeature extends GeoFeature {
  readonly stage?: number;
  readonly unit?: string;
  readonly status?: string;
  readonly name?: string;
}
export interface FloodData {
  readonly gauges: readonly GaugeFeature[];
  readonly extent?: PolygonRings;
}

export type InfraStatus = 'ONLINE' | 'AT_RISK' | 'OFFLINE';
export interface InfraNode extends GeoFeature {
  readonly kind?: string;
  readonly status?: InfraStatus;
  readonly name?: string;
}

export interface OutageArea {
  readonly id: string;
  readonly polygon: PolygonRings;
  readonly area?: string;
  readonly customersOut?: number;
  readonly assumedOffline?: boolean;
}

export interface CellCoverage extends GeoFeature {
  readonly technology?: string;
  readonly signal?: number;
  readonly online?: boolean;
}

/** A FEMA-NFHL (or equivalent) regulatory flood-zone polygon — never a live extent (T-367/W3b). */
export interface FloodZoneFeature {
  readonly id: string;
  readonly zone: string; // e.g. 'AE'
  readonly polygon: PolygonRings;
}

/**
 * The STORM family (ADR-032, FR-STORM-2): one dataset carrying the cyclone centre `track` (a LINE), the
 * agency forecast `cone` and the `surge` impact extent (POLYGONS). Every field is optional — an advisory may
 * ship a track with no cone yet, or a surge warning with no track. `agency`/`advisoryAt` attribute the
 * geometry so the cone's uncertainty label can name who issued it and when; BEACON models none of it.
 */
export interface StormData {
  readonly track?: readonly Position[];
  readonly cone?: PolygonRings;
  readonly surge?: PolygonRings;
  readonly agency?: string;
  readonly advisoryAt?: string;
}

/** A live camera pin (E11 "Live Views") — link-only: `viewUrl` opens the source's own live-view page in a
 *  new tab; the client never embeds or proxies video, and no engine/AI reads a pixel (Art. XII). */
export interface CameraPin {
  readonly id: string;
  readonly position: Position;
  readonly kind: string; // FIRE_CAMERA | TRAFFIC_CCTV | WEBCAM | CITIZEN_STREAM
  readonly title: string;
  readonly provider: string;
  readonly viewUrl: string; // external live-view page (https)
  readonly isLive: boolean;
}

/** The deterministic wind observation rendered as a single glyph at the observation point — never a
 *  synthesized/interpolated grid (locked decision, PHASE3-FULL-DELIVERY-PLAN.md "Locked decisions"). */
export interface WeatherObservation {
  readonly position: Position;
  readonly speedKmh: number;
  readonly directionDeg: number; // wind FROM bearing, degrees
  readonly compass: string; // 8-point token (N, NE, …) — a closed vocabulary, localized from the catalog
  readonly observedAt: string; // ISO-8601 — formatted client-side in the active region's timezone
  readonly label: string; // preformatted ENGLISH server label; the fallback when no translator is present
}

export interface ExposureNode extends GeoFeature {
  readonly kind?: string;
  readonly hazard?: string;
  readonly name?: string;
}

export interface ReportFeature extends GeoFeature {
  readonly text?: string;
  readonly status?: string;
  readonly confidence?: number;
}

export interface PredictionCone {
  readonly id: string;
  readonly polygon: PolygonRings;
  readonly method: string; // e.g. 'wind-buffer first-order'
  readonly inputs: string; // e.g. 'NWS wind 15kt @ 210°'
  readonly uncertainty: string; // e.g. '±30% buffer'
}

export interface RouteFeature {
  readonly id: string;
  readonly path: readonly Position[];
  readonly hazardAvoided?: boolean;
}

export interface ShelterFeature extends GeoFeature {
  readonly name?: string;
  readonly capacity?: number;
  readonly demand?: number;
}

/** Freshness descriptor for one layer, fed to the shared FreshnessBadge (icon + label, never bare time). */
export interface LayerFreshness {
  readonly fetchedAt: Date | string | number | null;
  readonly mode: FreshnessMode;
  readonly cadenceSec?: number;
}

/** The full map dataset consumed by the COP (each slice optional — an absent layer contributes nothing). */
export interface MapData {
  readonly fire?: FireData;
  readonly flood?: FloodData;
  readonly storm?: StormData;
  readonly infrastructure?: readonly InfraNode[];
  readonly outage?: readonly OutageArea[];
  readonly cell?: readonly CellCoverage[];
  readonly weather?: WeatherObservation;
  readonly floodZones?: readonly FloodZoneFeature[];
  readonly cameras?: readonly CameraPin[];
  readonly exposure?: readonly ExposureNode[];
  readonly reports?: readonly ReportFeature[];
  /** Prediction cones, in wire order — each carries its own method/inputs/uncertainty (ADR-033 §3.1).
   *  Absent (never `[]`) when the region has none, so the `prediction` toggle stays unlit. */
  readonly predictions?: readonly PredictionCone[];
  readonly route?: RouteFeature;
  readonly shelters?: readonly ShelterFeature[];
  readonly freshness?: Partial<Record<LayerId, LayerFreshness>>;
}

// ── deck.gl layer descriptors (serializable — the engine translates these to real deck layers) ──

export type LayerKind = 'scatterplot' | 'polygon' | 'path' | 'text';

/** One plottable datum. Fields are populated per-kind; the engine reads only what its layer kind needs. */
export interface LayerDatum {
  readonly id: string;
  readonly position?: Position;
  readonly polygon?: PolygonRings;
  readonly path?: readonly Position[];
  readonly label?: string;
  readonly severity?: Severity;
  readonly status?: string;
  readonly unverified?: boolean;
  readonly confidence?: number;
  /** Camera pins (E11): the source's own live-view page + provider, carried onto the datum so the pickable
   *  pin's tooltip/click can surface them. `viewUrl` is the ONLY link-out target (https, host-validated). */
  readonly provider?: string;
  readonly viewUrl?: string;
}

/**
 * A pure, GL-free description of a deck.gl layer. `group` is the toggle it belongs to (a group may emit
 * several descriptors, e.g. fire = perimeter + hotspots). The real engine maps kind → deck class + palette.
 */
export interface LayerDescriptor {
  readonly id: string;
  readonly group: LayerId;
  readonly kind: LayerKind;
  readonly data: readonly LayerDatum[];
  readonly pickable?: boolean;
  readonly caveat?: string;
  /** Optional per-layer click handler (E11 cameras): the engine wires it to the deck.gl layer's onClick,
   *  passing the picked datum. Additive + optional — a descriptor without it behaves exactly as before. */
  readonly onClick?: (datum: LayerDatum) => void;
}

/** The store-derived state buildLayers reads: which layers are on + the acting role (for PII gating). */
export interface MapLayerState {
  readonly layers: Record<LayerId, boolean>;
  readonly role: ActorRole;
}

// ── Injectable map engine (the ONLY WebGL seam; tests inject a fake) ───────────

export interface MapEngineOptions {
  readonly container: HTMLElement;
  readonly style?: string | Record<string, unknown>;
  readonly center?: Position;
  readonly zoom?: number;
  /**
   * Basemap click → the clicked ground position as `[lon, lat]` (GeoJSON axis order). Distinct from a
   * LayerDescriptor's `onClick`, which fires for a picked FEATURE; this fires for the map surface itself,
   * so an operator can pick an arbitrary point (an SOS location, an evacuation origin) instead of typing
   * coordinates into a form on a map product.
   */
  readonly onMapClick?: (position: Position) => void;
}

/** The thin GL boundary. `setLayers` swaps the deck overlay's layers; `destroy` tears the map down.
 *  `zoomIn`/`zoomOut`/`recenter` are the camera verbs behind the MapView's keyboard-operable control
 *  buttons (mouse-free operation — a crisis UI cannot assume a pointer): recenter restores the view the
 *  engine was created with (the region's home framing). */
export interface MapEngine {
  setLayers(descriptors: readonly LayerDescriptor[]): void;
  zoomIn(): void;
  zoomOut(): void;
  recenter(): void;
  destroy(): void;
}

/** Factory for a MapEngine — the real one uses MapLibre + deck; tests inject a fake or a throwing one. */
export type MapEngineFactory = (opts: MapEngineOptions) => MapEngine;
