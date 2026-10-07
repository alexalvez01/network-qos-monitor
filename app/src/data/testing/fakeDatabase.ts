/**
 * In-memory Database for unit tests. Never touches native modules.
 *
 * Understands exactly the statements the repository emits (schema setup,
 * session insert/update/select, sample insert/select with the three
 * filter shapes plus LIMIT/OFFSET) and applies them to plain arrays, so
 * repository tests exercise real round-trip semantics: insert, filter,
 * order, paginate. Anything unrecognized throws — a loud failure beats a
 * silently wrong fake.
 */

import type { Database, DbResult, DbRow, DbScalar } from '../database';
import { SAMPLE_COLUMN_NAMES } from '../queries';

interface StoredSession {
  id: string;
  started_at: number;
  ended_at: number | null;
  name: string | null;
}

interface StoredSample extends Record<string, DbScalar> {
  id: number;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalize(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ').toUpperCase();
}

export class FakeDatabase implements Database {
  readonly calls: Array<{ sql: string; params: DbScalar[] }> = [];
  /** When set, execute() rejects with this error (DB failure path). */
  failWith: Error | null = null;
  private sessions: StoredSession[] = [];
  private samples: StoredSample[] = [];
  private nextSampleId = 1;
  closed = false;

  reset(): void {
    this.calls.length = 0;
    this.sessions = [];
    this.samples = [];
    this.nextSampleId = 1;
    this.failWith = null;
    this.closed = false;
  }

  get sessionCount(): number {
    return this.sessions.length;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  async execute(sql: string, params: DbScalar[] = []): Promise<DbResult> {
    this.calls.push({ sql, params: [...params] });
    if (this.failWith) {
      throw this.failWith;
    }
    const statement = normalize(sql);
    if (
      statement.startsWith('PRAGMA') ||
      statement.startsWith('CREATE TABLE') ||
      statement.startsWith('CREATE INDEX')
    ) {
      return { rows: [], rowsAffected: 0 };
    }
    if (statement.startsWith('INSERT INTO SESSIONS')) {
      return this.insertSession(params);
    }
    if (statement.startsWith('UPDATE SESSIONS SET ENDED_AT')) {
      return this.endSession(params);
    }
    if (statement.startsWith('INSERT INTO SAMPLES')) {
      return this.insertSample(params);
    }
    if (statement.startsWith('SELECT') && statement.includes('FROM SESSIONS')) {
      return this.selectSessions(statement, params);
    }
    if (statement.startsWith('SELECT') && statement.includes('FROM SAMPLES')) {
      return this.selectSamples(statement, params);
    }
    throw new Error(`FakeDatabase does not understand: ${sql}`);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private insertSession(params: DbScalar[]): DbResult {
    const [id, startedAt, endedAt, name] = params;
    if (typeof id !== 'string') {
      throw new Error('FakeDatabase: session id must be a string');
    }
    if (this.sessions.some(session => session.id === id)) {
      throw new Error(`FakeDatabase: duplicate session id ${id}`);
    }
    this.sessions.push({
      id,
      started_at: typeof startedAt === 'number' ? startedAt : 0,
      ended_at: typeof endedAt === 'number' ? endedAt : null,
      name: typeof name === 'string' ? name : null,
    });
    return { rows: [], rowsAffected: 1 };
  }

  private endSession(params: DbScalar[]): DbResult {
    const [endedAt, id] = params;
    const session = this.sessions.find(entry => entry.id === id);
    if (!session) {
      return { rows: [], rowsAffected: 0 };
    }
    session.ended_at = typeof endedAt === 'number' ? endedAt : null;
    return { rows: [], rowsAffected: 1 };
  }

  private insertSample(params: DbScalar[]): DbResult {
    const row: StoredSample = { id: this.nextSampleId };
    SAMPLE_COLUMN_NAMES.forEach((column, index) => {
      row[column] = params[index] ?? null;
    });
    const sessionId = row['session_id'];
    if (!this.sessions.some(session => session.id === sessionId)) {
      throw new Error(`FakeDatabase: foreign key violation on ${sessionId}`);
    }
    this.samples.push(row);
    const insertId = this.nextSampleId;
    this.nextSampleId += 1;
    return { rows: [], insertId, rowsAffected: 1 };
  }

  private selectSessions(statement: string, params: DbScalar[]): DbResult {
    if (statement.includes('WHERE ID = ?')) {
      const rows = this.sessions.filter(session => session.id === params[0]);
      return { rows: rows as unknown as DbRow[], rowsAffected: 0 };
    }
    const ordered = [...this.sessions].sort(
      (a, b) => b.started_at - a.started_at,
    );
    const rows = this.applyPaging(ordered, statement, params);
    return { rows: rows as unknown as DbRow[], rowsAffected: 0 };
  }

  private selectSamples(statement: string, params: DbScalar[]): DbResult {
    let rows = [...this.samples];
    let rest = [...params];
    if (statement.includes('SESSION_ID = ?')) {
      const [sessionId, ...tail] = rest;
      rows = rows.filter(row => row['session_id'] === sessionId);
      rest = tail;
    } else if (statement.includes('TIMESTAMP BETWEEN ? AND ?')) {
      const [lo, hi, ...tail] = rest;
      const low = toNumber(lo) ?? Number.NEGATIVE_INFINITY;
      const high = toNumber(hi) ?? Number.POSITIVE_INFINITY;
      rows = rows.filter(row => {
        const timestamp = toNumber(row['timestamp']) ?? 0;
        return timestamp >= low && timestamp <= high;
      });
      rest = tail;
    } else if (statement.includes('NETWORK_TYPE = ?')) {
      const [networkType, ...tail] = rest;
      rows = rows.filter(row => row['network_type'] === networkType);
      rest = tail;
    } else if (statement.includes('LATITUDE BETWEEN ? AND ?')) {
      const [minLat, maxLat, minLng, maxLng, ...tail] = rest;
      rows = rows.filter(row => {
        const lat = toNumber(row['latitude']);
        const lng = toNumber(row['longitude']);
        return (
          lat !== null &&
          lng !== null &&
          lat >= (toNumber(minLat) ?? lat) &&
          lat <= (toNumber(maxLat) ?? lat) &&
          lng >= (toNumber(minLng) ?? lng) &&
          lng <= (toNumber(maxLng) ?? lng)
        );
      });
      rest = tail;
    }
    rows.sort(
      (a, b) => (toNumber(a['timestamp']) ?? 0) - (toNumber(b['timestamp']) ?? 0),
    );
    return {
      rows: this.applyPaging(rows, statement, rest) as unknown as DbRow[],
      rowsAffected: 0,
    };
  }

  private applyPaging<T>(rows: T[], statement: string, params: DbScalar[]): T[] {
    let out = rows;
    let rest = [...params];
    // Builders emit LIMIT before OFFSET; LIMIT -1 means "offset only".
    if (statement.includes('LIMIT ?')) {
      const [limit, ...tail] = rest;
      rest = tail;
      const count = toNumber(limit);
      if (count !== null && count >= 0) {
        out = out.slice(0, count);
      }
    } else if (statement.includes('LIMIT -1')) {
      // No-op: offset still applies below.
    }
    if (statement.includes('OFFSET ?')) {
      const [offset] = rest;
      const skip = toNumber(offset);
      if (skip !== null && skip > 0) {
        out = out.slice(skip);
      }
    }
    return out;
  }
}
