// BEACON — config fail-fast tests (E0·T-012/T-013). TDD: these define the boot contract.
import { describe, it, expect } from 'vitest';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  it('applies safe local-first defaults on an empty env', () => {
    const c = loadConfig({});
    expect(c.DEPLOY_MODE).toBe('local');
    expect(c.FEATURE_REALTIME).toBe('sse');
    expect(c.AI_MODE).toBe('off'); // offline-first default (matches resolveAi: unset AI_MODE ⇒ deterministic-only)
    expect(c.DATA_SOURCE_COMPOSITION).toBe('seed');
    expect(c.AUTH_DEV_LOGIN).toBe('off');
    expect(c.DEFAULT_REGION_ID).toBe('us-ca');
    expect(c.COMPLIANCE_PROXY_ENABLED).toBe('on');
  });

  it('rejects an unknown enum value (fail-fast)', () => {
    expect(() => loadConfig({ DEPLOY_MODE: 'moon' })).toThrow(/DEPLOY_MODE/);
  });

  it('requires REDIS_URL when FEATURE_CACHE=redis', () => {
    expect(() => loadConfig({ FEATURE_CACHE: 'redis' })).toThrow(/REDIS_URL/);
  });

  it('requires REDIS_URL when FEATURE_QUEUE=bullmq', () => {
    expect(() => loadConfig({ FEATURE_QUEUE: 'bullmq' })).toThrow(/REDIS_URL/);
  });

  it('accepts redis mode when REDIS_URL is present', () => {
    const c = loadConfig({ FEATURE_CACHE: 'redis', REDIS_URL: 'redis://localhost:6379' });
    expect(c.FEATURE_CACHE).toBe('redis');
  });

  it('coerces APP_PORT to a number', () => {
    expect(loadConfig({ APP_PORT: '8080' }).APP_PORT).toBe(8080);
  });

  it('defaults FEATURE_STORE to memory (offline-first, Art. XVI)', () => {
    expect(loadConfig({}).FEATURE_STORE).toBe('memory');
  });

  it('rejects FEATURE_STORE=postgres without a real DATABASE_URL (fail-fast)', () => {
    // DATABASE_URL is left to its placeholder default → the durable store gate must trip.
    expect(() => loadConfig({ FEATURE_STORE: 'postgres' })).toThrow(/DATABASE_URL/);
  });

  it('accepts FEATURE_STORE=postgres when a real DATABASE_URL is set', () => {
    const c = loadConfig({
      FEATURE_STORE: 'postgres',
      DATABASE_URL: 'postgres://beacon:beacon@db:5432/beacon',
    });
    expect(c.FEATURE_STORE).toBe('postgres');
    expect(c.DATABASE_URL).toBe('postgres://beacon:beacon@db:5432/beacon');
  });

  it('defaults CHANNEL_WHATSAPP_MODE to mock (WhatsApp transport is a deliberate stub, ADR-023)', () => {
    const c = loadConfig({});
    expect(c.CHANNEL_WHATSAPP_MODE).toBe('mock');
  });

  it('rejects CHANNEL_WHATSAPP_MODE=live (T-457 not wired — fails fast rather than silently no-op)', () => {
    expect(() => loadConfig({ CHANNEL_WHATSAPP_MODE: 'live' })).toThrow(/CHANNEL_WHATSAPP_MODE/);
  });

  it('defaults CHANNEL_CLI_ENABLED to on', () => {
    expect(loadConfig({}).CHANNEL_CLI_ENABLED).toBe('on');
  });

  it('defaults the Live-Views flags: cameras=on (offline-safe), external-views=on (Q4), citizen-stream=off (Q2)', () => {
    const c = loadConfig({});
    expect(c.FEATURE_CAMERAS).toBe('on');
    expect(c.FEATURE_EXTERNAL_VIEWS).toBe('on');
    expect(c.FEATURE_CITIZEN_STREAM).toBe('off');
  });

  it('accepts overriding the Live-Views flags', () => {
    const c = loadConfig({ FEATURE_CAMERAS: 'off', FEATURE_CITIZEN_STREAM: 'on' });
    expect(c.FEATURE_CAMERAS).toBe('off');
    expect(c.FEATURE_CITIZEN_STREAM).toBe('on');
  });

  it('rejects an invalid Live-Views flag value (fail-fast)', () => {
    expect(() => loadConfig({ FEATURE_CITIZEN_STREAM: 'maybe' })).toThrow(/FEATURE_CITIZEN_STREAM/);
  });

  // ── DRILL mode + its browser mirror (MW-D/D4; ADR-034 §7, F-32) ────────────────────────────────────
  it('defaults DRILL_MODE and its browser mirror to off', () => {
    const c = loadConfig({});
    expect(c.DRILL_MODE).toBe('off');
    expect(c.NEXT_PUBLIC_DRILL_MODE).toBe('off');
  });

  it('accepts drill mode when the server flag and its browser mirror agree', () => {
    const c = loadConfig({ DRILL_MODE: 'on', NEXT_PUBLIC_DRILL_MODE: 'on' });
    expect(c.DRILL_MODE).toBe('on');
    expect(c.NEXT_PUBLIC_DRILL_MODE).toBe('on');
  });

  it('REFUSES TO BOOT when the browser mirror disagrees with the server flag', () => {
    // An exercise whose UI forgot to say "EXERCISE" is precisely the failure FOP-4 exists to prevent, so
    // the mismatch is a boot error rather than an inert declaration (the F-32 defect class).
    expect(() => loadConfig({ DRILL_MODE: 'on' })).toThrow(/NEXT_PUBLIC_DRILL_MODE/);
    expect(() => loadConfig({ NEXT_PUBLIC_DRILL_MODE: 'on' })).toThrow(/NEXT_PUBLIC_DRILL_MODE/);
  });

  it('rejects an invalid drill-mode value (fail-fast, both variables)', () => {
    expect(() => loadConfig({ DRILL_MODE: 'exercise' })).toThrow(/DRILL_MODE/);
    expect(() => loadConfig({ NEXT_PUBLIC_DRILL_MODE: 'exercise' })).toThrow(
      /NEXT_PUBLIC_DRILL_MODE/,
    );
  });

  // ── D4/D6 browser mirrors + their parity refine (F-173, ADR-035 §4) ────────────────────────────────
  // The ten server flags this suite exercises — kept as a literal list HERE (a test asserting a contract
  // may re-state it; the production code under test may not, which is exactly what
  // D4_D6_BROWSER_MIRRORED_FLAGS in src/config/index.ts derives from instead of re-declaring).
  const D4_D6_FLAGS = [
    'FEATURE_D4_RUMOR_BOARD',
    'FEATURE_D4_MUTUAL_AID',
    'FEATURE_D4_SHELTER_STATUS',
    'FEATURE_D4_DAMAGE_REPORTS',
    'FEATURE_D4_EMS_OVERLAY',
    'FEATURE_D6_VOLUNTEER_TEAMS',
    'FEATURE_D6_SUPPLIES',
    'FEATURE_D6_REUNIFICATION_LINKS',
    'FEATURE_D6_INCIDENT_EXPORT',
    'FEATURE_D6_CASUALTY_TALLY',
  ] as const;

  it('defaults all ten D4/D6 flags AND their browser mirrors to on (F-170/F-193 resolution)', () => {
    const c = loadConfig({}) as unknown as Record<string, unknown>;
    for (const flag of D4_D6_FLAGS) {
      expect(c[flag]).toBe('on');
      expect(c[`NEXT_PUBLIC_${flag}`]).toBe('on');
    }
  });

  it.each(D4_D6_FLAGS)(
    'accepts %s when the server flag and its browser mirror agree (both off)',
    (flag) => {
      const mirror = `NEXT_PUBLIC_${flag}`;
      const c = loadConfig({ [flag]: 'off', [mirror]: 'off' }) as unknown as Record<
        string,
        unknown
      >;
      expect(c[flag]).toBe('off');
      expect(c[mirror]).toBe('off');
    },
  );

  // PLANT/FAIL/REVERT (per the task's proof requirement): for every one of the ten flags, planting a
  // disagreement between the server flag and its mirror must fail boot with a message naming the offending
  // mirror — proving the refine actually fires or empty coverage would silently prove nothing.
  it.each(D4_D6_FLAGS)(
    'REFUSES TO BOOT when %s and its browser mirror disagree (plant: mirror off, server on)',
    (flag) => {
      const mirror = `NEXT_PUBLIC_${flag}`;
      // Server flag stays at its default 'on'; only the mirror is planted to 'off' — a disagreement.
      expect(() => loadConfig({ [mirror]: 'off' })).toThrow(new RegExp(mirror));
    },
  );

  it.each(D4_D6_FLAGS)(
    'REFUSES TO BOOT when %s and its browser mirror EXPLICITLY disagree (plant: server off, mirror on)',
    (flag) => {
      const mirror = `NEXT_PUBLIC_${flag}`;
      // Both are set, to two different values — the operator has genuinely said two contradictory things,
      // which is the ONLY case the parity guard should reject. Setting just one of them is covered below.
      expect(() => loadConfig({ [flag]: 'off', [mirror]: 'on' })).toThrow(new RegExp(mirror));
    },
  );

  // F-240. Setting ONLY the server flag must BOOT, with the mirror inheriting it. This is the fix for a real
  // operational trap: the mirrors originally carried their own independent default, so turning one feature
  // off required setting TWO env vars and getting it wrong did not degrade — it refused to boot. The scenario
  // that makes that unacceptable is concrete: the entrant disables FEATURE_D6_REUNIFICATION_LINKS because the
  // F-177 URLs did not verify, and the app dies at startup — during a filmed demo, on the flag most likely to
  // be switched off under time pressure. Agreement is now the DEFAULT rather than the operator's homework;
  // the guard above still fails an explicit contradiction, which is the only real disagreement.
  it.each(D4_D6_FLAGS)(
    'BOOTS when only %s is set — its browser mirror INHERITS it (F-240)',
    (flag) => {
      const mirror = `NEXT_PUBLIC_${flag}` as keyof ReturnType<typeof loadConfig>;
      const env = loadConfig({ [flag]: 'off' });
      expect(env[flag as keyof typeof env]).toBe('off');
      expect(env[mirror], `${mirror} must inherit ${flag}`).toBe('off');
    },
  );

  it('reports every offending mirror at once when several D4/D6 flags disagree simultaneously', () => {
    // Two independent plants in one boot attempt — the refine must not stop at the first mismatch.
    try {
      loadConfig({
        NEXT_PUBLIC_FEATURE_D4_RUMOR_BOARD: 'off',
        NEXT_PUBLIC_FEATURE_D6_CASUALTY_TALLY: 'off',
      });
      throw new Error('expected loadConfig to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/NEXT_PUBLIC_FEATURE_D4_RUMOR_BOARD/);
      expect(message).toMatch(/NEXT_PUBLIC_FEATURE_D6_CASUALTY_TALLY/);
    }
  });

  it.each(D4_D6_FLAGS)(
    'rejects an unknown VALUE for %s (fail-fast, not a silent downgrade)',
    (flag) => {
      expect(() => loadConfig({ [flag]: 'maybe' })).toThrow(new RegExp(flag));
    },
  );

  it.each(D4_D6_FLAGS)('rejects an unknown VALUE for the %s browser mirror (fail-fast)', (flag) => {
    const mirror = `NEXT_PUBLIC_${flag}`;
    expect(() => loadConfig({ [mirror]: 'maybe' })).toThrow(new RegExp(mirror));
  });
});

