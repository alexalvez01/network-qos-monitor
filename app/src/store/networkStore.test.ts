import { NetInfoState } from '@react-native-community/netinfo';

jest.mock(
  '@react-native-community/netinfo',
  () =>
    jest.requireActual(
      '@react-native-community/netinfo/jest/netinfo-mock.js',
    ),
);

import { mapNetInfoToSnapshot } from './networkStore';

function wifiState(overrides: object = {}): NetInfoState {
  return {
    type: 'wifi',
    isConnected: true,
    isInternetReachable: true,
    details: {
      isConnectionExpensive: false,
      ssid: null,
      bssid: null,
      strength: 72,
      ipAddress: null,
      subnet: null,
      frequency: null,
      linkSpeed: null,
      rxLinkSpeed: null,
      txLinkSpeed: null,
    },
    ...overrides,
  } as NetInfoState;
}

test('maps a wifi snapshot with strength', () => {
  const snapshot = mapNetInfoToSnapshot(wifiState());
  expect(snapshot.type).toBe('WIFI');
  expect(snapshot.strength).toBe(72);
  expect(snapshot.subtype).toBeNull();
  expect(snapshot.isConnected).toBe(true);
  expect(snapshot.isInternetReachable).toBe(true);
});

test('maps a cellular snapshot with generation and carrier', () => {
  const snapshot = mapNetInfoToSnapshot(
    wifiState({
      type: 'cellular',
      details: {
        isConnectionExpensive: true,
        cellularGeneration: '4g',
        carrier: 'Personal',
      },
    }),
  );
  expect(snapshot.type).toBe('CELLULAR');
  expect(snapshot.cellularGeneration).toBe('4g');
  expect(snapshot.carrier).toBe('Personal');
});

test('out-of-range strength and blank strings become null', () => {
  const snapshot = mapNetInfoToSnapshot(
    wifiState({
      details: {
        isConnectionExpensive: false,
        strength: -1,
        carrier: '',
        subtype: '',
      },
    }),
  );
  expect(snapshot.strength).toBeNull();
  expect(snapshot.carrier).toBeNull();
  expect(snapshot.subtype).toBeNull();
});

test('disconnected state keeps booleans, nulls stay null', () => {
  const snapshot = mapNetInfoToSnapshot({
    type: 'none',
    isConnected: false,
    isInternetReachable: false,
    details: null,
  } as unknown as NetInfoState);
  expect(snapshot.type).toBe('NONE');
  expect(snapshot.isConnected).toBe(false);
  expect(snapshot.strength).toBeNull();
  expect(snapshot.cellularGeneration).toBeNull();
});
