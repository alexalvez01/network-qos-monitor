import {
  CREATE_INDEX_SAMPLES_GEO,
  CREATE_INDEX_SAMPLES_NETWORK_TYPE,
  CREATE_INDEX_SAMPLES_SESSION_ID,
  CREATE_INDEX_SAMPLES_TIMESTAMP,
  CREATE_SAMPLES_TABLE,
  CREATE_SESSIONS_TABLE,
  PRAGMA_FOREIGN_KEYS,
  SCHEMA_STATEMENTS,
} from '../schema';

test('schema applies foreign keys, both tables, then indexes', () => {
  expect(SCHEMA_STATEMENTS[0]).toBe(PRAGMA_FOREIGN_KEYS);
  expect(SCHEMA_STATEMENTS).toContain(CREATE_SESSIONS_TABLE);
  expect(SCHEMA_STATEMENTS).toContain(CREATE_SAMPLES_TABLE);
  expect(SCHEMA_STATEMENTS.indexOf(CREATE_SAMPLES_TABLE)).toBeGreaterThan(
    SCHEMA_STATEMENTS.indexOf(CREATE_SESSIONS_TABLE),
  );
  const lastFour = SCHEMA_STATEMENTS.slice(-4);
  expect(lastFour).toEqual([
    CREATE_INDEX_SAMPLES_TIMESTAMP,
    CREATE_INDEX_SAMPLES_NETWORK_TYPE,
    CREATE_INDEX_SAMPLES_GEO,
    CREATE_INDEX_SAMPLES_SESSION_ID,
  ]);
});

test('sessions table groups a walk with an open-ended end', () => {
  expect(CREATE_SESSIONS_TABLE).toMatch(/id TEXT PRIMARY KEY/);
  expect(CREATE_SESSIONS_TABLE).toMatch(/started_at INTEGER NOT NULL/);
  expect(CREATE_SESSIONS_TABLE).toMatch(/ended_at INTEGER/);
});

test('every sample row carries timestamp and coordinates', () => {
  expect(CREATE_SAMPLES_TABLE).toMatch(/timestamp INTEGER NOT NULL/);
  expect(CREATE_SAMPLES_TABLE).toMatch(/latitude REAL NOT NULL/);
  expect(CREATE_SAMPLES_TABLE).toMatch(/longitude REAL NOT NULL/);
});

test('each query shape has a serving index', () => {
  expect(CREATE_INDEX_SAMPLES_TIMESTAMP).toMatch(/ON samples \(timestamp\)/);
  expect(CREATE_INDEX_SAMPLES_NETWORK_TYPE).toMatch(
    /ON samples \(network_type\)/,
  );
  // Composite geo index with latitude leading: the latitude range scan
  // uses the B-tree, the longitude predicate filters within it.
  expect(CREATE_INDEX_SAMPLES_GEO).toMatch(
    /ON samples \(latitude, longitude\)/,
  );
  expect(CREATE_INDEX_SAMPLES_SESSION_ID).toMatch(/ON samples \(session_id\)/);
});
