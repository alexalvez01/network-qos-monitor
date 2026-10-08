/**
 * Device-side persistence for measurement settings (RF-02 configurable
 * hosts). One JSON value in the `app_settings` key/value table, created by
 * the schema migrations. Parsing and validation live in settingsStore.ts;
 * this file only moves the string in and out of SQLite.
 */

import type { Database } from '../data/database';
import { MeasurementRepository } from '../data/repository';
import { parseSettings, serializeSettings } from './settingsStore';
import type { MeasurementSettings } from './settingsStore';

const SETTINGS_KEY = 'measurement';

async function ready(db: Database): Promise<Database> {
  // init() applies the migrations that create app_settings.
  await new MeasurementRepository(db).init();
  return db;
}

export async function loadSettings(db: Database): Promise<MeasurementSettings> {
  const result = await (await ready(db)).execute(
    'SELECT value FROM app_settings WHERE key = ?;',
    [SETTINGS_KEY],
  );
  const value = result.rows[0]?.value;
  return parseSettings(typeof value === 'string' ? value : null);
}

export async function saveSettings(
  db: Database,
  settings: MeasurementSettings,
): Promise<void> {
  await (await ready(db)).execute(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);',
    [SETTINGS_KEY, serializeSettings(settings)],
  );
}
