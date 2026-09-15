'use client';
// BEACON — MapFeatureList (E8·T-391; S3·U3). The ACCESSIBLE, keyboard-first alternative to the pointer-
// driven map (WCAG 2.2 §2.5.7): the SAME features as an aria-labelled table — every one of the 14
// LAYER_IDS contributes rows when it has data (S3 Lane U3), every row reachable + selectable by keyboard.
// A layer with no data contributes nothing, exactly like the map (absent, never a fabricated row —
// Art. XVI). Precise-PII geometry is gated by role here too (T-370) so the list never leaks a location
// the map itself would hide.
import type { ReactNode } from 'react';
import type { Position } from '@/domain/value-objects/geo.js';
import type { ActorRole } from '../../_lib/types.js';
import { useUiStore } from '../../_lib/store.js';
import { useT } from '../../_lib/i18n.js';
import { Button, UnverifiedBadge } from '../ui/index.js';
import { visibleGeometry } from './geometry.js';
import {
  FLOODZONE_CAVEAT,
  LAYER_META,
  STORM_CAVEAT,
  STORM_CONE_LABEL,
  STORM_SURGE_LABEL,
  STORM_TRACK_LABEL,
  WEATHER_CAVEAT,
  predictionCaveat,
  shelterCapacityLabel,
  stormConeCaveat,
  weatherLabel,
  type MapT,
} from './build-layers.js';
import type { GaugeFeature, MapData, OutageArea, PolygonRings, StormData } from './types.js';

export interface FeatureRow {
  readonly key: string;
  readonly refId: string;
  readonly groupLabel: string;
  readonly label: string;
  readonly detail: string;
  readonly position: Position;
  readonly unverified?: boolean;
  readonly confidence?: number;
}

const coords = (p: Position): string => `${p[1].toFixed(3)}, ${p[0].toFixed(3)}`;

/** A polygon's representative listing point: the first vertex of its outer ring (undefined ⇒ skip the row —
 *  geometry-less data must degrade to NO row, never to a fabricated location). */
const firstVertex = (rings: PolygonRings): Position | undefined => rings[0]?.[0];

function fireRows(data: MapData, t?: MapT): FeatureRow[] {
  return (data.fire?.hotspots ?? []).map((h) => ({
    key: `fire-${h.id}`,
    refId: h.id,
    groupLabel: t?.('group.fire') ?? 'Fire detection',
    label: h.id,
    // `severity` is the source's severity token (a machine value) — only the wording around it is localized.
    detail: h.severity
      ? (t?.('detail.severity', { severity: h.severity }) ?? `Severity ${h.severity}`)
      : (t?.('detail.thermalHotspot') ?? 'Thermal hotspot'),
    position: h.position,
  }));
}

/** Stage + unit of record (`ft`, `m`) are never localized — a metre is a metre in every locale. */
function gaugeDetail(g: GaugeFeature, t?: MapT): string {
  if (g.stage === undefined) return g.status ?? t?.('detail.gauge') ?? 'Gauge';
  const stage = `${g.stage}${g.unit ?? ''}`;
  return t?.('detail.stage', { stage }) ?? `Stage ${stage}`;
}

function gaugeRows(data: MapData, t?: MapT): FeatureRow[] {
  return (data.flood?.gauges ?? []).map((g) => ({
    key: `gauge-${g.id}`,
    refId: g.id,
    groupLabel: t?.('group.gauge') ?? 'Flood gauge',
    label: g.name ?? g.id,
    detail: gaugeDetail(g, t),
    position: g.position,
  }));
}

function infraRows(data: MapData, t?: MapT): FeatureRow[] {
  return (data.infrastructure ?? []).map((n) => {
    const kind = n.kind ?? t?.('detail.node') ?? 'Node';
    const status = n.status ?? 'ONLINE'; // status is a machine token (ONLINE/AT_RISK/…) — never translated
    return {
      key: `infra-${n.id}`,
      refId: n.id,
      groupLabel: t?.('group.infra') ?? 'Infrastructure',
      label: n.name ?? n.id,
      detail: t?.('detail.infra', { kind, status }) ?? `${kind} — ${status}`,
      position: n.position,
    };
  });
}

