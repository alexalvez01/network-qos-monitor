/**
 * Network state store (Stage 1).
 *
 * Source: @react-native-community/netinfo. NetInfo already delivers the
 * active connection class on Android (WIFI / CELLULAR / …), the cellular
 * generation (2g–5g) and the Wi-Fi signal level (0–100) with no custom
 * native code — that covers most of RF-01.
 *
 * Seam for the Stage 2 Kotlin/Swift TurboModule: the store keeps `subtype`
 * (exact radio string such as LTE/NR), `signalDbm` and `cellIdentity` as
 * first-class nullable fields, but nothing fills them yet. The future native
 * module publishes through `applyNativeTelemetry()` behind the
 * `NativeTelemetryPatch` contract — no screen or selector changes needed.
 * Until then those fields stay null and the screen shows an honest
 * "not available" empty state instead of fabricated data.
 */

import { create } from 'zustand';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export type CellularGeneration = '2g' | '3g' | '4g' | '5g';

export interface NetworkSnapshot {
  /** Uppercase connection class: WIFI, CELLULAR, NONE, UNKNOWN, … */
  type: string;
  /** Exact radio string (LTE, NR, HSPA, …). Null in Stage 1. */
  subtype: string | null;
  cellularGeneration: CellularGeneration | null;
  /** Wi-Fi signal level, 0–100 (Android only). */
  strength: number | null;
  carrier: string | null;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  /** RSSI in dBm. Native-only seam, null until Stage 2. */
  signalDbm: number | null;
  /** Serving cell identity. Native-only seam, null until Stage 2. */
  cellIdentity: string | null;
  updatedAt: number | null;
  raw: NetInfoState | null;
}

/** Contract the Stage 2 native telemetry module publishes through. */
export interface NativeTelemetryPatch {
  subtype?: string | null;
  signalDbm?: number | null;
  cellIdentity?: string | null;
}

const INITIAL_SNAPSHOT: NetworkSnapshot = {
  type: 'UNKNOWN',
  subtype: null,
  cellularGeneration: null,
  strength: null,
  carrier: null,
  isConnected: null,
  isInternetReachable: null,
  signalDbm: null,
  cellIdentity: null,
  updatedAt: null,
  raw: null,
};

function isCellularGeneration(value: unknown): value is CellularGeneration {
  return value === '2g' || value === '3g' || value === '4g' || value === '5g';
}

/**
 * Pure mapper from a NetInfo state to a store snapshot. Reads `details`
 * defensively: NetInfo v12 emits `cellularGeneration`/`carrier` for
 * cellular and `strength` for Wi-Fi, but no `subtype` — that arrives with
 * the Stage 2 native module. Anything missing, blank or out of range
 * becomes null so the UI can render an empty state.
 */
export function mapNetInfoToSnapshot(state: NetInfoState): NetworkSnapshot {
  const details = (state.details ?? {}) as Record<string, unknown>;

  const rawSubtype = details.subtype;
  const subtype =
    typeof rawSubtype === 'string' && rawSubtype.length > 0
      ? rawSubtype
      : null;

  const rawStrength = details.strength;
  const strength =
    typeof rawStrength === 'number' && rawStrength >= 0 && rawStrength <= 100
      ? Math.round(rawStrength)
      : null;

  const rawCarrier = details.carrier;
  const carrier =
    typeof rawCarrier === 'string' && rawCarrier.length > 0
      ? rawCarrier
      : null;

  return {
    type: String(state.type).toUpperCase(),
    subtype,
    cellularGeneration: isCellularGeneration(details.cellularGeneration)
      ? details.cellularGeneration
      : null,
    strength,
    carrier,
    isConnected:
      typeof state.isConnected === 'boolean' ? state.isConnected : null,
    isInternetReachable:
      typeof state.isInternetReachable === 'boolean'
        ? state.isInternetReachable
        : null,
    signalDbm: null,
    cellIdentity: null,
    updatedAt: Date.now(),
    raw: state,
  };
}

interface NetworkStore extends NetworkSnapshot {
  monitoring: boolean;
  /**
   * Subscribe to NetInfo and fetch the current state once. Returns the
   * unsubscribe function; safe to call twice (the second call is a no-op
   * returning the same cleanup).
   */
  startMonitoring: () => () => void;
  stopMonitoring: () => void;
  /** Stage 2 seam: overlay native radio telemetry onto the snapshot. */
  applyNativeTelemetry: (patch: NativeTelemetryPatch) => void;
}

let unsubscribeNetInfo: (() => void) | null = null;

export const useNetworkStore = create<NetworkStore>()((set, get) => ({
  ...INITIAL_SNAPSHOT,
  monitoring: false,

  startMonitoring: () => {
    if (unsubscribeNetInfo) {
      const stop = () => get().stopMonitoring();
      return stop;
    }
    set({ monitoring: true });
    NetInfo.fetch().then(
      state => set(mapNetInfoToSnapshot(state)),
      () => set({ monitoring: get().monitoring }),
    );
    unsubscribeNetInfo = NetInfo.addEventListener(state => {
      set(mapNetInfoToSnapshot(state));
    });
    return () => get().stopMonitoring();
  },

  stopMonitoring: () => {
    if (unsubscribeNetInfo) {
      unsubscribeNetInfo();
      unsubscribeNetInfo = null;
    }
    set({ monitoring: false });
  },

  applyNativeTelemetry: patch => {
    set(state => ({
      subtype: patch.subtype !== undefined ? patch.subtype : state.subtype,
      signalDbm:
        patch.signalDbm !== undefined ? patch.signalDbm : state.signalDbm,
      cellIdentity:
        patch.cellIdentity !== undefined
          ? patch.cellIdentity
          : state.cellIdentity,
      updatedAt: Date.now(),
    }));
  },
}));

/** Test-only helper: reset the module-level subscription between tests. */
export function __resetNetworkMonitoringForTests(): void {
  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
  }
  useNetworkStore.setState({ ...INITIAL_SNAPSHOT, monitoring: false });
}