// ── V2·A7 — the EM-only DB-admin link (ADR-040) ───────────────────────────────────────────────────────
// The variable itself is trivial; what these lock down is that it stays SERVER-side and stays validated.
describe('loadConfig — DB_ADMIN_URL (A7, ADR-040)', () => {
  it('is absent by default — a deployment with no admin console configures nothing', () => {
    expect(loadConfig({}).DB_ADMIN_URL).toBeUndefined();
  });

  it('accepts a URL', () => {
    const c = loadConfig({ DB_ADMIN_URL: 'https://directus-production-6b36.up.railway.app/' });
    expect(c.DB_ADMIN_URL).toBe('https://directus-production-6b36.up.railway.app/');
  });

  it("rejects a non-URL value (fail-fast — a typo'd admin address never reaches the one role trusted to click it)", () => {
    expect(() => loadConfig({ DB_ADMIN_URL: 'directus.local' })).toThrow(/DB_ADMIN_URL/);
  });

  it('has NO NEXT_PUBLIC_ mirror — the whole point is that it is never inlined into the client bundle', () => {
    // A mirror would be build-time inlined by `next build` and shipped to every anonymous visitor, which is
    // precisely the defect A7 exists to avoid (ADR-040 §1). Declaring one must stay impossible-by-omission:
    // EnvSchema parses a NON-strict object, so an unknown key is dropped rather than surfaced.
    const c = loadConfig({ NEXT_PUBLIC_DB_ADMIN_URL: 'https://directus.example.invalid/' });
    expect('NEXT_PUBLIC_DB_ADMIN_URL' in c).toBe(false);
  });
});

