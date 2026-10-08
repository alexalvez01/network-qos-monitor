/**
 * JS bridge for the Stage 2 native telemetry TurboModule (ADR-1, ADR-9).
 *
 * The Zustand store is the single reactive seam: this bridge performs the
 * one-shot read on start, subscribes to the two native event emitters, and
 * publishes everything through `applyNativeTelemetry()`. Screens never touch
 * the native module directly.
 *
 * Graceful degradation (R4): when the native module is absent (Jest, stale
 * build), when a read rejects (no permission, no cell info), or when an
 * event payload is malformed, the bridge yields a typed unavailable snapshot
 * instead of throwing. Missing data stays null all the way to the screen.
 */

import type {EventSubscription} from 'react-native';
import type {NativeNetworkInfo} from '../specs/NativeNetworkTelemetry';
import NativeNetworkTelemetry from '../specs/NativeNetworkTelemetry';
import {useNetworkStore} from '../store/networkStore';

export interface TelemetrySnapshot {
  networkType: string | null;
  signalDbm: number | null;
  cellIdentity: string | null;
  carrierName: string | null;
  available: boolean;
}

export const UNAVAILABLE_SNAPSHOT: TelemetrySnapshot = {
  networkType: null,
  signalDbm: null,
  cellIdentity: null,
  carrierName: null,
  available: false,
};

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function cleanDbm(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Pure mapper: raw native payload to a store-ready snapshot. */
export function mapNativeInfoToSnapshot(
  info: NativeNetworkInfo | null | undefined,
): TelemetrySnapshot {
  if (info == null) {
    return {...UNAVAILABLE_SNAPSHOT};
  }
  return {
    networkType: cleanString(info.networkType),
    signalDbm: cleanDbm(info.signalDbm),
    cellIdentity: cleanString(info.cellIdentity),
    carrierName: cleanString(info.carrierName),
    available: info.available === true,
  };
}

/**
 * One-shot read. Never throws: any failure (absent module, rejected
 * promise, malformed payload) resolves to an unavailable snapshot.
 */
export async function readNativeNetworkInfo(): Promise<TelemetrySnapshot> {
  if (NativeNetworkTelemetry == null) {
    return {...UNAVAILABLE_SNAPSHOT};
  }
  try {
    const info = await NativeNetworkTelemetry.getCurrentNetworkInfo();
    return mapNativeInfoToSnapshot(info);
  } catch {
    return {...UNAVAILABLE_SNAPSHOT};
  }
}

/** Publish a snapshot through the store seam. Exported for tests. */
export function applySnapshotToStore(snapshot: TelemetrySnapshot): void {
  useNetworkStore.getState().applyNativeTelemetry({
    subtype: snapshot.networkType,
    signalDbm: snapshot.signalDbm,
    cellIdentity: snapshot.cellIdentity,
  });
}

function isEventRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function applySignalEvent(raw: unknown) {
  if (!isEventRecord(raw)) {
    return;
  }
  const networkType = cleanString(raw.networkType);
  const signalDbm =
    raw.signalDbm === null ? null : cleanDbm(raw.signalDbm) ?? undefined;
  if (networkType == null && signalDbm === undefined) {
    return;
  }
  useNetworkStore.getState().applyNativeTelemetry({
    subtype: networkType ?? undefined,
    signalDbm,
  });
}

function applyNetworkEvent(raw: unknown) {
  if (!isEventRecord(raw)) {
    return;
  }
  const next = cleanString(raw.networkType);
  if (next != null) {
    useNetworkStore.getState().applyNativeTelemetry({subtype: next});
  }
}

/**
 * Fetch once, then stream native events into the store. Returns an
 * unsubscribe function; safe to call when the native module is absent
 * (one-shot still resolves to unavailable, no listeners are attached).
 */
export function startNativeTelemetry(): () => void {
  let cancelled = false;
  readNativeNetworkInfo().then(snapshot => {
    if (!cancelled) {
      applySnapshotToStore(snapshot);
    }
  });

  if (NativeNetworkTelemetry == null) {
    return () => {
      cancelled = true;
    };
  }

  // Codegen event emitters deliver the events; addListener/removeListeners
  // only drive the native listener refcount (platform callbacks run while
  // someone listens).
  const module = NativeNetworkTelemetry;
  const subscriptions: EventSubscription[] = [
    module.onSignalStrengthChanged(applySignalEvent),
    module.onNetworkStateChanged(applyNetworkEvent),
  ];
  module.addListener('onSignalStrengthChanged');
  return () => {
    cancelled = true;
    subscriptions.forEach(subscription => subscription.remove());
    module.removeListeners(1);
  };
}
