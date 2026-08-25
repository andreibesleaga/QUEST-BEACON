// BEACON — GeoJSON anti-corruption mapper (E7·F15; ADR-010, RFC 7946). Maps the canonical Geometry value
// object to/from GeoJSON Feature / FeatureCollection, round-trip safe. Canonical Geometry is already an
// RFC 7946 geometry ([lon,lat] order); this layer wraps/unwraps it as Feature(Collection) and validates
// against an inline draft-2020-12 GeoJSON schema (validate-before-emit, consistent with E4/E6 Ajv 2020).
import type { Geometry } from '@/domain/value-objects/geo.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { ok } from '@/domain/shared/result.js';
import { parseErr, validatedBySchema } from './interop-result.js';

// Canonical Geometry supports these RFC 7946 types (SpatialPort math lives elsewhere).
const DOMAIN_GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon', 'MultiPolygon'] as const;

export interface Feature {
  readonly type: 'Feature';
  readonly geometry: Geometry;
  readonly properties: Readonly<Record<string, unknown>>;
}
export interface FeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly Feature[];
}

const GEOMETRY_SCHEMA = {
  type: 'object',
  required: ['type', 'coordinates'],
  properties: {
    type: {
      type: 'string',
      enum: ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon'],
    },
    coordinates: { type: 'array' },
  },
} as const;

const FEATURE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://beacon.local/schemas/geojson-feature.schema.json',
  type: 'object',
  required: ['type', 'geometry', 'properties'],
  properties: {
    type: { const: 'Feature' },
    geometry: GEOMETRY_SCHEMA,
    properties: { type: ['object', 'null'] },
  },
} as const;

const FEATURE_COLLECTION_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://beacon.local/schemas/geojson-featurecollection.schema.json',
  type: 'object',
  required: ['type', 'features'],
  properties: {
    type: { const: 'FeatureCollection' },
    features: { type: 'array', items: FEATURE_SCHEMA },
  },
} as const;

function isDomainGeometryType(type: string): boolean {
  return (DOMAIN_GEOMETRY_TYPES as readonly string[]).includes(type);
}

/** Pure transform: canonical Geometry → GeoJSON Feature (optional properties bag). */
export function buildFeature(geometry: Geometry, properties: Record<string, unknown> = {}): Feature {
  return { type: 'Feature', geometry, properties };
}

/** Map a canonical Geometry to a schema-valid GeoJSON Feature. */
export function geometryToFeature(
  geometry: Geometry,
  properties: Record<string, unknown> = {},
): Result<Feature, DomainError> {
  return validatedBySchema('GeoJSON Feature', 'interop:geojson-feature', FEATURE_SCHEMA, buildFeature(geometry, properties));
}

/** Map many canonical Geometries to a schema-valid GeoJSON FeatureCollection. */
export function geometriesToFeatureCollection(
  geometries: readonly Geometry[],
  properties: readonly Record<string, unknown>[] = [],
): Result<FeatureCollection, DomainError> {
  const features = geometries.map((g, i) => buildFeature(g, properties[i] ?? {}));
  const fc: FeatureCollection = { type: 'FeatureCollection', features };
  return validatedBySchema('GeoJSON FeatureCollection', 'interop:geojson-fc', FEATURE_COLLECTION_SCHEMA, fc);
}

/** Recover a canonical Geometry from a GeoJSON Feature (inbound anti-corruption). */
export function featureToGeometry(feature: Feature): Result<Geometry, DomainError> {
  const geometry = feature?.geometry;
  if (!geometry || typeof geometry.type !== 'string') {
    return parseErr('GeoJSON Feature has no geometry to map');
  }
  if (!isDomainGeometryType(geometry.type)) {
    return parseErr(`GeoJSON geometry type '${geometry.type}' is not a canonical Geometry type`);
  }
  return ok(geometry);
}

/** Recover the canonical Geometries from a GeoJSON FeatureCollection. */
export function featureCollectionToGeometries(fc: FeatureCollection): Result<Geometry[], DomainError> {
  const out: Geometry[] = [];
  for (const feature of fc.features) {
    const mapped = featureToGeometry(feature);
    if (!mapped.ok) return mapped;
    out.push(mapped.value);
  }
  return ok(out);
}
