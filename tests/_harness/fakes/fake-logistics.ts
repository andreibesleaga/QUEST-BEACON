// BEACON test harness — logistics/interop port fakes (TEST_PLAN §4; F6/F8/Art. XIII).
//   FakeRouting   — returns a hazard-avoiding EvacRoute; `heuristicOnly` degrades to a labeled
//                   straight-line route with avoidsHazard=false (routing fallback ladder, F6).
//   FakeAlertSink — emit() accepts ONLY an EmittableAlert (ACTUAL + approvedBy, compile-time HITL proof,
//                   Art. XIII). `failClosed` simulates a sink-down: the emission is rejected, never
//                   silently dropped (F8).
import type {
  RoutingPort,
  RouteRequest,
  AlertSinkPort,
  EmittableAlert,
} from '@/ports/logistics.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError as DomainErr } from '@/domain/errors.js';
import { makeEvacRoute } from '@/domain/evac-route.js';
import { evacRouteId } from '../builders/ids.js';

export class FakeRouting implements RoutingPort {
  public heuristicOnly = false;
  private seq = 0;

  route(request: RouteRequest): Promise<Result<EvacRoute, DomainError>> {
    const avoidsHazard = !this.heuristicOnly && (request.avoidHazard ?? true);
    const route = makeEvacRoute({
      id: evacRouteId(`route-${this.seq++}`),
      incidentId: request.incidentId,
      geom: { type: 'LineString', coordinates: [request.from, request.to] },
      avoidsHazard,
    });
    return Promise.resolve(ok(route));
  }
}

export class FakeAlertSink implements AlertSinkPort {
  public failClosed = false;
  public readonly emitted: EmittableAlert[] = [];

  emit(alert: EmittableAlert): Promise<Result<void, DomainError>> {
    if (this.failClosed) {
      return Promise.resolve(
        err(new DomainErr('CONFLICT', 'alert sink unavailable — fail-closed (F8)')),
      );
    }
    this.emitted.push(alert);
    return Promise.resolve(ok(undefined));
  }
}
