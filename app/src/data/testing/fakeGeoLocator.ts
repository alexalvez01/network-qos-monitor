/**
 * In-memory GeoLocator for unit tests. Never touches native modules.
 * Positions and errors are scripted in call order; every call is recorded.
 */

import { GeoError } from '../geo';
import type { GeoCoordinates, GeoLocator, GeoReadOptions } from '../geo';

export type GeoScriptOutcome =
  | { ok: true; coords: GeoCoordinates }
  | { ok: false; error: GeoError };

export function fix(
  latitude: number,
  longitude: number,
  overrides: Partial<GeoCoordinates> = {},
): GeoCoordinates {
  return {
    latitude,
    longitude,
    accuracy: 10,
    timestamp: 1000,
    ...overrides,
  };
}

export class FakeGeoLocator implements GeoLocator {
  readonly calls: GeoReadOptions[] = [];
  private readonly queue: GeoScriptOutcome[] = [];

  constructor(
    private readonly defaultFix: GeoCoordinates = fix(-32.48, -58.23),
  ) {}

  enqueueFix(coords: GeoCoordinates): void {
    this.queue.push({ ok: true, coords });
  }

  enqueueError(error: GeoError): void {
    this.queue.push({ ok: false, error });
  }

  async getCurrentPosition(options: GeoReadOptions = {}): Promise<GeoCoordinates> {
    this.calls.push(options);
    const next = this.queue.shift();
    if (!next) {
      return this.defaultFix;
    }
    if (next.ok) {
      return next.coords;
    }
    throw next.error;
  }
}
