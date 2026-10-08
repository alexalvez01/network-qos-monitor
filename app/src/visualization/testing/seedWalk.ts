/**
 * Deterministic demo walk for Stage 5.
 *
 * Test/display fixture only: a synthetic walk around Concepción del
 * Uruguay with a mid-walk quality dip (good -> poor -> recovering) so the
 * heat layer and charts show real color and shape variation on an emulator,
 * where GPS is fake and no measurement pass has ever run. The generator is
 * seeded, so tests, screenshots and the demo video all see the same walk.
 * Displayed data from this file must always be labeled as demo data.
 */

import type { SampleRecord, SessionRecord } from '../../data/types';
import type { HeatPoint } from '../heat/heat';

export const SEED_WALK_SIZE = 40;
/** Fixed walk start: 2026-10-20 15:00 UTC, one sample every 5 seconds. */
export const SEED_WALK_START_MS = Date.UTC(2026, 9, 20, 15, 0, 0);
export const SEED_STEP_MS = 5000;
/** Barrilete-cosmos corner of Concepción del Uruguay, Entre Ríos. */
export const SEED_ORIGIN = { latitude: -32.484, longitude: -58.232 };

function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export interface SeedWalk {
  session: SessionRecord;
  samples: SampleRecord[];
}

/**
 * Build the demo walk. Pure and deterministic: same seed, same samples.
 * Latency follows a hump (clean start, congested middle, recovery) with
 * small jitter; throughput mirrors it inversely.
 */
export function buildSeedWalk(count: number = SEED_WALK_SIZE): SeedWalk {
  const size = Math.max(0, Math.floor(count));
  const random = makeLcg(0x51eed);
  const session: SessionRecord = {
    id: `demo-walk-${SEED_WALK_START_MS}`,
    startedAt: SEED_WALK_START_MS,
    endedAt:
      size > 0 ? SEED_WALK_START_MS + (size - 1) * SEED_STEP_MS : null,
    name: 'Demo walk (synthetic)',
  };

  const samples: SampleRecord[] = [];
  for (let i = 0; i < size; i++) {
    // Drift north-east with a small deterministic wobble.
    const latitude =
      SEED_ORIGIN.latitude + i * 0.00021 + (random() - 0.5) * 0.00006;
    const longitude =
      SEED_ORIGIN.longitude + i * 0.00017 + (random() - 0.5) * 0.00006;
    // Congestion hump peaking two thirds along the walk.
    const phase = size <= 1 ? 0 : i / (size - 1);
    const hump = Math.sin(phase * Math.PI);
    const latencyMs = Math.round(55 + hump * 340 + (random() - 0.5) * 24);
    const throughputMbps =
      Math.round((19 - hump * 16.5 + (random() - 0.5) * 1.6) * 10) / 10;
    const timestamp = SEED_WALK_START_MS + i * SEED_STEP_MS;
    samples.push({
      id: null,
      sessionId: session.id,
      timestamp,
      latitude,
      longitude,
      accuracy: 8,
      networkType: 'lte',
      host: '1.1.1.1',
      port: 443,
      sent: 4,
      answered: latencyMs > 450 ? 3 : 4,
      lossRatio: latencyMs > 450 ? 0.25 : 0,
      rttMinMs: latencyMs - 12,
      rttMaxMs: latencyMs + 18,
      rttMeanMs: latencyMs,
      rttP50Ms: latencyMs,
      rttP90Ms: latencyMs + 10,
      rttP95Ms: latencyMs + 14,
      rttJitterMs: 6,
      downloadMbps: throughputMbps,
      uploadMbps: Math.round(throughputMbps * 0.4 * 10) / 10,
      signalDbm: Math.round(-72 - hump * 30),
    });
  }
  return { session, samples };
}

/** Demo samples as heat points, ready for aggregation. */
export function seedHeatPoints(count: number = SEED_WALK_SIZE): HeatPoint[] {
  return buildSeedWalk(count).samples.map(sample => ({
    latitude: sample.latitude,
    longitude: sample.longitude,
    latencyMs: sample.rttMeanMs,
    throughputMbps: sample.downloadMbps,
    dbm: null,
  }));
}
