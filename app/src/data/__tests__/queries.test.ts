import {
  insertSample,
  insertSession,
  normalizeBoundingBox,
  selectSamplesByBoundingBox,
  selectSamplesByDateRange,
  selectSamplesByNetworkType,
  selectSamplesBySession,
  selectSessionById,
  selectSessions,
  updateSessionEnd,
} from '../queries';
import type { NewSampleInput } from '../types';

function sample(): NewSampleInput {
  return {
    sessionId: 's1',
    timestamp: 2000,
    latitude: -32.48,
    longitude: -58.23,
    accuracy: 10,
    networkType: 'lte',
    host: '1.1.1.1',
    port: 443,
    sent: 4,
    answered: 3,
    lossRatio: 0.25,
    rttMinMs: 20,
    rttMaxMs: 40,
    rttMeanMs: 30,
    rttP50Ms: 30,
    rttP90Ms: 38,
    rttP95Ms: 39,
    rttJitterMs: 10,
    downloadMbps: 4,
    uploadMbps: 2,
    signalDbm: null,
  };
}

test('session writes carry id, start, open end, and name', () => {
  const spec = insertSession('s1', 1000, 'evening walk');
  expect(spec.sql).toMatch(/INSERT INTO sessions/);
  expect(spec.params).toEqual(['s1', 1000, null, 'evening walk']);
  expect(updateSessionEnd('s1', 2000).params).toEqual([2000, 's1']);
  expect(selectSessionById('s1').params).toEqual(['s1']);
  expect(selectSessions().sql).toMatch(/ORDER BY started_at DESC/);
});

test('sample insert binds every column positionally', () => {
  const spec = insertSample(sample());
  const placeholders = (spec.sql.match(/\?/g) ?? []).length;
  expect(placeholders).toBe(spec.params.length);
  expect(placeholders).toBeGreaterThan(15);
  expect(spec.params[0]).toBe('s1');
  expect(spec.params).toContain('1.1.1.1');
  expect(spec.params).toContain('lte');
});

test('date-range queries order inverted edges', () => {
  const spec = selectSamplesByDateRange(3000, 1000);
  expect(spec.sql).toMatch(/timestamp BETWEEN \? AND \?/);
  expect(spec.params.slice(0, 2)).toEqual([1000, 3000]);
  expect(spec.sql).toMatch(/ORDER BY timestamp ASC/);
});

test('network-type filter is an equality predicate', () => {
  const spec = selectSamplesByNetworkType('nr');
  expect(spec.sql).toMatch(/network_type = \?/);
  expect(spec.params[0]).toBe('nr');
});

test('bounding box binds latitude range before longitude range', () => {
  const spec = selectSamplesByBoundingBox({
    minLat: -33,
    maxLat: -32,
    minLng: -59,
    maxLng: -58,
  });
  expect(spec.sql).toMatch(
    /latitude BETWEEN \? AND \? AND longitude BETWEEN \? AND \?/,
  );
  expect(spec.params.slice(0, 4)).toEqual([-33, -32, -59, -58]);
});

test('session samples select by session id in timestamp order', () => {
  const spec = selectSamplesBySession('s1');
  expect(spec.sql).toMatch(/session_id = \?/);
  expect(spec.params[0]).toBe('s1');
  expect(spec.sql).toMatch(/ORDER BY timestamp ASC/);
});

test('bounding-box normalization orders edges and clamps ranges', () => {
  expect(
    normalizeBoundingBox({ minLat: -32, maxLat: -33, minLng: -58, maxLng: -59 }),
  ).toEqual({ minLat: -33, maxLat: -32, minLng: -59, maxLng: -58 });
  expect(
    normalizeBoundingBox({
      minLat: -100,
      maxLat: 100,
      minLng: -200,
      maxLng: 200,
    }),
  ).toEqual({ minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 });
});

test('paging appends limit/offset and rejects negatives', () => {
  const spec = selectSamplesByDateRange(0, 100, { limit: 10, offset: 5 });
  expect(spec.sql).toMatch(/LIMIT \? OFFSET \?/);
  expect(spec.params.slice(-2)).toEqual([10, 5]);
  expect(() => selectSamplesByDateRange(0, 100, { limit: -1 })).toThrow(
    RangeError,
  );
  expect(() => selectSamplesByNetworkType('lte', { offset: -2 })).toThrow(
    RangeError,
  );
});
