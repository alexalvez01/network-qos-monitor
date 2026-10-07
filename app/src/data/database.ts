/**
 * Database seam for Stage 4 (RF-04, ADR-6).
 *
 * This is the ONLY data-layer module allowed to import the native
 * `op-sqlite` package. schema.ts, queries.ts, repository.ts and geo.ts
 * never import this file's native half — they depend on the Database
 * interface via `import type`, which is erased at compile time, so Jest
 * on Windows never loads the native module. Unit tests inject the
 * in-memory fake from testing/fakeDatabase.ts instead.
 */

import { open } from '@op-engineering/op-sqlite';
import { DATABASE_NAME } from './schema';

export type DbScalar = string | number | boolean | null;
export type DbRow = Record<string, DbScalar | ArrayBuffer | ArrayBufferView>;

export interface DbResult {
  rows: DbRow[];
  insertId?: number;
  rowsAffected: number;
}

export interface Database {
  execute(sql: string, params?: DbScalar[]): Promise<DbResult>;
  close(): Promise<void>;
}

/** op-sqlite failed to open — storage is unavailable, not just empty. */
export class DatabaseOpenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'DatabaseOpenError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Open the app database on device. Never call under Jest: `open` installs
 * JSI bindings through the native module. Throws DatabaseOpenError when
 * the file cannot be created or opened.
 */
export function openAppDatabase(name: string = DATABASE_NAME): Database {
  let native: ReturnType<typeof open>;
  try {
    native = open({ name });
  } catch (err) {
    throw new DatabaseOpenError(
      `could not open database "${name}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
  return {
    execute: async (sql: string, params?: DbScalar[]): Promise<DbResult> => {
      const result = params
        ? await native.execute(sql, params)
        : await native.execute(sql);
      return {
        rows: result.rows as DbRow[],
        insertId: result.insertId,
        rowsAffected: result.rowsAffected,
      };
    },
    close: async (): Promise<void> => {
      native.close();
    },
  };
}
