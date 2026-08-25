// BEACON — outbound NotificationPort (E10·T-458/T-459; Art. XIV responsible-data, ADR-017). A PUBLIC
// broadcast surface, so it must NOT forward PII (Art. XIV): every outbound text is REDACTED for emails,
// phone numbers, and precise lat/lng PAIRS before it can leave. It deliberately does NOT alter lone
// engine figures (confidence/discharge/wind…) — those are cited deterministic facts (Art. XII), so a
// blanket "round every decimal" pass would corrupt them. The redacted text then passes the OUTPUT firewall
// (reused scanInjection), and every send is appended to a hash-chained audit log (the AuditChain concept,
// kept lightweight here). Delivery is delegated to an injected MessagingPort. node:crypto is allowed here.
import { createHash } from 'node:crypto';
import type { Result } from '@/domain/shared/result.js';
import { err } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { Envelope, MessagingPort, NotificationPort } from '@/ports/interaction.js';
import { scanInjection } from '@/adapters/compliance/index.js';

/** One audited outbound send. `entryHash` chains to the previous record (tamper-evident, like AuditChain). */
export interface AuditRecord {
  readonly seq: number;
  readonly at: string; // ISO-8601 (injected clock)
  readonly audience: string;
  readonly textHash: string; // sha256 of the generalized text (content redacted from the log, Art. IV)
  readonly entryHash: string; // sha256(prevHash + textHash + at)
  readonly kind: 'notify';
}

export interface NotificationDeps {
  readonly transport: MessagingPort;
  readonly clock: () => string;
  readonly audit: AuditRecord[]; // in-memory audit list (appended to on every send)
}

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/**
 * Redact PII a public broadcast must never carry (Art. XIV): emails, phone numbers, and precise lat/lng
 * PAIRS. Lone engine figures (confidence 0.85, discharge 12.47 m³/s, winds 25 km/h) are left untouched —
 * they are cited deterministic facts (Art. XII). This is a text-level safety net over whatever renders.
 * Order matters: emails → coordinate-pairs → phones (so a redacted pair can't re-match the phone pattern).
 */
function redactPii(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]')
    .replace(/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, '[redacted-location]')
    .replace(/\+\d{7,15}/g, '[redacted-phone]')
    .replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, '[redacted-phone]');
}

/** Build the public notification text from an envelope's human-readable fields + a provenance footer. */
function notificationText(envelope: Envelope): string {
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  const body = ['headline', 'summary', 'text', 'message']
    .map((k) => (typeof data[k] === 'string' ? (data[k] as string) : ''))
    .filter((s) => s.length > 0)
    .join(' ');
  const sources = envelope.provenance.map((p) => p.sourceId).join(', ');
  const footer = sources.length > 0 ? `\nsources: ${sources}` : '';
  return `${body}${footer}`.trim();
}

function appendAudit(deps: NotificationDeps, audience: string, text: string): void {
  const at = deps.clock();
  const prevHash = deps.audit.at(-1)?.entryHash ?? 'GENESIS';
  const textHash = sha256(text);
  deps.audit.push({
    seq: deps.audit.length,
    at,
    audience,
    textHash,
    entryHash: sha256(`${prevHash}${textHash}${at}`),
    kind: 'notify',
  });
}

/** Build a NotificationPort that generalizes geometry, output-firewalls, audits, then delivers. */
export function makeNotifier(deps: NotificationDeps): NotificationPort {
  return {
    async notify(audience: string, envelope: Envelope): Promise<Result<void, DomainError>> {
      const text = redactPii(notificationText(envelope));
      const hit = scanInjection(text);
      if (hit) {
        return err(new DomainError('INVARIANT_VIOLATION', `output firewall blocked notification (${hit.kind})`));
      }
      appendAudit(deps, audience, text); // audit BEFORE send — the intent to broadcast is the audited event
      return deps.transport.send(audience, text);
    },
  };
}
