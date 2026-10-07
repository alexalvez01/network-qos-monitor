/**
 * Measurement store (Stage 3, ADR-9).
 *
 * The single reactive seam between the background measurement engine and
 * the presentation layer: the engine publishes MeasurementSets here, screens
 * subscribe. Layers never import each other's internals.
 */

import { create } from 'zustand';
import type { MeasurementSet } from './types';

/** Cap retained history so background sampling cannot grow memory unboundedly. */
const MAX_HISTORY = 50;

interface MeasurementStoreState {
  latest: MeasurementSet | null;
  history: MeasurementSet[];
  running: boolean;
  lastError: string | null;
  publish: (set: MeasurementSet) => void;
  setRunning: (running: boolean) => void;
  fail: (message: string) => void;
}

export const useMeasurementStore = create<MeasurementStoreState>()(set => ({
  latest: null,
  history: [],
  running: false,
  lastError: null,

  publish: measurement =>
    set(state => ({
      latest: measurement,
      history: [measurement, ...state.history].slice(0, MAX_HISTORY),
      lastError: null,
    })),

  setRunning: running => set({ running }),

  fail: message => set({ lastError: message }),
}));

/** Test-only helper: reset store state between tests. */
export function __resetMeasurementStoreForTests(): void {
  useMeasurementStore.setState({
    latest: null,
    history: [],
    running: false,
    lastError: null,
  });
}
