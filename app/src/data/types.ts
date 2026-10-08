/**
 * Persisted record shapes for Stage 4 (RF-04).
 *
 * Pure TypeScript: no React, no React Native, no native-module imports.
 * A session groups one walk; every sample row carries its own timestamp
 * and coordinates so a session survives a restart and stays queryable
 * by date and by bounding box.
 */

import type { GeoCoordinates } from './geo';

/** One walk, grouping the samples recorded during it. */
export interface SessionRecord {
  id: string;
  /** Walk start, epoch milliseconds. */
  startedAt: number;
  /** Walk end, epoch milliseconds; null while the walk is in progress. */
  endedAt: number | null;
  name: string | null;
}

export interface NewSessionInput {
  /** Defaults to a generated id when omitted. */
  id?: string;
  startedAt: number;
  name?: string | null;
}

/**
 * One persisted sample: a single host's aggregate from a MeasurementSet,
 * stamped with where and when it was taken. Set-level throughput is
 * denormalized onto every host row of the set so each row reads standalone.
 */
export interface SampleRecord {
  /** Null before insert; SQLite AUTOINCREMENT afterwards. */
  id: number | null;
  sessionId: string;
  /** Epoch milliseconds. */
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** Connection class at capture time (e.g. 'lte', 'nr', 'wifi'); null when unknown. */
  networkType: string | null;
  host: string;
  port: number;
  sent: number;
  answered: number;
  lossRatio: number | null;
  rttMinMs: number | null;
  rttMaxMs: number | null;
  rttMeanMs: number | null;
  rttP50Ms: number | null;
  rttP90Ms: number | null;
  rttP95Ms: number | null;
  rttJitterMs: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  /** Radio signal at capture time (Android only, ADR-2); null when withheld. */
  signalDbm: number | null;
}

export type NewSampleInput = Omit<SampleRecord, 'id'>;

/** Inclusive geographic window for bounding-box queries. */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** A session together with its samples in timestamp order. */
export interface SessionWithSamples {
  session: SessionRecord;
  samples: SampleRecord[];
}

/** Coordinates attached to samples at write time. */
export type SampleCoordinates = Pick<
  GeoCoordinates,
  'latitude' | 'longitude' | 'accuracy'
>;
