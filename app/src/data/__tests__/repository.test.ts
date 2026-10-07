import type { MeasurementSet } from '../../measurement/types';
import { FakeDatabase } from '../testing/fakeDatabase';
import {
  DatabaseError,
  MeasurementRepository,
  MissingCoordinatesError,
  SessionNotFoundError,
  generateSessionId,
  measurementSetToSamples,
} from '../repository';

function measurementSet(): MeasurementSet {
  return {
    startedAt: 1000,
    endedAt: 2000,
    hosts: [
      {
        host: '1.1.1.1',
        port: 443,
        sent: 4,
        answered: 3,
        lossRatio: 0.25,
        rtt: {
          count: 3,
          minMs: 20,
          maxMs: 40,
          meanMs: 30,
          p50Ms: 30,
          p90Ms: 38,
          p95Ms: 39,
          jitterMs: 10,
        },
      },
      {
        host: '8.8.8.8',
        port: 443,
        sent: 4,
        answered: 0,
        lossRatio: 1,
        rtt: {
          count: 0,
          minMs: null,
          maxMs: null,
          meanMs: null,
          p50Ms: null,
          p90Ms: null,
          p95Ms: null,
          jitterMs: null,
        },
      },
    ],
    download: {
      direction: 'download',
      bytesTransferred: 1000000,
      elapsedMs: 2000,
      mbps: 4,
      ok: true,
      startedAt: 1100,
      endedAt: 3100,
    },
    upload: null,
  };
}

const POSITION = { latitude: -32.48, longitude: -58.23, accuracy: 10 };

async function seeded(): Promise<{
  db: FakeDatabase;
  repo: MeasurementRepository;
  sessionId: string;
}> {
  const db = new FakeDatabase();
  const repo = new MeasurementRepository(db);
  await repo.init();
  const session = await repo.createSession({ startedAt: 1000 });
  return { db, repo, sessionId: session.id };
}

test('init runs the schema and sessions start open-ended', async () => {
  const { db, repo } = await seeded();
  expect(db.calls.length).toBeGreaterThan(0);
  const session = await repo.getSession('missing');
  expect(session).toBeNull();
  const listed = await repo.listSessions();
  expect(listed).toHaveLength(1);
  expect(listed[0]?.endedAt).toBeNull();
});

test('generated session ids are unique per walk', () => {
  expect(generateSessionId(1000)).not.toBe(generateSessionId(1000));
});

test('a set persists one row per host with timestamp and coordinates', async () => {
  const { db, repo, sessionId } = await seeded();
  const saved = await repo.saveMeasurementSet(sessionId, measurementSet(), {
    position: POSITION,
    networkType: 'lte',
    timestamp: 2000,
  });
  expect(saved).toHaveLength(2);
  expect(db.sampleCount).toBe(2);
  expect(saved[0]).toMatchObject({
    sessionId,
    timestamp: 2000,
    latitude: -32.48,
    longitude: -58.23,
    networkType: 'lte',
    host: '1.1.1.1',
    downloadMbps: 4,
    uploadMbps: null,
  });
  expect(saved[1]?.rttMeanMs).toBeNull();
  expect(saved[1]?.lossRatio).toBe(1);
  // Answered rows keep their statistics; unanswered rows keep nulls.
  expect(saved[0]?.rttMeanMs).toBe(30);
  expect(saved.map(row => row.id)).toEqual([1, 2]);
});

test('queries filter by date, network type, and bounding box', async () => {
  const { repo, sessionId } = await seeded();
  await repo.saveMeasurementSet(sessionId, measurementSet(), {
    position: POSITION,
    networkType: 'lte',
    timestamp: 2000,
  });
  await repo.saveMeasurementSet(sessionId, measurementSet(), {
    position: { latitude: -34.9, longitude: -56.16, accuracy: null },
    networkType: 'nr',
    timestamp: 9000,
  });

  expect(await repo.findByDateRange(0, 5000)).toHaveLength(2);
  expect(await repo.findByDateRange(5000, 99999)).toHaveLength(2);
  expect(await repo.findByDateRange(3000, 4000)).toHaveLength(0);

  const lte = await repo.findByNetworkType('lte');
  expect(lte).toHaveLength(2);
  expect(await repo.findByNetworkType('wifi')).toHaveLength(0);

  const uruguay = await repo.findByBoundingBox({
    minLat: -35,
    maxLat: -30,
    minLng: -59,
    maxLng: -53,
  });
  expect(uruguay).toHaveLength(4);
  const tight = await repo.findByBoundingBox({
    minLat: -32.5,
    maxLat: -32.4,
    minLng: -58.3,
    maxLng: -58.2,
  });
  expect(tight).toHaveLength(2);
});

test('session with its samples round-trips; missing session is null', async () => {
  const { repo, sessionId } = await seeded();
  const empty = await repo.getSessionWithSamples(sessionId);
  expect(empty?.session.id).toBe(sessionId);
  expect(empty?.samples).toEqual([]);

  await repo.saveMeasurementSet(sessionId, measurementSet(), {
    position: POSITION,
    networkType: null,
    timestamp: 2000,
  });
  const full = await repo.getSessionWithSamples(sessionId);
  expect(full?.samples).toHaveLength(2);
  expect(full?.samples[0]?.timestamp).toBeLessThanOrEqual(
    full?.samples[1]?.timestamp ?? 0,
  );

  await expect(repo.getSessionWithSamples('nope')).resolves.toBeNull();
});

test('ending a session stamps it; ending a missing one is null', async () => {
  const { repo, sessionId } = await seeded();
  const ended = await repo.endSession(sessionId, 5000);
  expect(ended?.endedAt).toBe(5000);
  await expect(repo.endSession('nope', 5000)).resolves.toBeNull();
});

test('missing coordinates abort the write without touching storage', async () => {
  const { db, repo, sessionId } = await seeded();
  const set = measurementSet();
  await expect(
    repo.saveMeasurementSet(sessionId, set, { position: null }),
  ).rejects.toThrow(MissingCoordinatesError);
  await expect(
    repo.saveMeasurementSet(sessionId, set, {
      position: { latitude: NaN, longitude: -58.23, accuracy: null },
    }),
  ).rejects.toThrow(MissingCoordinatesError);
  expect(db.sampleCount).toBe(0);
  // Pure mapper rejects the same way, before any SQL is built.
  expect(() =>
    measurementSetToSamples(sessionId, set, { position: undefined }),
  ).toThrow(MissingCoordinatesError);
});

test('unknown session aborts the write', async () => {
  const { db, repo } = await seeded();
  await expect(
    repo.saveMeasurementSet('ghost', measurementSet(), {
      position: POSITION,
      timestamp: 2000,
    }),
  ).rejects.toThrow(SessionNotFoundError);
  expect(db.sampleCount).toBe(0);
});

test('storage failures surface as DatabaseError', async () => {
  const { repo } = await seeded();
  const failing = new FakeDatabase();
  const badRepo = new MeasurementRepository(failing);
  failing.failWith = new Error('disk full');
  await expect(badRepo.init()).rejects.toThrow(DatabaseError);
  await expect(badRepo.listSessions()).rejects.toThrow(DatabaseError);
  expect(repo).toBeDefined();
});

test('paging limits history reads', async () => {
  const { repo, sessionId } = await seeded();
  await repo.saveMeasurementSet(sessionId, measurementSet(), {
    position: POSITION,
    timestamp: 2000,
  });
  const page = await repo.getSamplesBySession(sessionId, { limit: 1 });
  expect(page).toHaveLength(1);
});
