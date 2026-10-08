/**
 * Pure SQL query builders for Stage 4 (RF-04).
 *
 * No native imports: every builder returns a SQL string plus positional
 * params, so all three query shapes (time range, network type, bounding
 * box) are unit-testable on Windows without SQLite.
 */

import type { BoundingBox, NewSampleInput } from './types';

export type SqlParam = string | number | boolean | null;

export interface QuerySpec {
  sql: string;
  params: SqlParam[];
}

export type SortOrder = 'ASC' | 'DESC';

export interface PageOptions {
  order?: SortOrder;
  limit?: number;
  offset?: number;
}

/** Column order shared by insertSample and the row mapper. */
export const SAMPLE_COLUMN_NAMES: readonly string[] = [
  'session_id',
  'timestamp',
  'latitude',
  'longitude',
  'accuracy',
  'network_type',
  'host',
  'port',
  'sent',
  'answered',
  'loss_ratio',
  'rtt_min_ms',
  'rtt_max_ms',
  'rtt_mean_ms',
  'rtt_p50_ms',
  'rtt_p90_ms',
  'rtt_p95_ms',
  'rtt_jitter_ms',
  'download_mbps',
  'upload_mbps',
  'signal_dbm',
];

export const SAMPLE_COLUMNS = SAMPLE_COLUMN_NAMES.join(', ');
export const SESSION_COLUMNS = 'id, started_at, ended_at, name';

function toPage(page: PageOptions | undefined, defaultOrder: SortOrder): {
  order: SortOrder;
  limit: number | null;
  offset: number | null;
} {
  const order = page?.order ?? defaultOrder;
  const limit = page?.limit;
  const offset = page?.offset;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new RangeError(`limit must be a non-negative integer, got ${limit}`);
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new RangeError(
      `offset must be a non-negative integer, got ${offset}`,
    );
  }
  return { order, limit: limit ?? null, offset: offset ?? null };
}

function applyPaging(
  base: string,
  params: SqlParam[],
  orderColumn: string,
  page: PageOptions | undefined,
  defaultOrder: SortOrder,
): QuerySpec {
  const resolved = toPage(page, defaultOrder);
  let sql = `${base} ORDER BY ${orderColumn} ${resolved.order}`;
  const out = [...params];
  if (resolved.limit !== null) {
    sql += ' LIMIT ?';
    out.push(resolved.limit);
  }
  if (resolved.offset !== null) {
    // OFFSET without LIMIT is valid only when LIMIT is present in SQLite
    // when written as `LIMIT -1 OFFSET ?`; requiring LIMIT keeps the
    // builder honest and the fake simple.
    if (resolved.limit === null) {
      sql += ' LIMIT -1';
    }
    sql += ' OFFSET ?';
    out.push(resolved.offset);
  }
  return { sql: `${sql};`, params: out };
}

/**
 * Order inverted edges and clamp to valid ranges. Boxes crossing the
 * antimeridian (minLng > maxLng after ordering) are not representable as
 * a single BETWEEN pair — callers must split them into two queries.
 */
export function normalizeBoundingBox(box: BoundingBox): BoundingBox {
  const orderedLat =
    box.minLat <= box.maxLat
      ? [box.minLat, box.maxLat]
      : [box.maxLat, box.minLat];
  const orderedLng =
    box.minLng <= box.maxLng
      ? [box.minLng, box.maxLng]
      : [box.maxLng, box.minLng];
  const clamp = (value: number, lo: number, hi: number): number =>
    Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : lo;
  return {
    minLat: clamp(orderedLat[0] ?? -90, -90, 90),
    maxLat: clamp(orderedLat[1] ?? 90, -90, 90),
    minLng: clamp(orderedLng[0] ?? -180, -180, 180),
    maxLng: clamp(orderedLng[1] ?? 180, -180, 180),
  };
}

