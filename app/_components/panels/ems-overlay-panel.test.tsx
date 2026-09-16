// @vitest-environment happy-dom
// BEACON — EmsOverlayPanel tests (S3·U2; FR-D4-5/FEV-24, ADR-027/028). The envelope fixture is BUILT FROM
// REAL GET /ems-overlay OUTPUT (handleHttp as RESPONDER, fixed clock — the verifier-queue pattern). The
// load-bearing assertions: every product renders its mandatory production label VERBATIM (attributed +
// dated, FEV-24), the link-out is link-ONLY (target=_blank rel=noopener noreferrer, never embedded), the
// future-dated fixture product is listed under "Not shown" with its reason (never silently mis-aged), and
// the attribution + consume-only caveat render. Plus flag/loading/error/empty rungs (Art. XVI).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useEmsOverlay } = vi.hoisted(() => ({ useEmsOverlay: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useEmsOverlay }));

import { EmsOverlayPanel } from './ems-overlay-panel.js';
import { realGet, FIXED_CLOCK } from '../../_lib/real-http.js';
import type { Envelope, EmsOverlayData } from '../../_lib/types.js';

let env: Envelope<EmsOverlayData>;
const refetch = vi.fn();

beforeAll(async () => {
  ({ env } = await realGet<EmsOverlayData>('/api/v1/ems-overlay', 'RESPONDER'));
});

/** A UseQueryResult-shaped stub — only the fields the panel reads. */
function state(
  over: Partial<{ isPending: boolean; isError: boolean; data: unknown; error: unknown }>,
): unknown {
  return { isPending: false, isError: false, data: undefined, error: undefined, refetch, ...over };
}

beforeEach(() => {
  refetch.mockReset();
  useEmsOverlay.mockReturnValue(state({ data: env }));
});

describe('EmsOverlayPanel (over real GET /ems-overlay output)', () => {
  it('renders NULL when the display gate is off — and the query is told not to fire (Art. XVI)', () => {
    const { container } = render(<EmsOverlayPanel enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(useEmsOverlay).toHaveBeenCalledWith(false);
  });

  it('renders every renderable product with its ATTRIBUTED, DATED production label verbatim (FEV-24)', () => {
    render(<EmsOverlayPanel enabled />);
    for (const product of env.data.overlay.products) {
      expect(screen.getByTestId(`ems-product-${product.productId}`)).toBeInTheDocument();
      const label = screen.getByTestId(`ems-label-${product.productId}`);
      expect(label).toHaveTextContent(product.provider);
      expect(label).toHaveTextContent(product.producedAt);
    }
  });

  it('links out to the producer page and NEVER embeds — target=_blank rel=noopener noreferrer', () => {
    render(<EmsOverlayPanel enabled />);
    const first = env.data.overlay.products[0]!;
    const link = screen.getByTestId(`ems-link-${first.productId}`);
    expect(link).toHaveAttribute('href', first.viewUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // Link-only doctrine: no iframe/img of the product anywhere.
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('lists the future-dated product under "Not shown" with its reason token — never a negative age', () => {
    render(<EmsOverlayPanel enabled />);
    const rejected = screen.getByTestId('ems-rejected');
    expect(rejected).toHaveTextContent('Not shown');
    expect(rejected).toHaveTextContent('EMSR773_AOI03_DEL_PRODUCT_r2');
    expect(rejected).toHaveTextContent('PRODUCED_AFTER_AS_OF');
    // …and the rejected product renders NO product card and NO link.
    expect(
      screen.queryByTestId('ems-product-EMSR773_AOI03_DEL_PRODUCT_r2'),
    ).not.toBeInTheDocument();
  });

  it('renders the attribution credits, the consume-only caveat verbatim, and the as-of instant', () => {
    render(<EmsOverlayPanel enabled />);
    expect(screen.getByTestId('ems-attribution')).toHaveTextContent(
      'Copernicus Emergency Management Service',
    );
    expect(screen.getByTestId('ems-caveat')).toHaveTextContent(
      'never requests a mapping activation',
    );
    expect(screen.getByTestId('ems-as-of')).toHaveTextContent(FIXED_CLOCK);
    expect(screen.getByText('Provenance')).toBeInTheDocument();
  });

  it('renders a labelled loading state while pending', () => {
    useEmsOverlay.mockReturnValue(state({ isPending: true }));
    render(<EmsOverlayPanel enabled />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('surfaces a 403 role denial as a labelled, retryable unavailable-state — never a dead-end', async () => {
    const user = userEvent.setup();
    useEmsOverlay.mockReturnValue(
      state({ isError: true, error: { message: 'GET /ems-overlay requires RESPONDER+' } }),
    );
    render(<EmsOverlayPanel enabled />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('EMS overlay unavailable');
    expect(alert).toHaveTextContent('GET /ems-overlay requires RESPONDER+');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a designed empty state when nothing is published and nothing was rejected', () => {
    const overlay = { ...env.data.overlay, products: [], rejected: [] };
    useEmsOverlay.mockReturnValue(state({ data: { ...env, data: { overlay } } }));
    render(<EmsOverlayPanel enabled />);
    expect(screen.getByText('No published products')).toBeInTheDocument();
  });
});

// Malformed-envelope guard (added 2026-08-08): a 200 whose data lacks the expected field must land on the
// LABELLED error rung — the COP page test's fallback envelope crashed the page tree through an unguarded
// read in one of these panels; this pins the guard in each.
describe('malformed envelope shape', () => {
  it('renders the labelled unavailable state, never throws, when data is an empty object', () => {
    useEmsOverlay.mockReturnValue(
      state({ data: { data: {}, provenance: [], freshness: undefined } }),
    );
    render(<EmsOverlayPanel enabled />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
