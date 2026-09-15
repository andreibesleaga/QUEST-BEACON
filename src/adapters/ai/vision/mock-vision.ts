// BEACON — deterministic in-process vision provider (E6·T-291; ADR-008/ADR-008a).
// No network; returns an advisory, confidence-scored finding per task. Mirrors the shape a real
// LiteLLM vision profile (OpenRouter/Qwen-VL, Google Gemma, local LLaVA) would return.
//
// IT READS NO PIXELS. The finding is a function of `request.task` alone — the `imageRef` is never opened, so
// a fixture handle naming a file that does not exist would still "work" here. That is fine for the offline
// rung (it is honest about being a mock) but it is exactly why nobody may read a MockVision result as
// evidence about an image, and why the live rungs resolve real bytes through `imagery/resolver.ts`.
import type { VisionFinding, VisionRequest } from '@/ports/intel.js';

export interface VisionProvider {
  readonly name: string; // gen_ai.request.model id (e.g. gemma-3-4b-it, llava)
  analyze(request: VisionRequest): Promise<VisionFinding>;
}

const LABELS: Readonly<Record<VisionRequest['task'], string>> = {
  'burn-area': 'possible burn scar',
  'flood-extent': 'possible standing water',
  'damage-severity': 'possible structural damage',
  scene: 'scene description',
};

export function makeMockVision(name = 'mock-vision', failing = false): VisionProvider {
  return {
    name,
    analyze(request: VisionRequest): Promise<VisionFinding> {
      if (failing) return Promise.reject(new Error(`vision provider ${name} unavailable`));
      // Advisory + confidence-scored; the deterministic layer thresholds this downstream (never auto-alerts).
      return Promise.resolve({
        label: LABELS[request.task],
        confidence: 0.62,
        notes: 'advisory — requires human/deterministic confirmation',
      });
    },
  };
}

/** Prefix that makes a degraded rung greppable in a finding, an audit line and a provider name alike. */
export const DEGRADED_PREFIX = 'mock-vision (degraded)';

/**
 * The LABELLED degraded rung (Art. XVI: degrade and label, never dead-end and never substitute silently).
 * When a configured cloud/local rung cannot be built or cannot answer, the ladder still returns a finding —
 * but one that SAYS it came from the offline mock and WHY, in the `notes` the operator actually reads. A
 * silent fallback to the mock is the failure mode this exists to prevent: it looks exactly like success.
 */
export function makeDegradedMockVision(reason: string): VisionProvider {
  const inner = makeMockVision(`${DEGRADED_PREFIX}: ${reason}`);
  return {
    name: inner.name,
    async analyze(request: VisionRequest): Promise<VisionFinding> {
      const finding = await inner.analyze(request);
      return {
        ...finding,
        notes: `${finding.notes} — DEGRADED RUNG: no live vision model analysed this image (${reason})`,
      };
    },
  };
}