export function insertSession(
  id: string,
  startedAt: number,
  name: string | null,
): QuerySpec {
  return {
    sql: `INSERT INTO sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?);`,
    params: [id, startedAt, null, name],
  };
}

export function updateSessionEnd(id: string, endedAt: number): QuerySpec {
  return {
    sql: 'UPDATE sessions SET ended_at = ? WHERE id = ?;',
    params: [endedAt, id],
  };
}

export function selectSessionById(id: string): QuerySpec {
  return {
    sql: `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?;`,
    params: [id],
  };
}

export function selectSessions(page?: PageOptions): QuerySpec {
  return applyPaging(
    `SELECT ${SESSION_COLUMNS} FROM sessions`,
    [],
    'started_at',
    page,
    'DESC',
  );
}

function sampleValue(sample: NewSampleInput, column: string): SqlParam {
  switch (column) {
    case 'session_id':
      return sample.sessionId;
    case 'timestamp':
      return sample.timestamp;
    case 'latitude':
      return sample.latitude;
    case 'longitude':
      return sample.longitude;
    case 'accuracy':
      return sample.accuracy;
    case 'network_type':
      return sample.networkType;
    case 'host':
      return sample.host;
    case 'port':
      return sample.port;
    case 'sent':
      return sample.sent;
    case 'answered':
      return sample.answered;
    case 'loss_ratio':
      return sample.lossRatio;
    case 'rtt_min_ms':
      return sample.rttMinMs;
    case 'rtt_max_ms':
      return sample.rttMaxMs;
    case 'rtt_mean_ms':
      return sample.rttMeanMs;
    case 'rtt_p50_ms':
      return sample.rttP50Ms;
    case 'rtt_p90_ms':
      return sample.rttP90Ms;
    case 'rtt_p95_ms':
      return sample.rttP95Ms;
    case 'rtt_jitter_ms':
      return sample.rttJitterMs;
    case 'download_mbps':
      return sample.downloadMbps;
    case 'upload_mbps':
      return sample.uploadMbps;
    case 'signal_dbm':
      return sample.signalDbm;
    default:
      throw new Error(`unknown sample column: ${column}`);
  }
}

export function insertSample(sample: NewSampleInput): QuerySpec {
  const placeholders = SAMPLE_COLUMN_NAMES.map(() => '?').join(', ');
  return {
    sql: `INSERT INTO samples (${SAMPLE_COLUMNS}) VALUES (${placeholders});`,
    params: SAMPLE_COLUMN_NAMES.map(column => sampleValue(sample, column)),
  };
}

export function selectSamplesByDateRange(
  startMs: number,
  endMs: number,
  page?: PageOptions,
): QuerySpec {
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  return applyPaging(
    `SELECT id, ${SAMPLE_COLUMNS} FROM samples WHERE timestamp BETWEEN ? AND ?`,
    [lo, hi],
    'timestamp',
    page,
    'ASC',
  );
}

export function selectSamplesByNetworkType(
  networkType: string,
  page?: PageOptions,
): QuerySpec {
  return applyPaging(
    `SELECT id, ${SAMPLE_COLUMNS} FROM samples WHERE network_type = ?`,
    [networkType],
    'timestamp',
    page,
    'ASC',
  );
}

export function selectSamplesByBoundingBox(
  box: BoundingBox,
  page?: PageOptions,
): QuerySpec {
  const normalized = normalizeBoundingBox(box);
  return applyPaging(
    `SELECT id, ${SAMPLE_COLUMNS} FROM samples WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`,
    [
      normalized.minLat,
      normalized.maxLat,
      normalized.minLng,
      normalized.maxLng,
    ],
    'timestamp',
    page,
    'ASC',
  );
}

export function selectSamplesBySession(
  sessionId: string,
  page?: PageOptions,
): QuerySpec {
  return applyPaging(
    `SELECT id, ${SAMPLE_COLUMNS} FROM samples WHERE session_id = ?`,
    [sessionId],
    'timestamp',
    page,
    'ASC',
  );
}
