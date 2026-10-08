/**
 * Codegen spec for the Stage 2 native telemetry TurboModule (ADR-1, RF-01).
 *
 * Declares the one-shot read (`getCurrentNetworkInfo`) plus the two native
 * event emitters (`onSignalStrengthChanged`, `onNetworkStateChanged`) that
 * the Kotlin/Swift implementations drive from the platform's own listeners —
 * never polled from JS.
 *
 * Platform contract (ADR-2):
 * - Android resolves dBm via `CellSignalStrength.getDbm()` and a cell
 *   identity string, plus the exact radio type via `getDataNetworkType()`.
 * - iOS resolves the network type via
 *   `serviceCurrentRadioAccessTechnology` and honestly reports carrier and
 *   RSSI as unavailable (null) — never fabricated, never blank.
 *
 * Every nullable field means "the platform withheld this" (no permission,
 * empty `CellInfo`, emulator/simulator). The JS bridge maps that to the
 * store's null seam, and the screen renders an explicit empty state.
 */

import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/** One-shot radio snapshot. Null fields are typed unavailability, not gaps. */
export type NativeNetworkInfo = {
  /** Exact radio string: LTE, NR, HSPA, WCDMA, GSM, CDMA, WIFI, UNKNOWN. */
  networkType: string;
  /** Serving-cell RSSI in dBm. Null where the platform withholds it. */
  signalDbm: number | null;
  /** Serving-cell identity. Null where the platform withholds it. */
  cellIdentity: string | null;
  /** Carrier name. Null on iOS 16.4+ (scrubbed) and without permission. */
  carrierName: string | null;
  /** False when telephony is unreachable (no permission, no service). */
  available: boolean;
};

export type SignalStrengthEvent = {
  networkType: string;
  signalDbm: number | null;
};

export type NetworkStateEvent = {
  networkType: string;
  previousNetworkType: string | null;
};

export interface Spec extends TurboModule {
  getCurrentNetworkInfo(): Promise<NativeNetworkInfo>;
  readonly onSignalStrengthChanged: CodegenTypes.EventEmitter<SignalStrengthEvent>;
  readonly onNetworkStateChanged: CodegenTypes.EventEmitter<NetworkStateEvent>;
  /**
   * Reference-counted platform listener lifecycle: radio callbacks start on
   * the first JS subscriber and stop when the last one leaves. Declared in
   * the spec so codegen exposes them to JS (undeclared methods are not
   * reachable on a TurboModule).
   */
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

// Nullable on purpose: the module is absent in Jest and on platforms where
// codegen did not run. The bridge degrades to a typed unavailable result.
const NativeNetworkTelemetry =
  TurboModuleRegistry.get<Spec>('NativeNetworkTelemetry');

export default NativeNetworkTelemetry;
