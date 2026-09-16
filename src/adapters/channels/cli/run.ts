// BEACON — CLI run() entry (E10·T-453). The DRIVING adapter: argv in → rendered stdout + exit code out.
// It parses argv, builds the SAME wired core every channel uses (buildInteraction), stamps receivedAt
// from the injected clock (deterministic tests — never a hidden wall-clock read in the core), dispatches
// through the single InteractionPort, and renders the universal Envelope. ZERO core change (ADR-023).
//
// SECURITY (T-454, Art. XIII): this adapter drives ONLY the read/act command surface, whose sole alert
// verb is `alert:draft`. It deliberately does NOT wire an AlertSinkPort — a DRAFT alert can never be
// emitted from a channel; sending is a separate, authenticated approval step outside the channel surface.
import type { Result } from '@/domain/shared/result.js';
import { err, isOk } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { Envelope, InteractionPort, InteractionRequest } from '@/ports/interaction.js';
import { buildInteraction } from '@/main/build-core.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { parseArgs } from './parse-args.js';
import { renderHuman, renderJson } from './render.js';

/** Injected dependencies. Tests supply a FIXED clock + counter newId + empty env for full determinism. */
export interface CliDeps {
  /** ISO-8601 clock. Defaults to wall-clock — the sanctioned boundary read; the core stays injected. */
  readonly clock?: () => string;
  /** Deterministic id minter (tests inject a counter). */
  readonly newId?: (prefix: string) => string;
  /** Environment record for fail-fast config validation (tests pass `{}` for the offline default). */
  readonly env?: Record<string, string | undefined>;
  /**
   * A pre-wired InteractionPort to reuse across invocations. Supply this for a MULTI-command session
   * (e.g. report then verify) so the in-memory store persists between commands — otherwise each run()
   * builds a fresh offline core (correct for one-shot CLI use; a real multi-process CLI uses Postgres).
   */
  readonly port?: InteractionPort;
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
}

/** Parse → dispatch → render. Exit 0 on success; 1 on any parse or domain error (rendered uniformly). */
export async function run(argv: readonly string[], deps: CliDeps = {}): Promise<CliResult> {
  const json = argv.includes('--json');
  const clock = deps.clock ?? (() => new Date().toISOString());

  const parsed = parseArgs(argv);
  if (!parsed.ok) return render(errorEnvelope(parsed.error), json, 1);

  const port =
    deps.port ??
    buildInteraction({
      clock,
      ...(deps.newId ? { newId: deps.newId } : {}),
      ...(deps.env ? { env: deps.env } : {}),
    });
  const request: InteractionRequest = {
    channel: 'cli',
    actorRole: parsed.value.actorRole,
    command: parsed.value.command,
    receivedAt: clock(),
  };

  const result = await safeHandle(port, request);
  if (isOk(result)) return render(result.value, json, 0);
  return render(errorEnvelope(result.error), json, 1);
}

/** Dispatch, converting any thrown domain guard (e.g. an illegal report transition) into a typed error. */
async function safeHandle(
  port: InteractionPort,
  request: InteractionRequest,
): Promise<Result<Envelope, DomainError>> {
  try {
    return await port.handle(request);
  } catch (caught) {
    return err(toDomainError(caught));
  }
}

function toDomainError(caught: unknown): DomainError {
  if (caught instanceof DomainError) return caught;
  const message = caught instanceof Error ? caught.message : String(caught);
  return new DomainError('INVARIANT_VIOLATION', message);
}

function render(env: Envelope, json: boolean, exitCode: number): CliResult {
  return { exitCode, stdout: json ? renderJson(env) : renderHuman(env) };
}