// ── V2·A9 — pre-positioning constants become configuration ────────────────────────────────────────────
// Today's hardcoded values (20 km / top-5) are the DEFAULTS, so an unset environment behaves identically.
describe('loadConfig — pre-positioning tunables (A9)', () => {
  it("defaults to today's hardcoded values: 20 km radius, top-5 per category", () => {
    const c = loadConfig({});
    expect(c.PREPOSITION_RADIUS_KM).toBe(20);
    expect(c.PREPOSITION_TOP_N).toBe(5);
  });

  it('coerces and accepts operator overrides (a fractional radius is legitimate — 7.5 km)', () => {
    const c = loadConfig({ PREPOSITION_RADIUS_KM: '7.5', PREPOSITION_TOP_N: '3' });
    expect(c.PREPOSITION_RADIUS_KM).toBe(7.5);
    expect(c.PREPOSITION_TOP_N).toBe(3);
  });

  it.each([
    ['PREPOSITION_RADIUS_KM', '0'],
    ['PREPOSITION_RADIUS_KM', '-1'],
    ['PREPOSITION_RADIUS_KM', 'twenty'],
    ['PREPOSITION_TOP_N', '0'],
    ['PREPOSITION_TOP_N', '2.5'], // a cap is a count of rows, not a fraction of one
    ['PREPOSITION_TOP_N', 'five'],
  ])(
    'refuses to boot on %s=%s (fail-fast, never a silent fallback to the default)',
    (key, value) => {
      expect(() => loadConfig({ [key]: value })).toThrow(new RegExp(key));
    },
  );
});
