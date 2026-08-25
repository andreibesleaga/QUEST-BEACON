// BEACON — hash-chained audit writer tests (E6·T-275/T-276; ADR-022/CM-C23).
import { describe, expect, it } from 'vitest';
import { verifyAuditLink } from '@/domain/audit-event.js';
import { makeAuditChain } from './audit-chain.js';

describe('AuditChain — append-only hash chain', () => {
  it('links each event to its predecessor and verifies clean', () => {
    const chain = makeAuditChain();
    chain.append({ action: 'ai_call', target: 'llm.narrate', costUsd: 0.001, modelTier: 'CLOUD' });
    chain.append({ action: 'ai_call', target: 'llm.narrate', costUsd: 0.002, modelTier: 'CLOUD' });
    const events = chain.events;
    expect(events[0]?.prevHash).toBeUndefined(); // genesis
    expect(events[1]?.prevHash).toBe(events[0]?.hash);
    expect(chain.verify()).toBe(true);
  });

  it('detects a tampered link (verify fails on a broken chain)', () => {
    const chain = makeAuditChain();
    const genesis = chain.append({ action: 'ai_call', target: 't', costUsd: 0.001 });
    // A forged successor whose prevHash does not match breaks verification.
    const forged = { ...genesis, prevHash: 'deadbeef', hash: genesis.hash };
    expect(verifyAuditLink(forged, undefined)).toBe(false);
  });

  it('sums per-incident cost for the budget guard (D-29)', () => {
    const chain = makeAuditChain();
    chain.append({ action: 'ai_call', target: 'incident:inc-1:llm', costUsd: 0.4, incidentId: 'inc-1' });
    chain.append({ action: 'ai_call', target: 'incident:inc-1:llm', costUsd: 0.3, incidentId: 'inc-1' });
    chain.append({ action: 'ai_call', target: 'incident:inc-2:llm', costUsd: 1.0, incidentId: 'inc-2' });
    expect(chain.spentForIncident('inc-1')).toBeCloseTo(0.7, 6);
    expect(chain.spentForIncident('inc-2')).toBeCloseTo(1.0, 6);
  });
});
