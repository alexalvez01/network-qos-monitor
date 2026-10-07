import { runAndPublishMeasurement, runHeadlessMeasurement } from '../engine';
import type { EngineConfig } from '../engine';
import {
  __resetMeasurementStoreForTests,
  useMeasurementStore,
} from '../measurementStore';
import { FakeTransport, fixedRtts } from '../testing/fakeTransport';

function config(): EngineConfig {
  return {
    probe: {
      hosts: ['1.1.1.1', '8.8.8.8'],
      port: 443,
      samplesPerHost: 3,
      timeoutMs: 1000,
      intervalMs: 10,
    },
    throughput: {
      host: '10.0.0.1',
      port: 3000,
      downloadPath: '/download',
      downloadBytes: 1000000,
      uploadPath: '/upload',
      uploadBytes: 500000,
      timeoutMs: 15000,
      includeDownload: true,
      includeUpload: true,
    },
  };
}

/** Deterministic clock: every read advances 100ms. */
function tickingClock(): () => number {
  let t = 1000;
  return () => {
    t += 100;
    return t;
  };
}

beforeEach(() => {
  __resetMeasurementStoreForTests();
});

test('headless run produces a complete measurement set', async () => {
  const rtts1111 = fixedRtts([20, 30, 40]);
  const transport = new FakeTransport(
    (host, index) =>
      host === '1.1.1.1' ? rtts1111(host, index) : { ok: false, error: 'timeout' },
    { ok: true, bytesTransferred: 1000000, elapsedMs: 2000 },
    { ok: true, bytesTransferred: 500000, elapsedMs: 1000 },
  );
  const set = await runHeadlessMeasurement(transport, config(), {
    now: tickingClock(),
    delay: async () => {},
  });

  expect(set.startedAt).toBeLessThanOrEqual(set.endedAt);
  expect(set.hosts).toHaveLength(2);
  expect(set.hosts[0]?.host).toBe('1.1.1.1');
  expect(set.hosts[1]?.host).toBe('8.8.8.8');

  const first = set.hosts[0];
  expect(first?.sent).toBe(3);
  expect(first?.answered).toBe(3);
  expect(first?.lossRatio).toBe(0);
  expect(first?.rtt.meanMs).toBe(30);
  expect(first?.rtt.jitterMs).toBe(10);

  const second = set.hosts[1];
  expect(second?.lossRatio).toBe(1);
  expect(second?.rtt.count).toBe(0);
  expect(second?.rtt.meanMs).toBeNull();

  expect(set.download?.ok).toBe(true);
  expect(set.download?.mbps).toBe(4);
  expect(transport.downloadCalls[0]?.path).toBe('/download?bytes=1000000');
  expect(set.upload?.ok).toBe(true);
  expect(set.upload?.mbps).toBe(4);
});

test('runAndPublish updates the store and clears the running flag', async () => {
  const transport = new FakeTransport(fixedRtts([10, 20]));
  const set = await runAndPublishMeasurement(transport, config(), {
    now: tickingClock(),
    delay: async () => {},
  });

  const state = useMeasurementStore.getState();
  expect(state.running).toBe(false);
  expect(state.lastError).toBeNull();
  expect(state.latest).toBe(set);
  expect(state.history).toHaveLength(1);

  await runAndPublishMeasurement(transport, config(), {
    now: tickingClock(),
    delay: async () => {},
  });
  expect(useMeasurementStore.getState().history).toHaveLength(2);
});

test('an all-failed run still produces and publishes a set', async () => {
  const transport = new FakeTransport(() => ({ ok: false, error: 'timeout' }));
  const set = await runAndPublishMeasurement(
    transport,
    { probe: config().probe, throughput: null },
    { now: tickingClock(), delay: async () => {} },
  );
  expect(set.hosts.every(h => h.lossRatio === 1)).toBe(true);
  expect(set.download).toBeNull();
  expect(set.upload).toBeNull();
  expect(useMeasurementStore.getState().latest).toBe(set);
  expect(useMeasurementStore.getState().lastError).toBeNull();
});
