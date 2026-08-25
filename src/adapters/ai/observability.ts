// BEACON — observability / per-step cost attribution (E6·T-288; ADR-022/F19/CM-C24-C25/OTel-GenAI).
// Structured pino logs using OpenTelemetry GenAI semantic-convention field names. NO heavy OTel SDK
// dependency (lean stack) — a real OTLP exporter is a documented future adapter; the hash-chained
// AUDIT_EVENT trail is authoritative without it. Content capture is OFF by default (privacy sampling,
// Art. IV/VI): spans/logs carry token counts, model, tier, cost + decision metadata only — never raw text.
import { pino } from 'pino';
import type { Logger } from 'pino';
import type { ModelTier } from '@/domain/audit-event.js';

export interface GenAiUsage {
  readonly operation: string; // gen_ai.operation.name
  readonly model: string; // gen_ai.request.model
  readonly tier: ModelTier;
  readonly inputTokens: number; // gen_ai.usage.input_tokens
  readonly outputTokens: number; // gen_ai.usage.output_tokens
  readonly costUsd: number;
  readonly stage: string; // pipeline decision stage (or 'upstream')
  readonly outcome: string; // 'allow' | 'block:<stage>'
}

export interface Observability {
  aiCall(usage: GenAiUsage): void;
  decision(stage: string, status: number, reason: string): void;
}

/** Map usage to OTel GenAI conventional field names (gen_ai.usage.*, gen_ai.request.model). */
function toGenAiFields(u: GenAiUsage): Record<string, unknown> {
  return {
    'gen_ai.operation.name': u.operation,
    'gen_ai.request.model': u.model,
    'gen_ai.usage.input_tokens': u.inputTokens,
    'gen_ai.usage.output_tokens': u.outputTokens,
    gen_ai_model_tier: u.tier,
    cost_usd: u.costUsd,
    stage: u.stage,
    outcome: u.outcome,
  };
}

export function makeObservability(logger?: Logger): Observability {
  const log = logger ?? pino({ level: process.env.LOG_LEVEL ?? 'info' });
  return {
    aiCall(usage: GenAiUsage): void {
      log.info(toGenAiFields(usage), 'ai_call');
    },
    decision(stage: string, status: number, reason: string): void {
      log.info({ stage, status, reason }, 'ai_decision');
    },
  };
}
