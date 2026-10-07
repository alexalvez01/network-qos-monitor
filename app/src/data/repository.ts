/**
 * Measurement repository for Stage 4 (RF-04).
 *
 * Orchestrates inserts and queries over an injected Database — the same
 * seam Stage 3 used for the TCP transport. Imports the Database interface
 * via `import type` only, so this module (and its tests) never loads the
 * native op-sqlite module. SQL text comes from queries.ts; row mapping is
 * total (nulls and empty sets are data, never throws, except where noted).
 */

import type { MeasurementSet } from '../measurement/types';
import type { Database, DbRow } from './database';
import { SCHEMA_STATEMENTS } from './schema';
import {
  insertSample,
  insertSession,
  selectSamplesByBoundingBox,
  selectSamplesByDateRange,
  selectSamplesByNetworkType,
  selectSamplesBySession,
  selectSessionById,
  selectSessions,
  updateSessionEnd,
} from './queries';
import type { PageOptions, QuerySpec } from './queries';
import type {
  BoundingBox,
  NewSampleInput,
  SampleCoordinates,
  SampleRecord,
  SessionRecord,
  SessionWithSamples,
} from './types';

/** Any storage failure below the repository (open, execute, constraint). */
export class DatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'DatabaseError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** A measurement pass produced no usable position — nothing was written. */
export class MissingCoordinatesError extends Error {
  constructor(message = 'cannot persist a sample without coordinates') {
    super(message);
    this.name = 'MissingCoordinatesError';
  }
}

