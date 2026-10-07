/**
 * Device geolocation implementation for Stage 4 (RF-04).
 *
 * Device-only: imports `@react-native-community/geolocation` and the
 * Stage 1 permission flow, neither of which runs under Jest. Pure logic
 * (mapping, caching, permission gating) stays in geo.ts so it remains
 * unit-testable; this file only adapts callback APIs and native prompts.
 */

import { Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import type { GeolocationError } from '@react-native-community/geolocation';
import {
  checkAppPermissions,
  requestAppPermissions,
} from '../permissions/permissions';
import {
  DEFAULT_GEO_MAX_AGE_MS,
  DEFAULT_GEO_TIMEOUT_MS,
  GeoError,
  isLocationGranted,
  toCoordinates,
} from './geo';
import type {
  CachedGeoLocatorOptions,
  GeoCoordinates,
  GeoLocator,
  GeoReadOptions,
} from './geo';
import { CachedGeoLocator } from './geo';

function toGeoError(err: GeolocationError): GeoError {
  const denied = Number(err?.PERMISSION_DENIED ?? 1);
  const unavailable = Number(err?.POSITION_UNAVAILABLE ?? 2);
  const timeout = Number(err?.TIMEOUT ?? 3);
  if (err.code === denied) {
    return new GeoError('permission-denied', err.message || 'location denied');
  }
  if (err.code === timeout) {
    return new GeoError('timeout', err.message || 'location timed out');
  }
  if (err.code === unavailable) {
    return new GeoError(
      'unavailable',
      err.message || 'position unavailable',
    );
  }
  return new GeoError('unknown', err.message || 'unknown location error');
}

/**
 * Enforce the Stage 1 permission order before touching GPS: foreground
 * first, background separately (Android 11+ rejects bundled requests).
 * Off Android the flow reports `unavailable` because iOS prompts on first
 * Geolocation use instead — there is nothing to pre-request, so return.
 */
export async function ensureLocationPermission(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  const current = await checkAppPermissions();
  if (isLocationGranted(current)) {
    return;
  }
  const next = await requestAppPermissions();
  if (!isLocationGranted(next)) {
    throw new GeoError(
      'permission-denied',
      `location permission not granted (foreground: ${next.foregroundLocation}, background: ${next.backgroundLocation})`,
    );
  }
}

/** System locator: promisified one-shot fix from the native module. */
export function createSystemGeoLocator(): GeoLocator {
  return {
    getCurrentPosition: (options: GeoReadOptions = {}) =>
      new Promise<GeoCoordinates>((resolve, reject) => {
        Geolocation.getCurrentPosition(
          position => {
            try {
              resolve(toCoordinates(position));
            } catch (err) {
              reject(err);
            }
          },
          (err: GeolocationError) => reject(toGeoError(err)),
          {
            timeout: options.timeoutMs ?? DEFAULT_GEO_TIMEOUT_MS,
            maximumAge: options.maximumAgeMs ?? DEFAULT_GEO_MAX_AGE_MS,
            enableHighAccuracy: options.highAccuracy ?? true,
          },
        );
      }),
  };
}

/**
 * Request permission, take one fix, and hand back a cached locator seeded
 * for the walk. The UI reads getLastKnown() without blocking; samples go
 * through getCurrentPosition(), which re-acquires only once the fix ages.
 */
export function createCachedSystemGeoLocator(
  options: CachedGeoLocatorOptions = {},
): CachedGeoLocator {
  return new CachedGeoLocator(createSystemGeoLocator(), options);
}
