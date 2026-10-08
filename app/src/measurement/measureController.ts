/**
 * Foreground measurement controller: manual passes, auto-repeat and walk
 * lifecycle. Lives outside React so an auto-repeating walk keeps running
 * while the user switches tabs (screens unmount, this module does not).
 *
 * Native modules (socket transport, op-sqlite, geolocation) are resolved
 * lazily through dynamic imports, the same containment rule as the
 * background task: importing this file under Jest loads nothing native.
 * Nothing here rejects — failures land in the stores for the UI to show.
 */

import { create } from 'zustand';
import type { MeasurementRepository } from '../data/repository';
import type { GeoLocator } from '../data/geo';
import { useNetworkStore } from '../store/networkStore';
import { detectDegradation } from '../background/degradation';
import { notifyDegradation } from '../notifications/notifee';
import { networkTypeLabel, runForegroundPass } from './foregroundPass';
import type { RadioSnapshot } from './foregroundPass';
import { buildEngineConfig, settingsProblems, useSettingsStore } from './settingsStore';
import type { TcpTransport } from './types';
import { defaultWalkName, useWalkStore } from './walkStore';

interface ControllerState {
  running: boolean;
  auto: boolean;
  /** Epoch ms of the next scheduled auto pass; null when idle. */
  nextRunAt: number | null;
  error: string | null;
  lastAlert: string | null;
}

export const useMeasureController = create<ControllerState>()(() => ({
  running: false,
  auto: false,
  nextRunAt: null,
  error: null,
  lastAlert: null,
}));

interface DeviceDeps {
  transport: TcpTransport;
  repository: MeasurementRepository;
  locator: GeoLocator;
}

let device: DeviceDeps | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;

async function deviceDeps(): Promise<DeviceDeps> {
  if (device) {
    return device;
  }
  const { createTcpSocketTransport } = await import('./transport');
  const { openAppDatabase } = await import('../data/database');
  const { MeasurementRepository: Repository } = await import('../data/repository');
  const { createCachedSystemGeoLocator } = await import('../data/geoNative');
  const repository = new Repository(openAppDatabase());
  await repository.init();
  device = {
    transport: createTcpSocketTransport(),
    repository,
    locator: createCachedSystemGeoLocator({ maxAgeMs: 5000 }),
  };
  return device;
}

function radioSnapshot(): RadioSnapshot {
  const state = useNetworkStore.getState();
  return {
    networkType: networkTypeLabel(state),
    signalDbm: state.signalDbm,
  };
}

function message(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

/** Run one pass now (no-op while a pass is already in flight). */
export async function runPassNow(): Promise<void> {
  if (useMeasureController.getState().running) {
    return;
  }
  const settings = useSettingsStore.getState().settings;
  const problems = settingsProblems(settings);
  if (problems.length > 0) {
    useMeasureController.setState({ error: problems[0] ?? 'Invalid settings' });
    return;
  }
  useMeasureController.setState({ running: true, error: null });
  try {
    const deps = await deviceDeps();
    const walk = useWalkStore.getState().walk;
    const result = await runForegroundPass(buildEngineConfig(settings), {
      transport: deps.transport,
      repository: walk ? deps.repository : null,
      sessionId: walk?.id ?? null,
      locator: deps.locator,
      radio: radioSnapshot,
    });
    useWalkStore.getState().recordPass(
      result.save,
      result.position
        ? {
            latitude: result.position.latitude,
            longitude: result.position.longitude,
            accuracy: result.position.accuracy,
          }
        : null,
    );
    const alert = detectDegradation(result.set);
    useMeasureController.setState({ lastAlert: alert });
    if (alert) {
      await notifyDegradation(alert);
    }
  } catch (err) {
    useMeasureController.setState({ error: message(err) });
  } finally {
    useMeasureController.setState({ running: false });
  }
}

function scheduleNext(): void {
  const { auto } = useMeasureController.getState();
  if (!auto) {
    return;
  }
  const delayMs = useSettingsStore.getState().settings.autoIntervalSec * 1000;
  useMeasureController.setState({ nextRunAt: Date.now() + delayMs });
  autoTimer = setTimeout(async () => {
    autoTimer = null;
    await runPassNow();
    scheduleNext();
  }, delayMs);
}

/** Start auto-repeat: one pass immediately, then every interval. */
export async function startAuto(): Promise<void> {
  if (useMeasureController.getState().auto) {
    return;
  }
  useMeasureController.setState({ auto: true });
  await runPassNow();
  scheduleNext();
}

export function stopAuto(): void {
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  useMeasureController.setState({ auto: false, nextRunAt: null });
}

/** Ask for location, open a session row, and make it the active walk. */
export async function startWalk(name?: string): Promise<void> {
  try {
    const { ensureLocationPermission } = await import('../data/geoNative');
    await ensureLocationPermission();
    const deps = await deviceDeps();
    const startedAt = Date.now();
    const walkName = name && name.trim().length > 0 ? name.trim() : defaultWalkName(startedAt);
    const session = await deps.repository.createSession({ startedAt, name: walkName });
    useWalkStore.getState().start({ id: session.id, name: walkName, startedAt });
    useMeasureController.setState({ error: null });
  } catch (err) {
    useMeasureController.setState({ error: message(err) });
  }
}

export async function endWalk(): Promise<void> {
  stopAuto();
  const walk = useWalkStore.getState().walk;
  if (!walk) {
    return;
  }
  try {
    const deps = await deviceDeps();
    await deps.repository.endSession(walk.id, Date.now());
  } catch (err) {
    useMeasureController.setState({ error: message(err) });
  } finally {
    useWalkStore.getState().end();
  }
}
