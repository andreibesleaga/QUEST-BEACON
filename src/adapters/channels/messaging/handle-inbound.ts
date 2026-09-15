// BEACON — messaging inbound orchestration (E10·T-455…T-459; ADR-023). Ties the channel together:
//   mapInbound (trust) → InteractionPort.handle (the SAME core every channel uses) → render a short text
//   digest of the Envelope (freshness + citations for a sitrep) → OUTPUT firewall → reply.
// On ANY Err the reply is a safe, errorEnvelope-derived message — never a stack trace or dead-end. The
// core is untouched: this is a driving adapter that maps to/from the universal Envelope only.
import type { DomainError } from '@/domain/errors.js';
import { DomainError as DomainErr } from '@/domain/errors.js';
import type { Command, Envelope, InboundMessage, InteractionPort } from '@/ports/interaction.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { scanInjection } from '@/adapters/compliance/index.js';
import { mapInbound } from './trust.js';
import type { InboundDeps } from './trust.js';
import { digestChromeFor } from './digest-i18n.js';
import type { DigestChrome } from './digest-i18n.js';

export interface HandleInboundDeps {
  readonly interaction: InteractionPort;
  readonly inbound: InboundDeps;
}

export interface InboundReply {
  readonly reply: string;
  readonly envelope: Envelope | null;
}

/** Render a typed failure as a safe, user-facing reply + its errorEnvelope (structured, no internals). */
function safeReply(error: DomainError): InboundReply {
  return { reply: `[${error.code}] ${error.message}`, envelope: errorEnvelope(error) };
}

/** SitRep body: list each field's claim (deterministic facts from the engine — never LLM figures). */
function renderSitrepBody(envelope: Envelope, chrome: DigestChrome): string {
  const data = (envelope.data ?? {}) as {
    readonly trend?: string;
    readonly fields?: readonly { readonly field: string; readonly claim?: string }[];
  };
  const lines = (data.fields ?? []).map((f) => `- ${f.field}: ${f.claim ?? chrome.noClaim}`);
  const trend = data.trend !== undefined ? `${chrome.trend}: ${data.trend}` : '';
  return [trend, ...lines].filter((s) => s.length > 0).join('\n');
}

/**
 * A short text digest of an Envelope; sitrep replies carry citations + freshness (F1/F2). The CHROME
 * (labels: "trend", "citations", "sources", "freshness", "(no claim)") is resolved from the message
 * catalogs via `digestChromeFor` (ADR-030 §7, FR-I18N-2/6; A4.3b) — the ENGINE facts (field claims,
 * source ids, ISO timestamps, `command.verb`, "BEACON") are never translated (Art. XII / glossary,
 * ADR-030 §2): they are either deterministic English prose or closed-vocabulary machine tokens.
 * `locale` is the requester's preferred language (`InteractionRequest.locale`, ADR-030 Finding 5, itself
 * additive/optional); absent or unshipped ⇒ English, byte-identical to the pre-i18n hardcoded literals.
 */
export async function renderDigest(
  envelope: Envelope,
  command: Command,
  locale?: string,
): Promise<string> {
  const chrome = await digestChromeFor(locale);
  const parts: string[] = [`BEACON ${command.verb}`];
  if (command.verb === 'sitrep') parts.push(renderSitrepBody(envelope, chrome));
  if (envelope.citations !== undefined && envelope.citations.length > 0) {
    parts.push(
      `${chrome.citations}: ` +
        envelope.citations.map((c) => `${c.field}<-${c.sourceId}`).join('; '),
    );
  }
  if (envelope.provenance.length > 0) {
    parts.push(
      `${chrome.sources}: ` + envelope.provenance.map((p) => `${p.sourceId}(${p.mode})`).join(', '),
    );
  }
  if (envelope.freshness !== undefined) parts.push(`${chrome.freshness}: ${envelope.freshness}`);
  return parts.filter((s) => s.length > 0).join('\n');
}

/**
 * Full inbound round-trip for one message. Returns the reply text + the Envelope (or null-carrying
 * errorEnvelope on failure). No wall-clock or network — deterministic over injected deps.
 */
export async function handleInbound(
  msg: InboundMessage,
  deps: HandleInboundDeps,
): Promise<InboundReply> {
  const mapped = mapInbound(msg, deps.inbound);
  if (!mapped.ok) return safeReply(mapped.error);

  const res = await deps.interaction.handle(mapped.value);
  if (!res.ok) return safeReply(res.error);

  const digest = await renderDigest(res.value, mapped.value.command, mapped.value.locale);
  const hit = scanInjection(digest); // output firewall on the reply text (T-459)
  if (hit)
    return safeReply(
      new DomainErr('INVARIANT_VIOLATION', `output firewall blocked reply (${hit.kind})`),
    );

  return { reply: digest, envelope: res.value };
}
