/**
 * Background status store for Stage 6 (ADR-9).
 *
 * The single reactive seam between the headless WorkManager task and the
 * presentation layer: the task records scheduling, runs and outcomes here;
 * screens subscribe. The store never touches engine or storage internals —
 * the task module owns those imports, so this module loads no native code.
 */

import { create } from 'zustand';

export type BackgroundTaskStatus = 'idle' | 'scheduled' | 'running' | 'error';
export type BackgroundRunOutcome = 'ok' | 'degraded' | 'failed';

interface BackgroundState {
  status: BackgroundTaskStatus;
  /** Epoch ms of the last completed pass; null before the first run. */
  lastRunAt: number | null;
  lastOutcome: BackgroundRunOutcome | null;
  /** Degradation reason or failure message from the last run. */
  lastReason: string | null;
  runsCompleted: number;
  setStatus: (status: BackgroundTaskStatus) => void;
  recordRun: (run: {
    at: number;
    outcome: BackgroundRunOutcome;
    reason: string | null;
  }) => void;
}

const INITIAL: Pick<
  BackgroundState,
  'status' | 'lastRunAt' | 'lastOutcome' | 'lastReason' | 'runsCompleted'
> = {
  status: 'idle',
  lastRunAt: null,
  lastOutcome: null,
  lastReason: null,
  runsCompleted: 0,
};

export const useBackgroundStore = create<BackgroundState>()(set => ({
  ...INITIAL,
  setStatus: status => set({ status }),
  recordRun: run =>
    set(state => ({
      lastRunAt: run.at,
      lastOutcome: run.outcome,
      lastReason: run.reason,
      runsCompleted: state.runsCompleted + 1,
    })),
}));

/** Test-only helper: reset store state between tests. */
export function __resetBackgroundStoreForTests(): void {
  useBackgroundStore.setState({ ...INITIAL });
}
