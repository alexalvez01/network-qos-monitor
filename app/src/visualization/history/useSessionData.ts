/**
 * Screen-level session loader for Stage 5 (ADR-9).
 *
 * The Zustand stores hold UI state only; async repository reads live here
 * so no store module ever imports the native database. Untested under
 * Jest (op-sqlite has no Node harness) — failures surface as error state,
 * never as a blank screen or a throw during render.
 */

import { useCallback, useEffect, useState } from 'react';
import { openAppDatabase } from '../../data/database';
import { MeasurementRepository } from '../../data/repository';
import type { SessionWithSamples } from '../../data/types';

export interface SessionDataState {
  loading: boolean;
  error: string | null;
  sessions: SessionWithSamples[];
  reload: () => void;
}

export function useSessionData(): SessionDataState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionWithSamples[]>([]);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setNonce(value => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const repository = new MeasurementRepository(openAppDatabase());
        await repository.init();
        const list = await repository.listSessions();
        const full: SessionWithSamples[] = [];
        for (const item of list) {
          const withSamples = await repository.getSessionWithSamples(item.id);
          if (withSamples) {
            full.push(withSamples);
          }
        }
        if (!cancelled) {
          setSessions(full);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error && err.message
              ? err.message
              : 'Could not load recorded walks.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { loading, error, sessions, reload };
}
