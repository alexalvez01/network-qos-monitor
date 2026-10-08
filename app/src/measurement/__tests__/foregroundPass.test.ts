import { networkTypeLabel, runForegroundPass } from '../foregroundPass';
import type { RadioSnapshot } from '../foregroundPass';
import { FakeTransport } from '../testing/fakeTransport';
import { FakeDatabase } from '../../data/testing/fakeDatabase';
import { FakeGeoLocator } from '../../data/testing/fakeGeoLocator';
import { GeoError } from '../../data/geo';
import { MeasurementRepository } from '../../data/repository';
import {
  __resetMeasurementStoreForTests,
  useMeasurementStore,
} from '../measurementStore';
import { DEFAULT_PROBE_CONFIG, DEFAULT_THROUGHPUT_CONFIG } from '../types';
import type { EngineConfig } from '../engine';

const CONFIG: EngineConfig = {
  probe: { ...DEFAULT_PROBE_CONFIG, samplesPerHost: 2, intervalMs: 0 },
  throughput: DEFAULT_THROUGHPUT_CONFIG,
};
const RADIO: RadioSnapshot = { networkType: 'lte', signalDbm: -91 };
const RUN = { delay: async () => undefined };

async function repositoryWithSession() {
  const repository = new MeasurementRepository(new FakeDatabase());
  await repository.init();
  const session = await repository.createSession({ startedAt: 1, name: 'walk' });
  return { repository, sessionId: session.id };
}

beforeEach(() => {
  __resetMeasurementStoreForTests();
});

test('a pass inside a walk publishes the set and stores one row per host with radio data', async () => {
  const { repository, sessionId } = await repositoryWithSession();
  const result = await runForegroundPass(CONFIG, {
    transport: new FakeTransport(),
    repository,
    sessionId,
    locator: new FakeGeoLocator(),
    radio: () => RADIO,
    run: RUN,
  });

  expect(result.save).toEqual({ status: 'saved', rows: 3 });
  expect(result.set.download?.mbps).toBeGreaterThan(0);
  expect(useMeasurementStore.getState().latest).toBe(result.set);
  const rows = await repository.getSamplesBySession(sessionId);
  expect(rows).toHaveLength(3);
  expect(rows[0]?.networkType).toBe('lte');
  expect(rows[0]?.signalDbm).toBe(-91);
  expect(rows[0]?.downloadMbps).toBe(result.set.download?.mbps);
});

test('without an active walk the pass is measured but not stored', async () => {
  const result = await runForegroundPass(CONFIG, {
    transport: new FakeTransport(),
    repository: null,
    sessionId: null,
    locator: new FakeGeoLocator(),
    radio: () => RADIO,
    run: RUN,
  });
  expect(result.save.status).toBe('no-session');
  expect(useMeasurementStore.getState().latest).toBe(result.set);
});

test('a missing GPS fix is reported and nothing is written', async () => {
  const { repository, sessionId } = await repositoryWithSession();
  const locator = new FakeGeoLocator();
  locator.enqueueError(new GeoError('timeout', 'gps cold'));
  const result = await runForegroundPass(CONFIG, {
    transport: new FakeTransport(),
    repository,
    sessionId,
    locator,
    radio: () => RADIO,
    run: RUN,
  });
  expect(result.save).toEqual({ status: 'no-fix', reason: 'gps cold' });
  expect(result.position).toBeNull();
  expect(await repository.getSamplesBySession(sessionId)).toHaveLength(0);
});

test('a storage failure keeps the measurement and reports the reason', async () => {
  const repository = new MeasurementRepository(new FakeDatabase());
  await repository.init();
  const result = await runForegroundPass(CONFIG, {
    transport: new FakeTransport(),
    repository,
    sessionId: 'missing-session',
    locator: new FakeGeoLocator(),
    radio: () => RADIO,
    run: RUN,
  });
  expect(result.save.status).toBe('failed');
  expect(result.set.hosts).toHaveLength(3);
});

test('networkTypeLabel normalizes NetInfo and radio state', () => {
  expect(
    networkTypeLabel({ type: 'wifi', subtype: null, cellularGeneration: null }),
  ).toBe('wifi');
  expect(
    networkTypeLabel({ type: 'cellular', subtype: 'LTE', cellularGeneration: '4g' }),
  ).toBe('lte');
  expect(
    networkTypeLabel({ type: 'cellular', subtype: null, cellularGeneration: '5g' }),
  ).toBe('5g');
  expect(
    networkTypeLabel({ type: 'UNKNOWN', subtype: null, cellularGeneration: null }),
  ).toBeNull();
});
