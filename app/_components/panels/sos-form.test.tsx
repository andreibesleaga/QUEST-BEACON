// @vitest-environment happy-dom
// BEACON — SosForm tests (E8·T-375…T-377). Submit is DISABLED until consent is checked (EV4); an invalid
// field surfaces an inline aria-live error (WCAG 2.2 §3.3.7); a result shows UNVERIFIED + confidence.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useSubmitReport } = vi.hoisted(() => ({ useSubmitReport: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useSubmitReport }));

import { SosForm } from './sos-form.js';
// The REAL store (this file does not mock it), so the map-click path is exercised end-to-end.
import { useUiStore } from '../../_lib/store.js';

const mutate = vi.fn();

beforeEach(() => {
  mutate.mockReset();
  useSubmitReport.mockReturnValue({ mutate, isPending: false, data: undefined });
  useUiStore.setState({ pickedPoint: undefined });
});

describe('SosForm', () => {
  it('disables submit until the consent checkbox is checked', async () => {
    const user = userEvent.setup();
    render(<SosForm />);
    const submitBtn = screen.getByRole('button', { name: /Send SOS/ });
    expect(submitBtn).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(submitBtn).toBeEnabled();
  });

  it('shows an inline aria-live error for an invalid (too short) description', async () => {
    const user = userEvent.setup();
    render(<SosForm />);
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByLabelText('What is happening?'), 'help');
    await user.click(screen.getByRole('button', { name: /Send SOS/ }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent(/at least 10 characters/);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('submits a consented report with valid text', async () => {
    const user = userEvent.setup();
    render(<SosForm />);
    await user.click(screen.getByRole('checkbox'));
    await user.type(
      screen.getByLabelText('What is happening?'),
      'Flooding on Main Street, water rising fast.',
    );
    await user.click(screen.getByRole('button', { name: /Send SOS/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ consent: true });
  });

  it('renders UNVERIFIED + confidence components on a result', () => {
    useSubmitReport.mockReturnValue({
      mutate,
      isPending: false,
      data: { data: { id: 'r1', status: 'UNVERIFIED', confidence: { text: 0.8 } } },
    });
    render(<SosForm />);
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  // CW4 — citizen live-view field (Live Views v1.2, ADR-029; FEATURE_CITIZEN_STREAM).
  it('hides the live-stream link field by default (feature off ⇒ byte-identical form)', () => {
    render(<SosForm />);
    expect(screen.queryByTestId('live-view-field')).not.toBeInTheDocument();
  });

  it('shows the live-stream link field + consent-adjacent warning when the feature is enabled', () => {
    render(<SosForm citizenStreamEnabled />);
    expect(screen.getByTestId('live-view-field')).toBeInTheDocument();
    expect(screen.getByText(/Only link public streams you operate/i)).toBeInTheDocument();
  });

  it('submits the live-stream link when the feature is enabled and a link is entered', async () => {
    const user = userEvent.setup();
    render(<SosForm citizenStreamEnabled />);
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByLabelText('What is happening?'), 'Live feed of the fire front approaching.');
    await user.type(
      screen.getByLabelText(/Live stream link/i),
      'https://youtube.com/live/abc123',
    );
    await user.click(screen.getByRole('button', { name: /Send SOS/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      consent: true,
      liveViewUrl: 'https://youtube.com/live/abc123',
    });
  });

  it('omits liveViewUrl from the body when the field is left blank', async () => {
    const user = userEvent.setup();
    render(<SosForm citizenStreamEnabled />);
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByLabelText('What is happening?'), 'No stream, just a description here.');
    await user.click(screen.getByRole('button', { name: /Send SOS/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).not.toHaveProperty('liveViewUrl');
  });
});


// Map click → the location fields. `pickedPoint` is [lon, lat] (GeoJSON order) — these tests pin the
// axis convention at the form boundary, because a silent swap here files an SOS on the wrong continent.
describe('SosForm — location pre-filled from a map click', () => {
  it('fills lat/lon from the picked point, respecting [lon, lat] order, and stays editable', async () => {
    const user = userEvent.setup();
    render(<SosForm />);
    useUiStore.setState({ pickedPoint: [-121.58, 39.71] });
    await screen.findByDisplayValue('39.710000'); // latitude
    expect(screen.getByLabelText(/Longitude/i)).toHaveValue('-121.580000');
    // Pre-fill, never a lock: the reporter can still correct it.
    await user.clear(screen.getByLabelText(/Latitude/i));
    await user.type(screen.getByLabelText(/Latitude/i), '40.1');
    expect(screen.getByLabelText(/Latitude/i)).toHaveValue('40.1');
  });

  it('leaves the fields empty when nothing has been picked', () => {
    render(<SosForm />);
    expect(screen.getByLabelText(/Latitude/i)).toHaveValue('');
    expect(screen.getByLabelText(/Longitude/i)).toHaveValue('');
  });
});
