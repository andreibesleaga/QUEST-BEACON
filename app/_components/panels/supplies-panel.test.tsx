// @vitest-environment happy-dom
// BEACON — SuppliesPanel tests (S3·U1; FR-D6-2). The envelope fixture is BUILT FROM REAL GET /supplies
// OUTPUT (handleHttp as RESPONDER), so the panel's idea of the wire can never drift from it (the
// verifier-queue pattern). Covers: flag off ⇒ null AND the query told not to fire; real lots rendered with
// stock + expiry; provenance/freshness labelled; loading/error/empty all labelled (Art. XVI); a 403 role
// denial surfaces as a labelled unavailable-state, never a blank.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useSupplies } = vi.hoisted(() => ({ useSupplies: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useSupplies }));

import { SuppliesPanel } from './supplies-panel.js';
import { realGet, FIXED_CLOCK } from '../../_lib/real-http.js';
import type { Envelope, SuppliesData } from '../../_lib/types.js';

let env: Envelope<SuppliesData>;
const refetch = vi.fn();

beforeAll(async () => {
  ({ env } = await realGet<SuppliesData>('/api/v1/supplies', 'RESPONDER'));
});

/** A UseQueryResult-shaped stub — only the fields the panel reads. */
function state(
  over: Partial<{ isPending: boolean; isError: boolean; data: unknown; error: unknown }>,
): unknown {
  return { isPending: false, isError: false, data: undefined, error: undefined, refetch, ...over };
}

beforeEach(() => {
  refetch.mockReset();
  useSupplies.mockReturnValue(state({ data: env }));
});

describe('SuppliesPanel (over real GET /supplies output)', () => {
  it('renders NULL when the display gate is off — and the query is told not to fire (Art. XVI)', () => {
    const { container } = render(<SuppliesPanel enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(useSupplies).toHaveBeenCalledWith(false);
  });

  it('renders every real supply lot with its stock count and unit token', () => {
    render(<SuppliesPanel enabled />);
    for (const lot of env.data.supplies) {
      expect(screen.getByTestId(`supply-${lot.id}`)).toBeInTheDocument();
    }
    // The water lot: 4800 LITRE, verbatim off the envelope (Art. XII — nothing recomputed).
    const water = screen.getByTestId('supply-supply-water-1l');
    expect(water).toHaveTextContent('4800');
    expect(water).toHaveTextContent('LITRE');
  });

  it('renders the expiry for a lot that carries one, and no expiry line for one that does not', () => {
    render(<SuppliesPanel enabled />);
    expect(screen.getByTestId('supply-expiry-supply-water-1l')).toHaveTextContent('2026-07-01');
    expect(screen.queryByTestId('supply-expiry-supply-blankets')).not.toBeInTheDocument();
  });

  it('labels provenance and freshness (F1 made legible)', () => {
    render(<SuppliesPanel enabled />);
    expect(screen.getByText('Provenance')).toBeInTheDocument();
    expect(screen.getByTestId('supplies-freshness')).toHaveTextContent(FIXED_CLOCK);
  });

  it('renders a labelled loading state while pending', () => {
    useSupplies.mockReturnValue(state({ isPending: true }));
    render(<SuppliesPanel enabled />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('surfaces a 403 role denial as a labelled, retryable unavailable-state — never a dead-end', async () => {
    const user = userEvent.setup();
    useSupplies.mockReturnValue(
      state({ isError: true, error: { message: 'GET /supplies requires RESPONDER+' } }),
    );
    render(<SuppliesPanel enabled />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Supplies unavailable');
    expect(alert).toHaveTextContent('GET /supplies requires RESPONDER+');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a designed empty state when the server has no lots', () => {
    useSupplies.mockReturnValue(state({ data: { ...env, data: { supplies: [] } } }));
    render(<SuppliesPanel enabled />);
    expect(screen.getByText('No supply lots')).toBeInTheDocument();
  });
});

// Malformed-envelope guard (added 2026-08-08): a 200 whose data lacks the expected field must land on the
// LABELLED error rung — the COP page test's fallback envelope crashed the page tree through an unguarded
// read in one of these panels; this pins the guard in each.
describe('malformed envelope shape', () => {
  it('renders the labelled unavailable state, never throws, when data is an empty object', () => {
    useSupplies.mockReturnValue(
      state({ data: { data: {}, provenance: [], freshness: undefined } }),
    );
    render(<SuppliesPanel enabled />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
