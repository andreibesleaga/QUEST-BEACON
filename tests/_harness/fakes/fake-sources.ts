// BEACON test harness — in-memory data-source port fakes (TEST_PLAN §4; F1/F6). Each returns a
// `Sourced<T>` (data + freshness) so the provenance/freshness invariant (F1) holds by construction, and
// each carries a `down` toggle to simulate primary-source-down (returns a typed error the redundancy
// ladder descends past, F6). Freshness is built through the real Freshness VO (clock-skew guarded).
import type {
  HazardSourcePort,
  FloodGaugePort,
  WeatherSourcePort,
  WeatherObservation,
} from '@/ports/data-sources.js';
import type { InfrastructurePort } from '@/ports/infrastructure-sources.js';
import type { Sourced } from '@/ports/infra.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { HazardGeometry } from '@/domain/hazard-geometry.js';
import type { Gauge } from '@/domain/gauge.js';
import type { InfrastructureNode } from '@/domain/infrastructure-node.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError as DomainErr } from '@/domain/errors.js';
import { makeFreshness, type Freshness } from '@/domain/value-objects/freshness.js';
import { FIXED_NOW_MS } from '../clock.js';

const DEFAULT_FETCHED_AT = '2026-06-15T12:00:00.000Z';

function freshnessAt(fetchedAt: string): Freshness {
  return makeFreshness(fetchedAt, FIXED_NOW_MS);
}

function sourced<T>(data: T, fetchedAt: string): Sourced<T> {
  return { data, freshness: freshnessAt(fetchedAt) };
}

function downError(source: string): DomainError {
  return new DomainErr('NOT_FOUND', `${source} primary source down (injected)`);
}

export class FakeHazardSource implements HazardSourcePort {
  public down = false;
  constructor(
    private readonly hazards: readonly HazardGeometry[],
    private readonly fetchedAt = DEFAULT_FETCHED_AT,
  ) {}

  fetchHazards(): Promise<Result<Sourced<readonly HazardGeometry[]>, DomainError>> {
    if (this.down) return Promise.resolve(err(downError('hazard')));
    return Promise.resolve(ok(sourced(this.hazards, this.fetchedAt)));
  }
}

export class FakeFloodGauge implements FloodGaugePort {
  public down = false;
  constructor(
    private readonly gauges: readonly Gauge[],
    private readonly fetchedAt = DEFAULT_FETCHED_AT,
  ) {}

  fetchGauges(): Promise<Result<Sourced<readonly Gauge[]>, DomainError>> {
    if (this.down) return Promise.resolve(err(downError('flood-gauge')));
    return Promise.resolve(ok(sourced(this.gauges, this.fetchedAt)));
  }
}

export class FakeInfrastructure implements InfrastructurePort {
  public down = false;
  constructor(
    private readonly nodes: readonly InfrastructureNode[],
    private readonly fetchedAt = DEFAULT_FETCHED_AT,
  ) {}

  fetchNodes(): Promise<Result<Sourced<readonly InfrastructureNode[]>, DomainError>> {
    if (this.down) return Promise.resolve(err(downError('infrastructure')));
    return Promise.resolve(ok(sourced(this.nodes, this.fetchedAt)));
  }
}

export class FakeWeatherSource implements WeatherSourcePort {
  public down = false;
  constructor(
    private readonly observations: readonly WeatherObservation[],
    private readonly fetchedAt = DEFAULT_FETCHED_AT,
  ) {}

  fetchWeather(): Promise<Result<Sourced<readonly WeatherObservation[]>, DomainError>> {
    if (this.down) return Promise.resolve(err(downError('weather')));
    return Promise.resolve(ok(sourced(this.observations, this.fetchedAt)));
  }
}
