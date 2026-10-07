/**
 * Geolocation contracts and caching for Stage 4 (RF-04).
 *
 * Pure TypeScript: no React Native, no geolocation import. The real
 * implementation lives in geoNative.ts (device only); unit tests inject
 * the fake from testing/fakeGeoLocator.ts.
 *
 * Caching exists so the UI never blocks on a satellite fix: the cached
 * locator serves the last fix while it is fresh and fails soft to the
 * stale fix when a re-acquire fails mid-walk.
 */

import type { AppPermissionStatuses } from '../permissions/permissions';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** Fix time, epoch milliseconds. */
  timestamp: number;
}

export type GeoErrorCode =
  | 'permission-denied'
  | 'unavailable'
  | 'timeout'
  | 'unknown';

export class GeoError extends Error {
  readonly code: GeoErrorCode;

  constructor(code: GeoErrorCode, message: string) {
    super(message);
    this.name = 'GeoError';
    this.code = code;
  }
}

export interface GeoReadOptions {
  timeoutMs?: number;
  maximumAgeMs?: number;
  highAccuracy?: boolean;
}

export interface GeoLocator {
  getCurrentPosition(options?: GeoReadOptions): Promise<GeoCoordinates>;
}

/** Minimal structural shape of a native position — extra fields are ignored. */
export interface NativeGeoPosition {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
  };
  timestamp: number;
}

export const DEFAULT_GEO_TIMEOUT_MS = 10000;
export const DEFAULT_GEO_MAX_AGE_MS = 30000;
export const DEFAULT_CACHE_MAX_AGE_MS = 30000;

/**
 * Foreground location from the Stage 1 permission flow is the only gate
 * for sampling. Background location matters for Stage 6, not here.
 */
export function isLocationGranted(
  statuses: AppPermissionStatuses,
): boolean {
  return statuses.foregroundLocation === 'granted';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Map a native position onto GeoCoordinates. Rejects non-finite
 * coordinates — a fix without coordinates must never reach storage,
 * where latitude/longitude are NOT NULL.
 */
export function toCoordinates(position: NativeGeoPosition): GeoCoordinates {
  const { latitude, longitude, accuracy } = position.coords;
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
    throw new GeoError(
      'unavailable',
      'position has no usable coordinates (NaN or non-finite lat/lng)',
    );
  }
  return {
    latitude,
    longitude,
    accuracy: isFiniteNumber(accuracy) ? accuracy : null,
    timestamp: position.timestamp,
  };
}

export interface CachedGeoLocatorOptions {
  /** Freshness window for the cached fix. */
  maxAgeMs?: number;
  now?: () => number;
}

export class CachedGeoLocator implements GeoLocator {
  private lastKnown: GeoCoordinates | null = null;
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(
    private readonly delegate: GeoLocator,
    options: CachedGeoLocatorOptions = {},
  ) {
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
  }

  /** Last acquired fix, or null when no fix has been acquired yet. */
  getLastKnown(): GeoCoordinates | null {
    return this.lastKnown;
  }

  invalidate(): void {
    this.lastKnown = null;
  }

  async getCurrentPosition(
    options: GeoReadOptions = {},
  ): Promise<GeoCoordinates> {
    const maxAge = options.maximumAgeMs ?? this.maxAgeMs;
    const cached = this.lastKnown;
    if (cached && this.now() - cached.timestamp <= maxAge) {
      return cached;
    }
    try {
      const fix = await this.delegate.getCurrentPosition(options);
      this.lastKnown = fix;
      return fix;
    } catch (err) {
      // Mid-walk re-acquire failed (tunnel, GPS drift): keep the walk
      // going on the last known fix instead of dropping the measurement.
      if (this.lastKnown) {
        return this.lastKnown;
      }
      throw err;
    }
  }
}