function exposureRows(data: MapData, t?: MapT): FeatureRow[] {
  return (data.exposure ?? []).map((n) => ({
    key: `exp-${n.id}`,
    refId: n.id,
    groupLabel: t?.('group.exposure') ?? 'Exposure',
    label: n.name ?? n.id,
    detail: n.hazard
      ? (t?.('detail.inHazard', { hazard: n.hazard }) ?? `In hazard: ${n.hazard}`)
      : (t?.('detail.nodeInHazard') ?? 'Node in hazard'),
    position: n.position,
  }));
}

function reportRows(data: MapData, role: ActorRole, t?: MapT): FeatureRow[] {
  return (data.reports ?? []).map((r) => ({
    key: `report-${r.id}`,
    refId: r.id,
    groupLabel: t?.('group.report') ?? 'Report / SOS',
    label: r.text ?? r.id,
    detail: r.status ?? 'UNVERIFIED', // verification-state token (machine value) — never translated
    position: visibleGeometry(r, role),
    unverified: true,
    ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
  }));
}

function shelterRows(data: MapData, t?: MapT): FeatureRow[] {
  return (data.shelters ?? []).map((s) => ({
    key: `shelter-${s.id}`,
    refId: s.id,
    groupLabel: t?.('group.shelter') ?? 'Shelter',
    label: s.name ?? s.id,
    detail: shelterCapacityLabel(s, t),
    position: s.position,
  }));
}

// ── The eight layers added in S3·U3 (storm, floodzone, outage, cell, weather, cameras, prediction, route).
// Group labels come from the SAME catalog keys the toggle panel renders (`layer.*`), with LAYER_META as the
// English fallback — the list and the panel can never name a layer differently.

// Storm family (ADR-032): one row PER geometry the advisory actually supplies — track, cone, surge.
// Split into one function per geometry (like buildStormLayers' own stormPolygon split) for the
// complexity ceiling: the `t?.(…) ?? fallback` idiom is branch-heavy by construction.

const stormGroupLabel = (t?: MapT): string => t?.('layer.storm') ?? LAYER_META.storm.label;
const stormCaveatText = (t?: MapT): string => t?.('caveat.storm') ?? STORM_CAVEAT;

function stormTrackRow(s: StormData, t?: MapT): FeatureRow | undefined {
  const position = s.track?.[0];
  if (position === undefined) return undefined;
  const label = t?.('storm.trackLabel') ?? STORM_TRACK_LABEL;
  return {
    key: 'storm-track',
    refId: 'storm-track',
    groupLabel: stormGroupLabel(t),
    label,
    detail: stormCaveatText(t),
    position,
  };
}

/** The cone's row carries the MANDATORY cone caveat (issuer + advisory instant when attributed, FEV-5). */
function stormConeRow(s: StormData, t?: MapT): FeatureRow | undefined {
  const position = s.cone === undefined ? undefined : firstVertex(s.cone);
  if (position === undefined) return undefined;
  const label = t?.('storm.coneLabel') ?? STORM_CONE_LABEL;
  return {
    key: 'storm-cone',
    refId: 'storm-cone',
    groupLabel: stormGroupLabel(t),
    label,
    detail: stormConeCaveat(s, t),
    position,
  };
}

function stormSurgeRow(s: StormData, t?: MapT): FeatureRow | undefined {
  const position = s.surge === undefined ? undefined : firstVertex(s.surge);
  if (position === undefined) return undefined;
  const label = t?.('storm.surgeLabel') ?? STORM_SURGE_LABEL;
  return {
    key: 'storm-surge',
    refId: 'storm-surge',
    groupLabel: stormGroupLabel(t),
    label,
    detail: stormCaveatText(t),
    position,
  };
}

function stormRows(data: MapData, t?: MapT): FeatureRow[] {
  const s = data.storm;
  if (s === undefined) return [];
  const rows = [stormTrackRow(s, t), stormConeRow(s, t), stormSurgeRow(s, t)];
  return rows.filter((r): r is FeatureRow => r !== undefined);
}

