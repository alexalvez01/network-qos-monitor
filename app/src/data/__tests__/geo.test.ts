import {
  CachedGeoLocator,
  DEFAULT_CACHE_MAX_AGE_MS,
  GeoError,
  isLocationGranted,
  toCoordinates,
} from '../geo';
import { FakeGeoLocator, fix } from '../testing/fakeGeoLocator';
import type { AppPermissionStatuses } from '../../permissions/permissions';

function statuses(
  foregroundLocation: AppPermissionStatuses['foregroundLocation'],
): AppPermissionStatuses {
  return {
    foregroundLocation,
    backgroundLocation: 'denied',
    phoneState: 'granted',
    notifications: 'granted',
  };
}

test('location gate requires the foreground grant', () => {
  expect(isLocationGranted(statuses('granted'))).toBe(true);
  expect(isLocationGranted(statuses('denied'))).toBe(false);
  expect(isLocationGranted(statuses('never_ask_again'))).toBe(false);
  expect(isLocationGranted(statuses('unavailable'))).toBe(false);
});

test('native positions map to coordinates; bad fixes are rejected', () => {
  const coords = toCoordinates({
    coords: { latitude: -32.48, longitude: -58.23, accuracy: 12 },
    timestamp: 5000,
  });
  expect(coords).toEqual({
    latitude: -32.48,
    longitude: -58.23,
    accuracy: 12,
    timestamp: 5000,
  });
  expect(() =>
    toCoordinates({
      coords: { latitude: NaN, longitude: -58.23, accuracy: null },
      timestamp: 5000,
    }),
  ).toThrow(GeoError);
});

test('fresh cache answers without touching GPS', async () => {
  const delegate = new FakeGeoLocator();
  let now = 10000;
  const cached = new CachedGeoLocator(delegate, { now: () => now });
  const first = await cached.getCurrentPosition();
  expect(delegate.calls).toHaveLength(1);
  // Cached fix (timestamp 1000) is still within the freshness window.
  now += 1000;
  const second = await cached.getCurrentPosition();
  expect(second).toBe(first);
  expect(delegate.calls).toHaveLength(1);
  expect(cached.getLastKnown()).toBe(first);
});

test('aged cache re-acquires from the delegate', async () => {
  const delegate = new FakeGeoLocator();
  let now = 10000;
  const cached = new CachedGeoLocator(delegate, { now: () => now });
  await cached.getCurrentPosition();
  now += DEFAULT_CACHE_MAX_AGE_MS + 1;
  delegate.enqueueFix(fix(-32.5, -58.2, { timestamp: now }));
  const fresh = await cached.getCurrentPosition();
  expect(delegate.calls).toHaveLength(2);
  expect(fresh.latitude).toBe(-32.5);
});

test('failed re-acquire fails soft to the stale fix', async () => {
  const delegate = new FakeGeoLocator();
  const cached = new CachedGeoLocator(delegate);
  const first = await cached.getCurrentPosition();
  cached.invalidate();
  // No cache at all: the error must surface, not be swallowed.
  delegate.enqueueError(new GeoError('timeout', 'gps timed out'));
  await expect(cached.getCurrentPosition()).rejects.toThrow(GeoError);

  const seeded = await cached.getCurrentPosition();
  delegate.enqueueError(new GeoError('unavailable', 'tunnel'));
  const fallback = await cached.getCurrentPosition({ maximumAgeMs: -1 });
  expect(fallback).toBe(seeded);
  expect(first).toBeDefined();
});

test('invalidate drops the last known fix', async () => {
  const delegate = new FakeGeoLocator();
  const cached = new CachedGeoLocator(delegate);
  expect(cached.getLastKnown()).toBeNull();
  await cached.getCurrentPosition();
  expect(cached.getLastKnown()).not.toBeNull();
  cached.invalidate();
  expect(cached.getLastKnown()).toBeNull();
});
