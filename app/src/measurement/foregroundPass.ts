/**
 * Foreground measurement pass (RF-02, RF-03, RF-04).
 *
 * The user-triggered counterpart of the background pass: probes the
 * configured hosts, runs the throughput test against the reference
 * backend, publishes the set to the measurement store (ADR-9) and stores
 * it under the active walk with GPS, network type and live dBm.
 *
 * Every dependency is injected (transport, repository, locator, radio
 * snapshot) so the orchestration is unit-tested with fakes; the screen
 * passes the device implementations. A pass never loses its measurement
 * because of storage: a missing fix or a database error is reported in the
 * result, while the set itself is still published for display.
 */

import type { MeasurementRepository } from '../data/repository';
import type { GeoCoordinates, GeoLocator } from '../data/geo';
import { runAndPublishMeasurement } from './engine';
import type { EngineConfig } from './engine';
import type { MeasurementSet, RunDeps, TcpTransport } from './types';

/** What the radio looked like when the pass finished. */
export interface RadioSnapshot {
  networkType: string | null;
  signalDbm: number | null;
}

export interface ForegroundPassDeps {
  transport: TcpTransport;
  /** Null when no walk is active: the pass is measured but not stored. */
  repository: MeasurementRepository | null;
  sessionId: string | null;
  locator: GeoLocator;
  radio: () => RadioSnapshot;
  run?: RunDeps;
}

export type SaveOutcome =
  | { status: 'saved'; rows: number }
  | { status: 'no-session' }
  | { status: 'no-fix'; reason: string }
  | { status: 'failed'; reason: string };

export interface ForegroundPassResult {
  set: MeasurementSet;
  position: GeoCoordinates | null;
  radio: RadioSnapshot;
  save: SaveOutcome;
}

function message(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

export async function runForegroundPass(
  config: EngineConfig,
  deps: ForegroundPassDeps,
): Promise<ForegroundPassResult> {
  // The fix is requested in parallel with the probes so a cold GPS does
  // not add its acquisition time to the pass.
  const fix = deps.locator.getCurrentPosition().then(
    position => ({ position, error: null as string | null }),
    err => ({ position: null as GeoCoordinates | null, error: message(err) }),
  );
  const set = await runAndPublishMeasurement(
    deps.transport,
    config,
    deps.run ?? {},
  );
  const { position, error } = await fix;
  const radio = deps.radio();

  let save: SaveOutcome;
  if (!deps.repository || !deps.sessionId) {
    save = { status: 'no-session' };
  } else if (!position) {
    save = { status: 'no-fix', reason: error ?? 'no location fix' };
  } else {
    try {
      const rows = await deps.repository.saveMeasurementSet(
        deps.sessionId,
        set,
        {
          position,
          networkType: radio.networkType,
          signalDbm: radio.signalDbm,
          timestamp: set.endedAt,
        },
      );
      save = { status: 'saved', rows: rows.length };
    } catch (err) {
      save = { status: 'failed', reason: message(err) };
    }
  }
  return { set, position, radio, save };
}

/**
 * Normalized network label stored with each sample and used by the
 * history filter: 'wifi', the radio subtype for cellular ('lte', 'nr'…),
 * else the generation, else the NetInfo class in lower case.
 */
export function networkTypeLabel(state: {
  type: string;
  subtype: string | null;
  cellularGeneration: string | null;
}): string | null {
  const type = state.type.toLowerCase();
  if (type === 'unknown' || type === 'none' || type.length === 0) {
    return null;
  }
  if (type === 'cellular') {
    if (state.subtype && state.subtype.length > 0) {
      return state.subtype.toLowerCase();
    }
    if (state.cellularGeneration) {
      return state.cellularGeneration.toLowerCase();
    }
  }
  return type;
}