function floodZoneRows(data: MapData, t?: MapT): FeatureRow[] {
  const rows: FeatureRow[] = [];
  for (const z of data.floodZones ?? []) {
    const position = firstVertex(z.polygon);
    if (position === undefined) continue;
    rows.push({
      key: `floodzone-${z.id}`,
      refId: z.id,
      groupLabel: t?.('layer.floodzone') ?? LAYER_META.floodzone.label,
      // `zone` is the NFHL zone CODE (a machine value) — only the wording around it is localized.
      label: t?.('zone.label', { zone: z.zone }) ?? `Zone ${z.zone}`,
      detail: t?.('caveat.floodzone') ?? FLOODZONE_CAVEAT,
      position,
    });
  }
  return rows;
}

/** The outage row's state wording — the same keys/fallbacks buildOutageLayers composes for the map datum. */
function outageDetail(a: OutageArea, t?: MapT): string {
  const assumed = a.assumedOffline !== false;
  const state = assumed
    ? (t?.('outage.assumedOffline') ?? 'ASSUMED offline')
    : (t?.('outage.reportedOffline') ?? 'Reported offline');
  const count = a.customersOut;
  if (count === undefined) return state;
  return (
    t?.('outage.withCount', { count: String(count), state }) ?? `${count} customers out — ${state}`
  );
}

function outageRows(data: MapData, t?: MapT): FeatureRow[] {
  const rows: FeatureRow[] = [];
  for (const a of data.outage ?? []) {
    const position = firstVertex(a.polygon);
    if (position === undefined) continue;
    rows.push({
      key: `outage-${a.id}`,
      refId: a.id,
      groupLabel: t?.('layer.outage') ?? LAYER_META.outage.label,
      label: a.area ?? a.id,
      detail: outageDetail(a, t),
      position,
    });
  }
  return rows;
}

function cellRows(data: MapData, t?: MapT): FeatureRow[] {
  return (data.cell ?? []).map((c) => {
    const kind = c.technology ?? 'CELL'; // technology token (LTE/5G/…) — a machine value, never translated
    const status = c.online === false ? 'OFFLINE' : 'ONLINE'; // machine token, same rule as buildCellLayers
    return {
      key: `cell-${c.id}`,
      refId: c.id,
      groupLabel: t?.('layer.cell') ?? LAYER_META.cell.label,
      label: c.id,
      detail: t?.('detail.infra', { kind, status }) ?? `${kind} — ${status}`,
      position: c.position,
    };
  });
}

/** ONE row per observation — the wind glyph's own composed label (never a synthesized grid, T-368). */
function weatherRows(data: MapData, t?: MapT): FeatureRow[] {
  const w = data.weather;
  if (w === undefined) return [];
  return [
    {
      key: 'weather-observation',
      refId: 'weather-observation',
      groupLabel: t?.('layer.weather') ?? LAYER_META.weather.label,
      label: weatherLabel(w, t),
      detail: t?.('caveat.weather') ?? WEATHER_CAVEAT,
      position: w.position,
    },
  ];
}

function cameraRows(data: MapData, t?: MapT): FeatureRow[] {
  return (data.cameras ?? []).map((c) => ({
    key: `camera-${c.id}`,
    refId: c.id,
    groupLabel: t?.('layer.cameras') ?? LAYER_META.cameras.label,
    label: c.title,
    // `provider` is a proper noun and LIVE/SNAPSHOT a machine token — only the joining format is localized.
    detail:
      t?.('detail.infra', { kind: c.provider, status: c.isLive ? 'LIVE' : 'SNAPSHOT' }) ??
      `${c.provider} — ${c.isLive ? 'LIVE' : 'SNAPSHOT'}`,
    position: c.position,
  }));
}

/** One row PER cone, each keeping its own method/inputs/uncertainty sentence (dynamic caveat — rendered
 *  verbatim by design, exactly as the map's caveat is; see caveatText in build-layers.ts). */
function predictionRows(data: MapData, t?: MapT): FeatureRow[] {
  const rows: FeatureRow[] = [];
  for (const cone of data.predictions ?? []) {
    const position = firstVertex(cone.polygon);
    if (position === undefined) continue;
    rows.push({
      key: `prediction-${cone.id}`,
      refId: cone.id,
      groupLabel: t?.('layer.prediction') ?? LAYER_META.prediction.label,
      label: cone.id,
      detail: predictionCaveat(cone),
      position,
    });
  }
  return rows;
}

