// @vitest-environment happy-dom
// BEACON — FreshnessBadge tests (E8·T-355). Icon AND text (never colour-only); stale past cadence×2.
// Deterministic: a FIXED `now` is passed everywhere — never Date.now().
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreshnessBadge, computeFreshness } from './freshness-badge.js';

const NOW = new Date('2026-07-07T12:00:00Z').getTime();

describe('FreshnessBadge', () => {
  it('renders an icon AND text (not colour-only)', () => {
    const { container } = render(
      <FreshnessBadge fetchedAt={NOW - 10_000} mode="LIVE" cadenceSec={60} now={NOW} />,
    );
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('10s ago')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('is fresh when a LIVE source is within cadence', () => {
    render(<FreshnessBadge fetchedAt={NOW - 30_000} mode="LIVE" cadenceSec={60} now={NOW} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('is stale when age exceeds cadence×2', () => {
    render(<FreshnessBadge fetchedAt={NOW - 200_000} mode="LIVE" cadenceSec={60} now={NOW} />);
    // 200s age > 120s (60×2) → stale
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('marks a CACHED source stale even within cadence', () => {
    render(<FreshnessBadge fetchedAt={NOW - 5_000} mode="CACHED" cadenceSec={60} now={NOW} />);
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('marks a MOCK source unavailable', () => {
    render(<FreshnessBadge fetchedAt={NOW - 5_000} mode="MOCK" now={NOW} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('shows Unavailable with no time when fetchedAt is null', () => {
    render(<FreshnessBadge fetchedAt={null} mode="LIVE" now={NOW} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
  });
});

describe('computeFreshness', () => {
  it('classifies exactly at the cadence×2 boundary as fresh (not > threshold)', () => {
    expect(computeFreshness(NOW - 120_000, 'LIVE', 60, NOW)).toBe('fresh');
    expect(computeFreshness(NOW - 120_001, 'LIVE', 60, NOW)).toBe('stale');
  });
});
