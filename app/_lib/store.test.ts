// BEACON — Zustand UI store transitions (E8·T-351). Pure state-machine assertions, no DOM needed.
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, DEFAULT_REGION_ID } from './store.js';

// Reset to the store's initial snapshot before each test (Zustand is a module singleton).
const initial = useUiStore.getState();
beforeEach(() => {
  useUiStore.setState(initial, true);
});

describe('useUiStore', () => {
  it('starts with sensible crisis defaults', () => {
    const s = useUiStore.getState();
    expect(s.activeRegionId).toBe(DEFAULT_REGION_ID);
    expect(s.selectedIncidentId).toBeUndefined();
    expect(s.theme).toBe('dark');
    expect(s.actorRole).toBe('PUBLIC');
    expect(s.layers.fire).toBe(true);
    expect(s.layers.outage).toBe(false);
  });

  it('toggleLayer flips a single layer flag', () => {
    expect(useUiStore.getState().layers.outage).toBe(false);
    useUiStore.getState().toggleLayer('outage');
    expect(useUiStore.getState().layers.outage).toBe(true);
    useUiStore.getState().toggleLayer('outage');
    expect(useUiStore.getState().layers.outage).toBe(false);
    // Untouched layers are unaffected.
    expect(useUiStore.getState().layers.fire).toBe(true);
  });

  it('setRegion updates the region and clears the incident selection', () => {
    useUiStore.getState().selectIncident('inc-1');
    expect(useUiStore.getState().selectedIncidentId).toBe('inc-1');
    useUiStore.getState().setRegion('socal');
    expect(useUiStore.getState().activeRegionId).toBe('socal');
    expect(useUiStore.getState().selectedIncidentId).toBeUndefined();
  });

  it('selectIncident sets and clears the selected incident', () => {
    useUiStore.getState().selectIncident('inc-42');
    expect(useUiStore.getState().selectedIncidentId).toBe('inc-42');
    useUiStore.getState().selectIncident();
    expect(useUiStore.getState().selectedIncidentId).toBeUndefined();
  });

  it('setRole and setTheme transition their fields', () => {
    useUiStore.getState().setRole('RESPONDER');
    useUiStore.getState().setTheme('light');
    const s = useUiStore.getState();
    expect(s.actorRole).toBe('RESPONDER');
    expect(s.theme).toBe('light');
  });

  it('authToken defaults to undefined and setAuthToken sets/clears the bearer', () => {
    expect(useUiStore.getState().authToken).toBeUndefined();
    useUiStore.getState().setAuthToken('jwt-abc');
    expect(useUiStore.getState().authToken).toBe('jwt-abc');
    useUiStore.getState().setAuthToken(undefined);
    expect(useUiStore.getState().authToken).toBeUndefined();
  });
});
