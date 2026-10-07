/**
 * Single reactive seam for Stage 5 presentation state (ADR-9).
 *
 * Screens subscribe to the quality metric, the selected session and the
 * demo overlay here. The store never reaches into engine or storage
 * internals — async repository reads stay inside screen-level hooks, so
 * this module (and its test) loads no native code.
 */

import { create } from 'zustand';
import type { QualityMetric } from './heat/heat';

export type VisualizationTab = 'status' | 'map' | 'history';

interface VisualizationState {
  tab: VisualizationTab;
  setTab: (tab: VisualizationTab) => void;
  /** Heat layer + history detail default; latency-first per ADR-2/ADR-6. */
  metric: QualityMetric;
  setMetric: (metric: QualityMetric) => void;
  selectedSessionId: string | null;
  selectSession: (id: string | null) => void;
  /** Synthetic walk overlay for emulator/demo use; always labeled as demo. */
  showDemoWalk: boolean;
  setShowDemoWalk: (show: boolean) => void;
}

const INITIAL: Pick<
  VisualizationState,
  'tab' | 'metric' | 'selectedSessionId' | 'showDemoWalk'
> = {
  tab: 'status',
  metric: 'latency',
  selectedSessionId: null,
  showDemoWalk: false,
};

export const useVisualizationStore = create<VisualizationState>()(set => ({
  ...INITIAL,
  setTab: tab => set({ tab }),
  setMetric: metric => set({ metric }),
  selectSession: id => set({ selectedSessionId: id }),
  setShowDemoWalk: show => set({ showDemoWalk: show }),
}));

/** Test-only helper: reset store state between tests. */
export function __resetVisualizationStoreForTests(): void {
  useVisualizationStore.setState({ ...INITIAL });
}
