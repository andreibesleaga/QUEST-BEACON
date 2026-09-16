// BEACON — Config resolver (E4·T-142; adapter-contract §5, ADR-012/FR-10, 12-factor). Resolves an
// adapter's mode/url/timeout/key from SOURCE_<PREFIX>_* env vars. NOTHING is hardcoded (endpoints, keys,
// modes are all env). Fails fast (CONFIG) at boot on an invalid mode or a LIVE mode missing its key.
import { SOURCE_MODES } from '@/domain/source-record.js';
import type { AdapterResult, SourceMode } from './contract.js';
import { ok, err } from './contract.js';
import { makeAdapterError } from './errors.js';

export type Env = Readonly<Record<string, string | undefined>>;

export interface SourceConfigInput {
  readonly prefix: string; // e.g. 'FIRMS' -> SOURCE_FIRMS_MODE / _URL / _TIMEOUT_MS / _INTERVAL_SEC
  readonly env?: Env;
  readonly defaultMode?: SourceMode;
  readonly defaultUrl?: string;
  readonly defaultTimeoutMs?: number;
  readonly keyEnv?: string; // env var holding the API key, e.g. 'FIRMS_MAP_KEY'
  readonly requireKeyForLive?: boolean;
}

export interface SourceConfig {
  readonly mode: SourceMode;
  readonly timeoutMs: number;
  readonly url?: string;
  readonly intervalSec?: number;
  readonly apiKey?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;

export function resolveSourceConfig(input: SourceConfigInput): AdapterResult<SourceConfig> {
  const env = input.env ?? process.env;
  const modeRes = resolveMode(env, input.prefix, input.defaultMode ?? 'MOCK');
  if (!modeRes.ok) return modeRes;
  const mode = modeRes.value;

  const apiKey = input.keyEnv ? env[input.keyEnv] : undefined;
  if (mode === 'LIVE' && input.requireKeyForLive === true && !apiKey) {
    return err(
      makeAdapterError('CONFIG', `${input.prefix}: LIVE mode requires ${input.keyEnv} to be set`, {
        retryable: false,
      }),
    );
  }
  return ok(build(env, input, mode, apiKey));
}

function resolveMode(env: Env, prefix: string, fallback: SourceMode): AdapterResult<SourceMode> {
  const raw = env[`SOURCE_${prefix}_MODE`];
  if (raw === undefined || raw === '') return ok(fallback);
  const upper = raw.toUpperCase();
  if (!(SOURCE_MODES as readonly string[]).includes(upper)) {
    return err(
      makeAdapterError('CONFIG', `SOURCE_${prefix}_MODE invalid: '${raw}' (LIVE|CACHED|MOCK)`, {
        retryable: false,
      }),
    );
  }
  return ok(upper as SourceMode);
}

function build(
  env: Env,
  input: SourceConfigInput,
  mode: SourceMode,
  apiKey?: string,
): SourceConfig {
  const url = env[`SOURCE_${input.prefix}_URL`] ?? input.defaultUrl;
  const timeoutMs =
    numEnv(env[`SOURCE_${input.prefix}_TIMEOUT_MS`], undefined) ??
    input.defaultTimeoutMs ??
    DEFAULT_TIMEOUT_MS;
  const intervalSec = numEnv(env[`SOURCE_${input.prefix}_INTERVAL_SEC`], undefined);
  return {
    mode,
    timeoutMs,
    ...(url !== undefined ? { url } : {}),
    ...(intervalSec !== undefined ? { intervalSec } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
  };
}

function numEnv(raw: string | undefined, fallback: number | undefined): number | undefined {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
