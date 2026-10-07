/**
 * Headless background sampling for Stage 6 (RF-07, ADR-3).
 *
 * Containment matters more than convenience here. Every native module
 * (BackgroundFetch, the socket transport, op-sqlite, geolocation) is loaded
 * lazily inside functions via dynamic import — never at module scope — so
 * importing this file under Jest, or on a device with a broken native
 * side, cannot throw. Pure logic (thresholds, engine, serializers) is
 * statically imported and always safe. Nothing in this file may reject:
 * the OS throttles jobs whose finish() never arrives, so every path ends
 * at finish().
 *
 * Two entry points, both WorkManager-backed on Android:
 *
 * - `configureBackgroundFetch()` — call once from the foreground app (App
 *   effect). Registers the periodic event callback.
 * - Headless registration — kicked off at module scope below, so a
 *   WorkManager wake with the app terminated still finds its handler. It
 *   stays at import time because a terminated app runs the JS bundle
 *   without mounting React, where no effect ever fires.
 *
 * Each pass is probes-only (no throughput transfer): a headless window is
 * short and battery-attributed to the app, so the ~15-minute cadence buys
 * latency/loss/jitter history without a megabyte download each time.
 */

import { DEFAULT_PROBE_CONFIG } from '../measurement/types';
import type { TcpTransport } from '../measurement/types';
import { runHeadlessMeasurement } from '../measurement/engine';
import type { MeasurementRepository } from '../data/repository';
import type { Database } from '../data/database';
import type { GeoLocator } from '../data/geo';
import { detectDegradation } from './degradation';
import { notifyDegradation } from '../notifications/notifee';
import { useBackgroundStore } from './backgroundStore';
import type { BackgroundRunOutcome } from './backgroundStore';
import type {
  BackgroundFetchConfig,
  BackgroundFetchStatus,
  HeadlessEvent,
  NetworkType,
} from 'react-native-background-fetch';

/** Minimum WorkManager cadence the plugin allows (minutes). */
export const BACKGROUND_FETCH_INTERVAL_MINUTES = 15;
/** Single rolling session grouping every background pass. */
export const BACKGROUND_SESSION_ID = 'background';
const BACKGROUND_SESSION_NAME = 'Background sampling';

/** Structural subset of the BackgroundFetch API used here. */
interface BackgroundFetchLike {
  STATUS_AVAILABLE: BackgroundFetchStatus;
  STATUS_DENIED: BackgroundFetchStatus;
  NETWORK_TYPE_ANY: NetworkType;
  configure(
    config: BackgroundFetchConfig,
    onEvent: (taskId: string) => void,
    onTimeout?: (taskId: string) => void,
  ): Promise<BackgroundFetchStatus>;
  finish(taskId: string): void;
  registerHeadlessTask(task: (event: HeadlessEvent) => Promise<void>): void;
}

function asBackgroundFetchLike(value: unknown): BackgroundFetchLike | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<BackgroundFetchLike>;
  if (
    typeof candidate.configure !== 'function' ||
    typeof candidate.finish !== 'function' ||
    typeof candidate.registerHeadlessTask !== 'function' ||
    typeof candidate.STATUS_AVAILABLE !== 'number' ||
    typeof candidate.NETWORK_TYPE_ANY !== 'number'
  ) {
    return null;
  }
  return candidate as BackgroundFetchLike;
}

async function loadBackgroundFetch(): Promise<BackgroundFetchLike | null> {
  try {
    const module = (await import('react-native-background-fetch')) as {
      default?: unknown;
    };
    return asBackgroundFetchLike(module.default);
  } catch {
    return null;
  }
}

export interface BackgroundPassDeps {
  transport?: TcpTransport;
  repository?: MeasurementRepository;
  locator?: GeoLocator;
  notify?: (reason: string) => Promise<unknown>;
  now?: () => number;
}

export interface BackgroundPassResult {
  outcome: BackgroundRunOutcome;
  /** Degradation reason, or the failure message when outcome is failed. */
  reason: string | null;
  samplesPersisted: number;
}

/** Device implementations; each dynamic import is Jest-safe (never runs there). */
async function resolveDeps(
  overrides: BackgroundPassDeps,
): Promise<Required<BackgroundPassDeps>> {
  if (
    overrides.transport &&
    overrides.repository &&
    overrides.locator &&
    overrides.notify &&
    overrides.now
  ) {
    return overrides as Required<BackgroundPassDeps>;
  }
  const transportModule = await import('../measurement/transport');
  const { openAppDatabase } = await import('../data/database');
  const { MeasurementRepository: Repository } = await import(
    '../data/repository'
  );
  const { createSystemGeoLocator } = await import('../data/geoNative');
  const database: Database = openAppDatabase();
  return {
    transport: overrides.transport ?? transportModule.createTcpSocketTransport(),
    repository:
      overrides.repository ?? new Repository(database),
    locator: overrides.locator ?? createSystemGeoLocator(),
    notify: overrides.notify ?? notifyDegradation,
    now: overrides.now ?? Date.now,
  };
}

