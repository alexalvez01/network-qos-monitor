import {
  filterSummaries,
  formatDuration,
  formatLatency,
  formatThroughput,
  formatTimestamp,
  summarizeSession,
} from '../history/history';
import type { SessionSummary } from '../history/history';
import type { SampleRecord, SessionRecord } from '../../data/types';

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    startedAt: 1000,
    endedAt: 2000,
    name: 'Evening walk',
    ...overrides,
  };
}

function sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: 1,
    sessionId: 's1',
    timestamp: 1000,
    latitude: -32.484,
    longitude: -58.232,
    accuracy: 8,
    networkType: 'lte',
    host: '1.1.1.1',
    port: 443,
    sent: 4,
    answered: 4,
    lossRatio: 0,
    rttMinMs: 70,
    rttMaxMs: 95,
    rttMeanMs: 80,
    rttP50Ms: 80,
    rttP90Ms: 90,
    rttP95Ms: 93,
    rttJitterMs: 5,
    downloadMbps: 12,
    uploadMbps: 5,
    ...overrides,
  };
}

describe('summarizeSession', () => {
  test('aggregates the row the list renders', () => {
    const summary = summarizeSession(session(), [
      sample({ rttMeanMs: 80, downloadMbps: 12, networkType: 'lte' }),
      sample({ rttMeanMs: 100, downloadMbps: 20, networkType: 'nr' }),
    ]);
    expect(summary.sampleCount).toBe(2);
    expect(summary.meanLatencyMs).toBe(90);
    expect(summary.maxThroughputMbps).toBe(20);
    expect(summary.networkTypes).toEqual(['lte', 'nr']);
    expect(summary.bounds).not.toBeNull();
  });

  test('an empty session is zeros and nulls, never NaN', () => {
    const summary = summarizeSession(session(), []);
    expect(summary.sampleCount).toBe(0);
    expect(summary.meanLatencyMs).toBeNull();
    expect(summary.maxThroughputMbps).toBeNull();
    expect(summary.networkTypes).toEqual([]);
    expect(summary.bounds).toBeNull();
  });

  test('null readings are skipped, not averaged as zero', () => {
    const summary = summarizeSession(session(), [
      sample({ rttMeanMs: null, downloadMbps: null, networkType: null }),
    ]);
    expect(summary.meanLatencyMs).toBeNull();
    expect(summary.maxThroughputMbps).toBeNull();
    expect(summary.networkTypes).toEqual([]);
  });
});

describe('filterSummaries', () => {
  function summaries(): SessionSummary[] {
    return [
      summarizeSession(session({ id: 'a', startedAt: 1000, name: 'Park walk' }), [
        sample({ networkType: 'lte' }),
      ]),
      summarizeSession(
        session({ id: 'b', startedAt: 5000, name: 'Riverside run' }),
        [sample({ networkType: 'nr' })],
      ),
      summarizeSession(session({ id: 'c', startedAt: 9000, name: null }), [
        sample({ networkType: 'lte' }),
      ]),
    ];
  }

  test('no filter returns everything', () => {
    expect(filterSummaries(summaries(), {})).toHaveLength(3);
  });

  test('network type keeps only matching sessions', () => {
    const out = filterSummaries(summaries(), { networkType: 'nr' });
    expect(out.map(s => s.session.id)).toEqual(['b']);
  });

  test('date window is inclusive and tolerates inverted edges', () => {
    expect(
      filterSummaries(summaries(), { startMs: 1000, endMs: 5000 }),
    ).toHaveLength(2);
    expect(
      filterSummaries(summaries(), { startMs: 5000, endMs: 1000 }),
    ).toHaveLength(2);
    expect(filterSummaries(summaries(), { startMs: 8000 })).toHaveLength(1);
  });

  test('query matches names case-insensitively; nameless never matches', () => {
    expect(
      filterSummaries(summaries(), { query: 'park' }).map(s => s.session.id),
    ).toEqual(['a']);
    expect(
      filterSummaries(summaries(), { query: 'WALK' }).map(s => s.session.id),
    ).toEqual(['a']);
    expect(filterSummaries(summaries(), { query: 'zzz' })).toHaveLength(0);
  });
});

describe('formatting', () => {
  test('timestamps are UTC and deterministic', () => {
    expect(formatTimestamp(0)).toBe('1970-01-01 00:00 UTC');
    expect(formatTimestamp(NaN)).toBe('Unknown time');
  });

  test('durations scale from seconds to hours', () => {
    expect(formatDuration(0, 45000)).toBe('45 s');
    expect(formatDuration(0, 12 * 60000)).toBe('12 min');
    expect(formatDuration(0, (2 * 60 + 5) * 60000)).toBe('2 h 5 min');
    expect(formatDuration(0, null)).toBe('Ongoing');
    expect(formatDuration(NaN, 100)).toBe('Unknown duration');
  });

  test('missing readings are labeled, never rendered as zero', () => {
    expect(formatLatency(null)).toBe('No data');
    expect(formatLatency(82.4)).toBe('82 ms');
    expect(formatThroughput(null)).toBe('No data');
    expect(formatThroughput(12.34)).toBe('12.3 Mbps');
  });
});
