import { runProbeBatch } from '../probe';
import { DEFAULT_PROBE_HOSTS } from '../types';
import type { ProbeConfig } from '../types';
import { FakeTransport } from '../testing/fakeTransport';

function config(overrides: Partial<ProbeConfig> = {}): ProbeConfig {
  return {
    hosts: ['1.1.1.1', '8.8.8.8'],
    port: 443,
    samplesPerHost: 2,
    timeoutMs: 1000,
    intervalMs: 50,
    ...overrides,
  };
}

test('probes every host with incrementing sequence IDs', async () => {
  const transport = new FakeTransport(() => ({ ok: true, rttMs: 12 }));
  const results = await runProbeBatch(transport, config());
  expect(results).toHaveLength(4);
  expect(results.map(r => r.seq)).toEqual([1, 2, 3, 4]);
  expect(results.map(r => r.host)).toEqual([
    '1.1.1.1',
    '1.1.1.1',
    '8.8.8.8',
    '8.8.8.8',
  ]);
  expect(results.every(r => r.rttMs === 12 && r.timedOut === false)).toBe(true);
  expect(transport.probeCalls.every(c => c.port === 443 && c.timeoutMs === 1000)).toBe(
    true,
  );
});

test('honors a custom first sequence ID', async () => {
  const transport = new FakeTransport(() => ({ ok: true, rttMs: 5 }));
  const results = await runProbeBatch(transport, config({ samplesPerHost: 1 }), {
    firstSequenceId: 41,
  });
  expect(results.map(r => r.seq)).toEqual([41, 42]);
});

test('timeout errors flag timedOut, refusals do not', async () => {
  const transport = new FakeTransport((host, index) =>
    host === '1.1.1.1'
      ? { ok: false, error: 'timeout' }
      : index === 0
        ? { ok: false, error: 'connect ECONNREFUSED 8.8.8.8:443' }
        : { ok: true, rttMs: 9 },
  );
  const results = await runProbeBatch(transport, config());
  const hostA = results.filter(r => r.host === '1.1.1.1');
  expect(hostA.every(r => r.rttMs === null && r.timedOut)).toBe(true);
  const refused = results.find(r => r.host === '8.8.8.8' && r.rttMs === null);
  expect(refused).toBeDefined();
  expect(refused?.timedOut).toBe(false);
  expect(refused?.error).toMatch('ECONNREFUSED');
});

test('a throwing transport becomes failed probes, never a rejected batch', async () => {
  const transport = new FakeTransport();
  transport.throwOnProbe = new Error('native bridge down');
  const results = await runProbeBatch(transport, config({ samplesPerHost: 1 }));
  expect(results).toHaveLength(2);
  expect(results.every(r => r.rttMs === null && r.timedOut === false)).toBe(true);
  expect(results[0]?.error).toBe('native bridge down');
});

test('negative RTTs are rejected as invalid measurements', async () => {
  const transport = new FakeTransport(() => ({ ok: true, rttMs: -3 }));
  const results = await runProbeBatch(transport, config({ samplesPerHost: 1 }));
  expect(results.every(r => r.rttMs === null)).toBe(true);
  expect(results[0]?.error).toBe('invalid-rtt');
});

test('empty hosts fall back to the ADR-4 defaults', async () => {
  const transport = new FakeTransport(() => ({ ok: true, rttMs: 7 }));
  const results = await runProbeBatch(
    transport,
    config({ hosts: [], samplesPerHost: 1 }),
  );
  expect(results.map(r => r.host)).toEqual([...DEFAULT_PROBE_HOSTS]);
});

test('paces consecutive probes but never sleeps after the last one', async () => {
  const transport = new FakeTransport(() => ({ ok: true, rttMs: 7 }));
  const delays: number[] = [];
  await runProbeBatch(transport, config(), {
    delay: async ms => {
      delays.push(ms);
    },
  });
  // 4 probes -> 3 gaps.
  expect(delays).toEqual([50, 50, 50]);
});
