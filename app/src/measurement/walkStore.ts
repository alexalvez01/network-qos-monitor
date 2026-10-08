/**
 * Active walk (recording session) state, ADR-9 seam.
 *
 * A walk groups the foreground passes taken while the user moves around;
 * History lists walks and the map paints their samples. The store holds
 * only UI state — the session row itself lives in SQLite.
 */

import { create } from 'zustand';
import type { SaveOutcome } from './foregroundPass';

export interface ActiveWalk {
  id: string;
  name: string;
  startedAt: number;
}

interface WalkState {
  walk: ActiveWalk | null;
  passesSaved: number;
  lastSave: SaveOutcome | null;
  lastPosition: { latitude: number; longitude: number; accuracy: number | null } | null;
  start: (walk: ActiveWalk) => void;
  end: () => void;
  recordPass: (
    save: SaveOutcome,
    position: WalkState['lastPosition'],
  ) => void;
}

export const useWalkStore = create<WalkState>()(set => ({
  walk: null,
  passesSaved: 0,
  lastSave: null,
  lastPosition: null,
  start: walk => set({ walk, passesSaved: 0, lastSave: null }),
  end: () => set({ walk: null }),
  recordPass: (save, position) =>
    set(state => ({
      lastSave: save,
      lastPosition: position ?? state.lastPosition,
      passesSaved: state.passesSaved + (save.status === 'saved' ? 1 : 0),
    })),
}));

/** Default walk name, e.g. "Walk 07/10 21:30". */
export function defaultWalkName(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Walk ${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Test-only helper: reset store state between tests. */
export function __resetWalkStoreForTests(): void {
  useWalkStore.setState({
    walk: null,
    passesSaved: 0,
    lastSave: null,
    lastPosition: null,
  });
}
