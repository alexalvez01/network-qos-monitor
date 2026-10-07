import {
  DEFAULT_DEGRADATION_THRESHOLDS,
  detectDegradation,
} from '../degradation';
import type {
  HostMeasurement,
  MeasurementSet,
} from '../../measurement/types';

function host(
  name: string,
  overrides: {
    meanMs?: number | null;
    jitterMs?: number | null;
    lossRatio?: number | null;
  } = {},
): HostMeasurement {
  return {
    host: name,
    port: 443,
    sent: 4,
    answered: 4,
    lossRatio: overrides.lossRatio ?? 0,
    rtt: {
      count: 4,
      minMs: 10,
      maxMs: 50,
      meanMs: overrides.meanMs ?? 30,
      p50Ms: 30,
      p90Ms: 45,
      p95Ms: 48,
      jitterMs: overrides.jitterMs ?? 5,
    },
  };
}

function set(hosts: HostMeasurement[]): MeasurementSet {
  return { startedAt: 1000, endedAt: 2000, hosts, download: null, upload: null };
}

test('healthy pass yields null', () => {
  expect(detectDegradation(set([host('1.1.1.1')]))).toBeNull();
});

test('empty pass is nothing measured, not degradation', () => {
  expect(detectDegradation(set([]))).toBeNull();
});

test('mean RTT breach names the host and the threshold', () => {
  const reason = detectDegradation(set([host('1.1.1.1', { meanMs: 452 })]));
  expect(reason).toContain('1.1.1.1');
  expect(reason).toContain('452ms');
  expect(reason).toContain(`${DEFAULT_DEGRADATION_THRESHOLDS.rttMeanMs}ms`);
});

test('jitter breach is reported', () => {
  const reason = detectDegradation(set([host('8.8.8.8', { jitterMs: 150 })]));
  expect(reason).toContain('8.8.8.8');
  expect(reason).toContain('jitter');
});

test('loss breach is reported as a percentage', () => {
  const reason = detectDegradation(
    set([host('9.9.9.9', { lossRatio: 0.25 })]),
  );
  expect(reason).toContain('9.9.9.9');
  expect(reason).toContain('25%');
});

test('total outage notifies through the loss threshold', () => {
  const down = host('1.1.1.1', {
    meanMs: null,
    jitterMs: null,
    lossRatio: 1,
  });
  const reason = detectDegradation(set([down]));
  expect(reason).toContain('1.1.1.1');
  expect(reason).toContain('100%');
});

test('at-threshold values are not breaches', () => {
  const exact = host('1.1.1.1', {
    meanMs: DEFAULT_DEGRADATION_THRESHOLDS.rttMeanMs,
    jitterMs: DEFAULT_DEGRADATION_THRESHOLDS.jitterMs,
    lossRatio: DEFAULT_DEGRADATION_THRESHOLDS.lossRatio,
  });
  expect(detectDegradation(set([exact]))).toBeNull();
});

test('missing aggregates are skipped, not treated as zero', () => {
  const silent = host('1.1.1.1', {
    meanMs: null,
    jitterMs: null,
    lossRatio: null,
  });
  expect(detectDegradation(set([silent]))).toBeNull();
});

test('multiple breaches join into one reason string', () => {
  const reason = detectDegradation(
    set([
      host('1.1.1.1', { meanMs: 500 }),
      host('8.8.8.8', { lossRatio: 0.5 }),
    ]),
  );
  expect(reason).toContain('1.1.1.1');
  expect(reason).toContain('8.8.8.8');
});

test('custom thresholds override the defaults', () => {
  const warm = set([host('1.1.1.1', { meanMs: 120 })]);
  expect(
    detectDegradation(warm, { rttMeanMs: 100, jitterMs: 100, lossRatio: 0.1 }),
  ).not.toBeNull();
  expect(
    detectDegradation(warm, { rttMeanMs: 200, jitterMs: 100, lossRatio: 0.1 }),
  ).toBeNull();
});