/** Insert targeted a session id with no matching session row. */
export class SessionNotFoundError extends DatabaseError {
  constructor(sessionId: string) {
    super(`session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

export interface SaveMeasurementOptions {
  /** Fix attached to every row; null/undefined aborts the write. */
  position: SampleCoordinates | null | undefined;
  networkType?: string | null;
  /** Defaults to Date.now(); pass the set's endedAt for determinism. */
  timestamp?: number;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function mapRowToSession(row: DbRow): SessionRecord {
  const endedAt = row['ended_at'];
  return {
    id: toString(row['id']),
    startedAt: typeof row['started_at'] === 'number' ? row['started_at'] : 0,
    endedAt: typeof endedAt === 'number' ? endedAt : null,
    name: typeof row['name'] === 'string' ? row['name'] : null,
  };
}

export function mapRowToSample(row: DbRow): SampleRecord {
  const id = row['id'];
  return {
    id: typeof id === 'number' ? id : null,
    sessionId: toString(row['session_id']),
    timestamp: typeof row['timestamp'] === 'number' ? row['timestamp'] : 0,
    latitude: typeof row['latitude'] === 'number' ? row['latitude'] : 0,
    longitude: typeof row['longitude'] === 'number' ? row['longitude'] : 0,
    accuracy: toNullableNumber(row['accuracy']),
    networkType:
      typeof row['network_type'] === 'string' ? row['network_type'] : null,
    host: toString(row['host']),
    port: typeof row['port'] === 'number' ? row['port'] : 0,
    sent: typeof row['sent'] === 'number' ? row['sent'] : 0,
    answered: typeof row['answered'] === 'number' ? row['answered'] : 0,
    lossRatio: toNullableNumber(row['loss_ratio']),
    rttMinMs: toNullableNumber(row['rtt_min_ms']),
    rttMaxMs: toNullableNumber(row['rtt_max_ms']),
    rttMeanMs: toNullableNumber(row['rtt_mean_ms']),
    rttP50Ms: toNullableNumber(row['rtt_p50_ms']),
    rttP90Ms: toNullableNumber(row['rtt_p90_ms']),
    rttP95Ms: toNullableNumber(row['rtt_p95_ms']),
    rttJitterMs: toNullableNumber(row['rtt_jitter_ms']),
    downloadMbps: toNullableNumber(row['download_mbps']),
    uploadMbps: toNullableNumber(row['upload_mbps']),
  };
}

function hasUsableCoordinates(
  position: SampleCoordinates | null | undefined,
): position is SampleCoordinates {
  return (
    !!position &&
    typeof position.latitude === 'number' &&
    Number.isFinite(position.latitude) &&
    typeof position.longitude === 'number' &&
    Number.isFinite(position.longitude)
  );
}

/** Session id default: start time plus random suffix, unique per walk. */
export function generateSessionId(startedAt: number): string {
  const suffix = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  return `${startedAt}-${suffix}`;
}

/**
 * Expand one MeasurementSet into one sample row per host. Pure: throws
 * MissingCoordinatesError before producing anything, so callers never
 * write partial sets.
 */
export function measurementSetToSamples(
  sessionId: string,
  set: MeasurementSet,
  options: SaveMeasurementOptions,
): NewSampleInput[] {
  if (!hasUsableCoordinates(options.position)) {
    throw new MissingCoordinatesError();
  }
  const { latitude, longitude, accuracy } = options.position;
  const timestamp = options.timestamp ?? Date.now();
  const networkType = options.networkType ?? null;
  return set.hosts.map(host => ({
    sessionId,
    timestamp,
    latitude,
    longitude,
    accuracy: typeof accuracy === 'number' ? accuracy : null,
    networkType,
    host: host.host,
    port: host.port,
    sent: host.sent,
    answered: host.answered,
    lossRatio: host.lossRatio,
    rttMinMs: host.rtt.minMs,
    rttMaxMs: host.rtt.maxMs,
    rttMeanMs: host.rtt.meanMs,
    rttP50Ms: host.rtt.p50Ms,
    rttP90Ms: host.rtt.p90Ms,
    rttP95Ms: host.rtt.p95Ms,
    rttJitterMs: host.rtt.jitterMs,
    downloadMbps: set.download?.mbps ?? null,
    uploadMbps: set.upload?.mbps ?? null,
  }));
}

export class MeasurementRepository {
  constructor(private readonly db: Database) {}

  /** Create tables and indexes; idempotent, safe to call on every launch. */
  async init(): Promise<void> {
    try {
      for (const statement of SCHEMA_STATEMENTS) {
        await this.db.execute(statement);
      }
    } catch (err) {
      throw new DatabaseError('failed to initialize database schema', {
        cause: err,
      });
    }
  }

  private async run(spec: QuerySpec): Promise<
    Awaited<ReturnType<Database['execute']>>
  > {
    try {
      return await this.db.execute(spec.sql, spec.params);
    } catch (err) {
      throw new DatabaseError(`query failed: ${spec.sql}`, { cause: err });
    }
  }

  async createSession(input: {
    id?: string;
    startedAt: number;
    name?: string | null;
  }): Promise<SessionRecord> {
    const id = input.id ?? generateSessionId(input.startedAt);
    const name = input.name ?? null;
    await this.run(insertSession(id, input.startedAt, name));
    return { id, startedAt: input.startedAt, endedAt: null, name };
  }

  async endSession(id: string, endedAt: number = Date.now()): Promise<SessionRecord | null> {
    const updated = await this.run(updateSessionEnd(id, endedAt));
    if (updated.rowsAffected === 0) {
      return null;
    }
    return this.getSession(id);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const result = await this.run(selectSessionById(id));
    const row = result.rows[0];
    return row ? mapRowToSession(row) : null;
  }

  async listSessions(page?: PageOptions): Promise<SessionRecord[]> {
    const result = await this.run(selectSessions(page));
    return result.rows.map(mapRowToSession);
  }

  /**
   * Persist one engine pass as one row per host. Rejects when the session
   * is unknown or the position is missing — partial sets are never stored.
   */
  async saveMeasurementSet(
    sessionId: string,
    set: MeasurementSet,
    options: SaveMeasurementOptions,
  ): Promise<SampleRecord[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    const inputs = measurementSetToSamples(sessionId, set, options);
    const saved: SampleRecord[] = [];
    for (const input of inputs) {
      const result = await this.run(insertSample(input));
      saved.push({ ...input, id: result.insertId ?? null });
    }
    return saved;
  }

  async findByDateRange(
    startMs: number,
    endMs: number,
    page?: PageOptions,
  ): Promise<SampleRecord[]> {
    const result = await this.run(selectSamplesByDateRange(startMs, endMs, page));
    return result.rows.map(mapRowToSample);
  }

  async findByNetworkType(
    networkType: string,
    page?: PageOptions,
  ): Promise<SampleRecord[]> {
    const result = await this.run(selectSamplesByNetworkType(networkType, page));
    return result.rows.map(mapRowToSample);
  }

  async findByBoundingBox(
    box: BoundingBox,
    page?: PageOptions,
  ): Promise<SampleRecord[]> {
    const result = await this.run(selectSamplesByBoundingBox(box, page));
    return result.rows.map(mapRowToSample);
  }

  async getSamplesBySession(
    sessionId: string,
    page?: PageOptions,
  ): Promise<SampleRecord[]> {
    const result = await this.run(selectSamplesBySession(sessionId, page));
    return result.rows.map(mapRowToSample);
  }

  /**
   * One session with its samples in timestamp order. Null when the session
   * does not exist; a session without samples yields an empty array.
   */
  async getSessionWithSamples(
    sessionId: string,
  ): Promise<SessionWithSamples | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }
    const samples = await this.getSamplesBySession(sessionId);
    return { session, samples };
  }
}