function routeRows(data: MapData, t?: MapT): FeatureRow[] {
  const r = data.route;
  const position = r?.path[0];
  if (r === undefined || position === undefined) return [];
  const groupLabel = t?.('layer.route') ?? LAYER_META.route.label;
  // `hazardAvoided` is the ENGINE's own claim, echoed as a machine token (the report-status precedent);
  // when the engine made no claim the row repeats the layer name rather than inventing one (Art. XVI).
  const detail =
    r.hazardAvoided === undefined ? groupLabel : r.hazardAvoided ? 'HAZARD-AVOIDED' : 'DIRECT-PATH';
  return [{ key: `route-${r.id}`, refId: r.id, groupLabel, label: r.id, detail, position }];
}

/**
 * Pure flatten of the map dataset into keyboard-listable rows (PII-gated) — unit-testable without a DOM.
 * Row groups follow LAYER_IDS order, so the list reads in the same sequence as the layer toggle panel.
 * The translator is optional: without one every row carries the verbatim English source text (FR-I18N-2).
 */
export function toFeatureRows(data: MapData, role: ActorRole, t?: MapT): FeatureRow[] {
  return [
    ...fireRows(data, t),
    ...gaugeRows(data, t),
    ...stormRows(data, t),
    ...floodZoneRows(data, t),
    ...infraRows(data, t),
    ...outageRows(data, t),
    ...cellRows(data, t),
    ...weatherRows(data, t),
    ...cameraRows(data, t),
    ...exposureRows(data, t),
    ...reportRows(data, role, t),
    ...predictionRows(data, t),
    ...routeRows(data, t),
    ...shelterRows(data, t),
  ];
}

export interface MapFeatureListProps {
  readonly data: MapData;
  /** Overrides the store role (mainly for tests); defaults to the acting principal's role. */
  readonly role?: ActorRole | undefined;
  /** Called when a row's focus button is activated; defaults to selecting it as the active incident. */
  readonly onSelectFeature?: ((id: string) => void) | undefined;
  readonly className?: string | undefined;
}

export function MapFeatureList({
  data,
  role,
  onSelectFeature,
  className,
}: MapFeatureListProps): ReactNode {
  const storeRole = useUiStore((s) => s.actorRole);
  const selectIncident = useUiStore((s) => s.selectIncident);
  const t = useT('map');
  const effectiveRole = role ?? storeRole;
  const select = onSelectFeature ?? selectIncident;
  const rows = toFeatureRows(data, effectiveRole, t);

  return (
    <section
      aria-label={t('list.regionLabel')}
      data-testid="map-feature-list"
      className={className}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('list.empty')}</p>
      ) : (
        <table className="w-full border-collapse text-sm text-fg [font-feature-settings:'tnum']">
          <caption className="sr-only">{t('list.caption')}</caption>
          <thead>
            <tr className="text-start text-fg-muted">
              <th scope="col" className="py-1 pe-3">
                {t('list.colType')}
              </th>
              <th scope="col" className="py-1 pe-3">
                {t('list.colFeature')}
              </th>
              <th scope="col" className="py-1 pe-3">
                {t('list.colDetail')}
              </th>
              <th scope="col" className="py-1 pe-3">
                {t('list.colLocation')}
              </th>
              <th scope="col" className="py-1">
                {t('list.colAction')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className="border-t border-line align-top transition-colors duration-150 ease-out hover:bg-surface-2"
              >
                <td className="py-1 pe-3">{r.groupLabel}</td>
                <td className="py-1 pe-3">
                  <span>{r.label}</span>
                  {r.unverified ? (
                    <span className="ms-2 inline-flex">
                      <UnverifiedBadge
                        {...(r.confidence !== undefined ? { confidence: r.confidence } : {})}
                      />
                    </span>
                  ) : null}
                </td>
                <td className="py-1 pe-3">{r.detail}</td>
                <td className="py-1 pe-3">{coords(r.position)}</td>
                <td className="py-1">
                  <Button size="sm" variant="ghost" onClick={() => select(r.refId)}>
                    {t('list.focus', { label: r.label })}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
