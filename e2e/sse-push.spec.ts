// BEACON — SSE PUSH, proven end to end in a real browser (finding F-416).
//
// WHY THIS FILE EXISTS. The delta channel was infrastructure with no producer: `EventBusPort.publish` was
// declared, implemented, and called from NO production code path, so `GET /api/v1/stream` served `hello`
// plus heartbeats forever. The COP still refreshed — on the client's 15 s polling rung — so nothing looked
// broken, and every existing test passed. It was the sixth instance of "code exists, nothing runs it" in
// this project, and it sat on **Timeliness**, the rubric category Phase 2 flagged as weakest, behind a demo beat
// the shot-list told the entrant to FILM.
//
// The unit test (`http-dispatcher.test.ts`) proves the dispatcher calls `publish`. That is necessary and
// not sufficient: it stubs the bus. THIS spec proves the whole chain in a real browser with no stubs —
// browser `EventSource` → Next route → `handleStream` → the process-wide EventBus → the dispatcher's
// publish on a real HTTP mutation. If any link is missing, or the SSE route ever forks its own bus instance
// (the exact hazard `route.ts` warns about), this fails and the polling rung silently covers it everywhere
// else.
//
// THE DISCRIMINATOR IS THE TIMEOUT. Polling refreshes every 15 s, so a delta observed within a few seconds
// CANNOT be the polling rung — it can only be push. That is what makes this a proof of "push", not merely
// of "the COP eventually updates".
//
// WebGL is left alone deliberately: this spec never touches the map, and the fallback/real-map distinction
// is irrelevant to the data channel.
import { test, expect } from '@playwright/test';
import { DEFAULT_REGION_ID } from './helpers.js';

/** Comfortably under the 15 s polling interval — see "THE DISCRIMINATOR" above. */
const PUSH_DEADLINE_MS = 8_000;
/** The seeded CA incident every offline profile carries; links the report so the delta is attributable. */
const CA_INCIDENT = 'us-ca-wildfire-demo';

test.describe('SSE push — the delta channel actually delivers (F-416)', () => {
  test('a real mutation pushes a region-keyed delta to a listening browser, well inside the polling interval', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'commit' });

    const frame = await page.evaluate(
      async ({ region, incidentId, deadlineMs }) => {
        return await new Promise<string | null>((resolve) => {
          const es = new EventSource(`/api/v1/stream?regionId=${encodeURIComponent(region)}`);
          const done = (value: string | null): void => {
            es.close();
            resolve(value);
          };
          const timer = setTimeout(() => done(null), deadlineMs);
          es.addEventListener('delta', (event) => {
            clearTimeout(timer);
            done((event as MessageEvent<string>).data);
          });
          // Mutate only AFTER the subscription is open, otherwise the delta is published to nobody and this
          // test would flake on a race rather than fail on a defect.
          es.addEventListener('hello', () => {
            void fetch('/api/v1/reports', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                consent: true,
                text: 'SSE push verification — a real consented report on the seeded CA incident.',
                incidentId,
              }),
            });
          });
        });
      },
      { region: DEFAULT_REGION_ID, incidentId: CA_INCIDENT, deadlineMs: PUSH_DEADLINE_MS },
    );

    expect(
      frame,
      'no delta arrived within the push deadline — the channel is open but nothing is publishing (F-416)',
    ).not.toBeNull();

    const delta = JSON.parse(frame as string) as Record<string, unknown>;

    // Art. XII — a delta is a doorbell, never a delivery. EXACTLY these four keys: what changed, where,
    // which one, when. The client refetches over REST, where provenance, freshness and RBAC apply. If a
    // coordinate, a casualty count or a confidence score ever rides this channel it bypasses all three.
    expect(Object.keys(delta).sort()).toEqual(['at', 'entity', 'region', 'type']);
    expect(delta['type']).toBe('report.created');
    // Region-keyed (THREAT T13.1): a subscriber sees only its own region's changes.
    expect(delta['region']).toBe(DEFAULT_REGION_ID);
    expect(typeof delta['entity']).toBe('string');
  });

  test('a subscriber to a DIFFERENT region receives nothing — cross-region isolation (THREAT T13.1)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'commit' });

    // Subscribe to a region the mutation does NOT belong to. A shorter deadline is correct here: this
    // asserts an ABSENCE, and the previous test already establishes that a correctly-keyed delta arrives
    // fast, so a quiet channel here is isolation working rather than the whole mechanism being asleep.
    const leaked = await page.evaluate(
      async ({ incidentId }) => {
        return await new Promise<string | null>((resolve) => {
          const es = new EventSource('/api/v1/stream?regionId=ro');
          const done = (value: string | null): void => {
            es.close();
            resolve(value);
          };
          const timer = setTimeout(() => done(null), 4_000);
          es.addEventListener('delta', (event) => {
            clearTimeout(timer);
            done((event as MessageEvent<string>).data);
          });
          es.addEventListener('hello', () => {
            void fetch('/api/v1/reports', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                consent: true,
                text: 'Cross-region isolation check — this belongs to the CA incident, not to ro.',
                incidentId,
              }),
            });
          });
        });
      },
      { incidentId: CA_INCIDENT },
    );

    expect(leaked, `a ro subscriber received a us-ca delta: ${String(leaked)}`).toBeNull();
  });
});
