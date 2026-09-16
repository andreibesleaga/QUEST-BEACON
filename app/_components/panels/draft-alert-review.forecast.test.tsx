// @vitest-environment happy-dom
// BEACON — the anticipatory DRAFT shows WHY it exists and HOW FAR AHEAD (WP A8 / finding F-301).
//
// Until now the deck listed severity/category/incident and nothing else, so a viewer could see THAT an
// anticipatory DRAFT existed but not the lead time or the likelihood behind it. These tests pin the
// rendering of the server-served evidence — and, just as importantly, that nothing is rendered for a DRAFT
// that has none (Art. XVI: an unavailable figure is labelled unavailable, never invented).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ForecastEvidence } from '@/application/anticipatory/forecast-evidence.js';
import { DraftAlertReview } from './draft-alert-review.js';

const FORECAST: ForecastEvidence = {
  leadTimeHours: 18,
  expectedCrossingAt: '2026-07-06T16:00:00.000Z',
  forecastCategory: 'MODERATE',
  forecastIssuedAt: '2026-07-05T16:00:00.000Z',
  likelihoodClass: 'LIKELY',
  likelihoodRawValue: 0.72,
  likelihoodSourceField: 'exceedanceProbability',
  likelihoodMethod: 'threshold lookup over the source-published exceedance probability',
  method: 'first-order: the lead time is the number of hours the SOURCE stated',
  uncertainty: 'no confidence interval is published with these figures',
};

function renderWith(forecast?: ForecastEvidence): void {
  render(
    <DraftAlertReview
      alerts={[
        {
          id: 'ro-alert-forecast-draft-1',
          state: 'DRAFT',
          headline: 'SEVERE Met — ro-flood-demo',
          ...(forecast !== undefined ? { forecast } : {}),
        },
      ]}
    />,
  );
}

describe('DraftAlertReview — forecast evidence (F-301)', () => {
  it('shows the lead time in hours, labelled as the SOURCE’s figure', () => {
    renderWith(FORECAST);
    const leadTime = screen.getByTestId('draft-alert-lead-time');
    expect(leadTime).toHaveTextContent('18');
    // The label is what stops "18 h" from reading as a modelled arrival time.
    expect(leadTime).toHaveTextContent(/as stated by the source/i);
  });

  it('shows the likelihood WORD with the raw source value and the classifier method (FU-11)', () => {
    renderWith(FORECAST);
    const likelihood = screen.getByTestId('draft-alert-likelihood');
    expect(likelihood).toHaveTextContent('LIKELY');
    expect(likelihood).toHaveTextContent('0.72');
    expect(likelihood).toHaveTextContent('exceedanceProbability');
    expect(likelihood).toHaveTextContent(/threshold lookup/);
  });

  it('shows the forecast category, the expected crossing instant and the vintage it rests on', () => {
    renderWith(FORECAST);
    const block = screen.getByTestId('draft-alert-forecast');
    expect(block).toHaveTextContent('MODERATE');
    expect(block).toHaveTextContent(FORECAST.expectedCrossingAt);
    expect(block).toHaveTextContent(FORECAST.forecastIssuedAt);
  });

  it('states the uncertainty verbatim beside the figures (the predictions law)', () => {
    renderWith(FORECAST);
    expect(screen.getByTestId('draft-alert-forecast')).toHaveTextContent(FORECAST.uncertainty);
  });

  it('renders NOTHING for an observed DRAFT — no placeholder, no zero, no dash', () => {
    renderWith(undefined);
    expect(screen.queryByTestId('draft-alert-forecast')).not.toBeInTheDocument();
    expect(screen.queryByTestId('draft-alert-lead-time')).not.toBeInTheDocument();
    expect(screen.queryByTestId('draft-alert-likelihood')).not.toBeInTheDocument();
  });

  it('omits only the likelihood row when the source published no probability signal', () => {
    const {
      likelihoodClass,
      likelihoodRawValue,
      likelihoodSourceField,
      likelihoodMethod,
      ...bare
    } = FORECAST;
    void likelihoodClass;
    void likelihoodRawValue;
    void likelihoodSourceField;
    void likelihoodMethod;
    renderWith(bare);
    expect(screen.queryByTestId('draft-alert-likelihood')).not.toBeInTheDocument();
    // …the lead time the source DID state is still shown, still labelled.
    expect(screen.getByTestId('draft-alert-lead-time')).toHaveTextContent('18');
  });

  it('never hardcodes English in the component — every added label resolves through the catalogue', () => {
    renderWith(FORECAST);
    const block = screen.getByTestId('draft-alert-forecast');
    // A missing key renders as the raw key path in next-intl; none may appear.
    expect(block.textContent ?? '').not.toMatch(/draftAlerts\./);
  });
});
