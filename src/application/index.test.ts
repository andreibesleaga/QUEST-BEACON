// BEACON — application barrel smoke test (E5). The public import surface must actually re-export the
// use-cases the API/composition root depends on (a broken barrel is a wiring failure, not caught by tsc
// alone once `export *` is used). Cheap contract test over the aggregate.
import { describe, it, expect } from 'vitest';
import * as application from './index.js';

describe('src/application barrel', () => {
  it('re-exports the deterministic engine + AI-orchestration use-cases', () => {
    for (const name of [
      'computeExposures',
      'rankPriorities',
      'evaluateRule',
      'projectFireCone',
      'classifyTrend',
      'planEvacRoute',
      'synthesizeSitRep',
      'haversineMeters',
    ]) {
      expect(typeof (application as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
