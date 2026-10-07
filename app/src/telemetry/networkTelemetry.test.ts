/**
 * Bridge tests for the Stage 2 native telemetry module.
 *
 * Under Jest the native module is absent (`TurboModuleRegistry.get` returns
 * null), so these tests pin the graceful-degradation contract: unavailable
 * snapshots, null-safe mapping, and a start/stop lifecycle that never
 * throws without native code.
 */

jest.mock(
  '@react-native-community/netinfo',
  () =>
    jest.requireActual(
      '@react-native-community/netinfo/jest/netinfo-mock.js',
    ),
);

import {
  UNAVAILABLE_SNAPSHOT,
  applySnapshotToStore,
  mapNativeInfoToSnapshot,
  readNativeNetworkInfo,
  startNativeTelemetry,
} from './networkTelemetry';
import {
  __resetNetworkMonitoringForTests,
  useNetworkStore,
} from '../store/networkStore';

beforeEach(() => {
  __resetNetworkMonitoringForTests();
});

test('unavailable snapshot is fully null and flagged', () => {
  expect(UNAVAILABLE_SNAPSHOT.available).toBe(false);
  expect(UNAVAILABLE_SNAPSHOT.networkType).toBeNull();
  expect(UNAVAILABLE_SNAPSHOT.signalDbm).toBeNull();
  expect(UNAVAILABLE_SNAPSHOT.cellIdentity).toBeNull();
});

test('one-shot read without a native module resolves unavailable', async () => {
  await expect(readNativeNetworkInfo()).resolves.toEqual(
    UNAVAILABLE_SNAPSHOT,
  );
});

test('null or undefined payloads map to unavailable', () => {
  expect(mapNativeInfoToSnapshot(null)).toEqual(UNAVAILABLE_SNAPSHOT);
  expect(mapNativeInfoToSnapshot(undefined)).toEqual(UNAVAILABLE_SNAPSHOT);
});

test('a full native payload maps field by field', () => {
  const snapshot = mapNativeInfoToSnapshot({
    networkType: 'LTE',
    signalDbm: -97,
    cellIdentity: 'LTE ci=12345 pci=12 tac=34',
    carrierName: 'Personal',
    available: true,
  });
  expect(snapshot).toEqual({
    networkType: 'LTE',
    signalDbm: -97,
    cellIdentity: 'LTE ci=12345 pci=12 tac=34',
    carrierName: 'Personal',
    available: true,
  });
});

test('blank strings and non-finite dBm become null, never blank data', () => {
  const snapshot = mapNativeInfoToSnapshot({
    networkType: '',
    signalDbm: Number.NaN,
    cellIdentity: '',
    carrierName: '',
    available: true,
  });
  expect(snapshot.networkType).toBeNull();
  expect(snapshot.signalDbm).toBeNull();
  expect(snapshot.cellIdentity).toBeNull();
  expect(snapshot.carrierName).toBeNull();
});

test('applying a snapshot makes subtype, dBm and cell identity live', () => {
  applySnapshotToStore({
    networkType: 'NR',
    signalDbm: -85,
    cellIdentity: 'NR nci=987654321 pci=40 tac=7',
    carrierName: 'Claro',
    available: true,
  });
  const state = useNetworkStore.getState();
  expect(state.subtype).toBe('NR');
  expect(state.signalDbm).toBe(-85);
  expect(state.cellIdentity).toBe('NR nci=987654321 pci=40 tac=7');
});

test('telemetry lifecycle is a safe no-op without the native module', async () => {
  const stop = startNativeTelemetry();
  expect(() => stop()).not.toThrow();
  // The one-shot resolves unavailable on the microtask queue.
  await Promise.resolve();
  await new Promise<void>(resolve => setTimeout(() => resolve(undefined), 0));
  expect(useNetworkStore.getState().subtype).toBeNull();
  expect(useNetworkStore.getState().signalDbm).toBeNull();
});