/**
 * One measurement pass: probe, persist under the rolling background
 * session, check thresholds, notify on degradation. Never rejects — every
 * failure is recorded in the store and returned, because the caller's
 * finally block must always reach finish().
 */
export async function runBackgroundMeasurementPass(
  overrides: BackgroundPassDeps = {},
): Promise<BackgroundPassResult> {
  const deps = await resolveDeps(overrides);
  useBackgroundStore.getState().setStatus('running');
  try {
    await deps.repository.init();
    const now = deps.now();
    const session =
      (await deps.repository.getSession(BACKGROUND_SESSION_ID)) ??
      (await deps.repository.createSession({
        id: BACKGROUND_SESSION_ID,
        startedAt: now,
        name: BACKGROUND_SESSION_NAME,
      }));

    const set = await runHeadlessMeasurement(
      deps.transport,
      { probe: DEFAULT_PROBE_CONFIG, throughput: null },
      { now: deps.now },
    );

    // A pass without a fix still counts for alerts; it just cannot be
    // persisted, because sample rows require NOT NULL coordinates.
    let samplesPersisted = 0;
    try {
      const position = await deps.locator.getCurrentPosition();
      const saved = await deps.repository.saveMeasurementSet(session.id, set, {
        position,
        networkType: null,
        timestamp: set.endedAt,
      });
      samplesPersisted = saved.length;
    } catch {
      // No fix in the headless window (denied permission, GPS cold): keep
      // the pass for detection, skip storage.
    }

    const reason = detectDegradation(set);
    const outcome: BackgroundRunOutcome = reason ? 'degraded' : 'ok';
    if (reason) {
      await deps.notify(reason);
    }
    useBackgroundStore.getState().recordRun({
      at: set.endedAt,
      outcome,
      reason,
    });
    useBackgroundStore.getState().setStatus('scheduled');
    return { outcome, reason, samplesPersisted };
  } catch (err) {
    const message =
      err instanceof Error && err.message ? err.message : String(err);
    useBackgroundStore.getState().recordRun({
      at: deps.now(),
      outcome: 'failed',
      reason: message,
    });
    useBackgroundStore.getState().setStatus('error');
    return { outcome: 'failed', reason: message, samplesPersisted: 0 };
  }
}

async function handleHeadlessEvent(event: HeadlessEvent): Promise<void> {
  const api = await loadBackgroundFetch();
  if (!api) {
    return;
  }
  if (event.timeout) {
    try {
      api.finish(event.taskId);
    } catch {
      // Native side gone; nothing left to signal.
    }
    return;
  }
  try {
    await runBackgroundMeasurementPass();
  } finally {
    try {
      api.finish(event.taskId);
    } catch {
      // Native side gone; the pass already recorded its outcome.
    }
  }
}

// Terminated-app registration. Async by necessity (see module docblock);
// a missing native side resolves to null here instead of crashing import.
// Ideal placement would be a synchronous call in index.js, which Stage 6
// may not touch — recorded as a risk.
void loadBackgroundFetch().then(api => {
  if (!api) {
    return;
  }
  try {
    api.registerHeadlessTask(handleHeadlessEvent);
  } catch {
    // Registration outside a device runtime must never crash the import.
  }
});

/**
 * Register the periodic WorkManager job. `startOnBoot: true` is guaranteed
 * by the plugin API (requires `stopOnTerminate: false` plus the
 * RECEIVE_BOOT_COMPLETED manifest permission — the permission was declared
 * in Stage 1 and stopOnTerminate is false here). iOS registers the same
 * call and the OS fires it on its own energy budget (ADR-3:
 * opportunistic, not guaranteed). Mirrors the platform status to the store;
 * never rejects.
 */
export async function configureBackgroundFetch(
  deps: BackgroundPassDeps = {},
): Promise<BackgroundFetchStatus> {
  const api = await loadBackgroundFetch();
  if (!api) {
    useBackgroundStore.getState().setStatus('error');
    return 1 as BackgroundFetchStatus;
  }
  try {
    const status = await api.configure(
      {
        minimumFetchInterval: BACKGROUND_FETCH_INTERVAL_MINUTES,
        stopOnTerminate: false,
        startOnBoot: true,
        enableHeadless: true,
        requiredNetworkType: api.NETWORK_TYPE_ANY,
      },
      async taskId => {
        try {
          await runBackgroundMeasurementPass(deps);
        } finally {
          try {
            api.finish(taskId);
          } catch {
            // Native side gone mid-pass; the outcome is already stored.
          }
        }
      },
      taskId => {
        try {
          api.finish(taskId);
        } catch {
          // Nothing left to signal.
        }
      },
    );
    useBackgroundStore.getState().setStatus(
      status === api.STATUS_AVAILABLE ? 'scheduled' : 'error',
    );
    return status;
  } catch {
    useBackgroundStore.getState().setStatus('error');
    return api.STATUS_DENIED;
  }
}
