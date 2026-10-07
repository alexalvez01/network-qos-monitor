import {
  describeRtt,
  jitterRfc3550,
  lossRatio,
  lossRatioOfResults,
  mbps,
  percentile,
  summarizeHost,
} from '../stats';
import type { ProbeResult } from '../types';

function probe(seq: number, rttMs: number | null): ProbeResult {
  return {
    seq,
    host: '1.1.1.1',
    port: 443,
    rttMs,
    timedOut: rttMs === null,
    startedAt: 0,
    endedAt: 1,
  };
}

test('jitter is the mean absolute successive difference', () => {
  // |20-10| + |30-20| over 2 steps = 10.
  expect(jitterRfc3550([10, 20, 30])).toBe(10);
  expect(jitterRfc3550([30, 10, 20])).toBeCloseTo(15, 10);
});

test('jitter is 0 for constant or single samples, null for empty', () => {
  expect(jitterRfc3550([25, 25, 25, 25])).toBe(0);
  expect(jitterRfc3550([25])).toBe(0);
  expect(jitterRfc3550([])).toBeNull();
});

test('loss ratio counts unanswered probes over the window', () => {
  expect(lossRatio(4, 3)).toBe(0.25);
  expect(lossRatio(4, 4)).toBe(0);
  expect(lossRatio(4, 0)).toBe(1);
  expect(lossRatio(0, 0)).toBeNull();
  expect(lossRatioOfResults([probe(1, 10), probe(2, 20), probe(3, null)])).toBeCloseTo(
    1 / 3,
    10,
  );
  expect(lossRatioOfResults([])).toBeNull();
});

test('mbps follows bytes-over-time with zero-duration guards', () => {
  // 1,000,000 bytes in 1s = 8 Mbps.
  expect(mbps(1000000, 1000)).toBe(8);
  expect(mbps(500000, 2000)).toBe(2);
  expect(mbps(1000000, 0)).toBe(0);
  expect(mbps(0, 1000)).toBe(0);
  expect(mbps(-5, 1000)).toBe(0);
  expect(mbps(1000, -100)).toBe(0);
  expect(mbps(NaN, 1000)).toBe(0);
  const finite = mbps(1000000, 1000);
  expect(Number.isFinite(finite)).toBe(true);
});

test('percentiles interpolate between closest ranks', () => {
  expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  expect(percentile([10], 90)).toBe(10);
  expect(percentile([1, 2, 3, 4], 0)).toBe(1);
  expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  expect(percentile([], 50)).toBeNull();
});

test('describeRtt summarizes answered samples in order', () => {
  const summary = describeRtt([10, 20, 30, 40]);
  expect(summary.count).toBe(4);
  expect(summary.minMs).toBe(10);
  expect(summary.maxMs).toBe(40);
  expect(summary.meanMs).toBe(25);
  expect(summary.p50Ms).toBe(25);
  expect(summary.jitterMs).toBe(10);
  expect(summary.p90Ms).toBeCloseTo(37, 10);
  expect(summary.p95Ms).toBeCloseTo(38.5, 10);
});

test('describeRtt of an empty set is nulls with count 0', () => {
  const summary = describeRtt([]);
  expect(summary.count).toBe(0);
  expect(summary.minMs).toBeNull();
  expect(summary.meanMs).toBeNull();
  expect(summary.p50Ms).toBeNull();
  expect(summary.jitterMs).toBeNull();
});

test('summarizeHost splits loss from RTT cleanly', () => {
  const measurement = summarizeHost('8.8.8.8', 443, [
    probe(1, 10),
    probe(2, null),
    probe(3, 30),
    probe(4, null),
  ]);
  expect(measurement.host).toBe('8.8.8.8');
  expect(measurement.sent).toBe(4);
  expect(measurement.answered).toBe(2);
  expect(measurement.lossRatio).toBe(0.5);
  expect(measurement.rtt.count).toBe(2);
  expect(measurement.rtt.meanMs).toBe(20);
  expect(measurement.rtt.jitterMs).toBe(20);
});
