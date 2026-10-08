/**
 * SQLite schema for Stage 4 (RF-04, ADR-6).
 *
 * Pure TypeScript: DDL and index definitions are plain strings, fully
 * unit-testable on Windows. Two tables: sessions (one row per walk) and
 * samples (one row per host aggregate per measurement pass).
 *
 * Index rationale — one index per query shape:
 * - timestamp: time-range scans (`WHERE timestamp BETWEEN ? AND ?`).
 * - network_type: equality filter (`WHERE network_type = ?`).
 * - (latitude, longitude) composite: bounding-box queries run as
 *   `latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`. SQLite can
 *   range-scan only the leading column of a B-tree, so the index serves
 *   the latitude range and the longitude predicate filters within it.
 *   Latitude leads because walks in the demo area span less latitude
 *   than longitude only by convention — either column would work; what
 *   matters is that one range is indexed and the other is a residual.
 * - session_id: "session with its samples" lookups.
 */

export const DATABASE_NAME = 'network-qos.db';
export const SCHEMA_VERSION = 2;

export const TABLE_SESSIONS = 'sessions';
export const TABLE_SAMPLES = 'samples';

export const PRAGMA_FOREIGN_KEYS = 'PRAGMA foreign_keys = ON;';

export const CREATE_SESSIONS_TABLE = `CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  name TEXT
);`;

export const CREATE_SAMPLES_TABLE = `CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  network_type TEXT,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  sent INTEGER NOT NULL,
  answered INTEGER NOT NULL,
  loss_ratio REAL,
  rtt_min_ms REAL,
  rtt_max_ms REAL,
  rtt_mean_ms REAL,
  rtt_p50_ms REAL,
  rtt_p90_ms REAL,
  rtt_p95_ms REAL,
  rtt_jitter_ms REAL,
  download_mbps REAL,
  upload_mbps REAL,
  signal_dbm REAL
);`;

/**
 * Additive migrations for databases created by an older build. Each one
 * fails harmlessly when already applied (duplicate column), so repository
 * init runs them best-effort after SCHEMA_STATEMENTS.
 */
export const SCHEMA_MIGRATIONS: readonly string[] = [
  'ALTER TABLE samples ADD COLUMN signal_dbm REAL;',
  // Key/value store for user settings (probe hosts, backend address).
  'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
];

export const CREATE_INDEX_SAMPLES_TIMESTAMP =
  'CREATE INDEX IF NOT EXISTS idx_samples_timestamp ON samples (timestamp);';

export const CREATE_INDEX_SAMPLES_NETWORK_TYPE =
  'CREATE INDEX IF NOT EXISTS idx_samples_network_type ON samples (network_type);';

export const CREATE_INDEX_SAMPLES_GEO =
  'CREATE INDEX IF NOT EXISTS idx_samples_geo ON samples (latitude, longitude);';

export const CREATE_INDEX_SAMPLES_SESSION_ID =
  'CREATE INDEX IF NOT EXISTS idx_samples_session_id ON samples (session_id);';

/** Applied in order by repository init; idempotent via IF NOT EXISTS. */
export const SCHEMA_STATEMENTS: readonly string[] = [
  PRAGMA_FOREIGN_KEYS,
  CREATE_SESSIONS_TABLE,
  CREATE_SAMPLES_TABLE,
  CREATE_INDEX_SAMPLES_TIMESTAMP,
  CREATE_INDEX_SAMPLES_NETWORK_TYPE,
  CREATE_INDEX_SAMPLES_GEO,
  CREATE_INDEX_SAMPLES_SESSION_ID,
];
