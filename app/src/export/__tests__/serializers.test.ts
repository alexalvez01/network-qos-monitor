import {
  buildExportFilename,
  escapeCsvField,
  samplesToCsv,
  sessionToCsv,
  sessionWithSamplesToCsv,
  sessionWithSamplesToJson,
} from '../serializers';
import type {
  SampleRecord,
  SessionRecord,
  SessionWithSamples,
} from '../../data/types';

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'walk-1',
    startedAt: 1700000000000,
    endedAt: 1700000600000,
    name: 'Evening walk',
    ...overrides,
  };
}

function sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: 1,
    sessionId: 'walk-1',
    timestamp: 1700000001000,
    latitude: -32.4821,
    longitude: -58.2372,
    accuracy: 12,
    networkType: 'lte',
    host: '1.1.1.1',
    port: 443,
    sent: 4,
    answered: 4,
    lossRatio: 0,
    rttMinMs: 20,
    rttMaxMs: 60,
    rttMeanMs: 35.5,
    rttP50Ms: 34,
    rttP90Ms: 55,
    rttP95Ms: 58,
    rttJitterMs: 8,
    downloadMbps: 42.5,
    uploadMbps: 11.2,
    signalDbm: null,
    ...overrides,
  };
}

function input(): SessionWithSamples {
  return { session: session(), samples: [sample()] };
}

test('fields without specials pass through unquoted', () => {
  expect(escapeCsvField('lte')).toBe('lte');
  expect(escapeCsvField('1.1.1.1')).toBe('1.1.1.1');
});

test('commas, quotes and newlines trigger RFC-4180 quoting', () => {
  expect(escapeCsvField('a,b')).toBe('"a,b"');
  expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  expect(escapeCsvField('a\rb')).toBe('"a\rb"');
});

test('session CSV is a header plus one row with nulls as empty', () => {
  const csv = sessionToCsv(session({ endedAt: null, name: null }));
  const lines = csv.split('\r\n');
  expect(lines[0]).toBe('id,started_at,ended_at,name');
  expect(lines[1]).toBe('walk-1,1700000000000,,');
});

test('session name with comma and quotes round-trips escaped', () => {
  const csv = sessionToCsv(session({ name: 'Walk "a", riverside' }));
  expect(csv).toContain('"Walk ""a"", riverside"');
});

test('samples CSV carries the header and one row per sample', () => {
  const csv = samplesToCsv([sample(), sample({ id: 2, host: '8.8.8.8' })]);
  const lines = csv.split('\r\n');
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('session_id,timestamp');
  expect(lines[1]).toContain('1.1.1.1');
  expect(lines[2]).toContain('8.8.8.8');
});

test('empty samples still emit the header', () => {
  const csv = samplesToCsv([]);
  expect(csv.split('\r\n')).toHaveLength(1);
  expect(csv).toContain('rtt_mean_ms');
});

test('combined document holds both tables with their own headers', () => {
  const csv = sessionWithSamplesToCsv(input());
  expect(csv).toContain('id,started_at,ended_at,name');
  expect(csv).toContain('session_id,timestamp');
  expect(csv).toContain('walk-1');
  expect(csv).toContain('1.1.1.1');
});

test('JSON export is a plain array: session descriptor then samples', () => {
  const parsed = JSON.parse(sessionWithSamplesToJson(input()));
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed).toHaveLength(2);
  expect(parsed[0]).toMatchObject({ type: 'session', id: 'walk-1' });
  expect(parsed[1]).toMatchObject({
    type: 'sample',
    sessionId: 'walk-1',
    host: '1.1.1.1',
  });
});

test('JSON export of a sampleless session holds only the descriptor', () => {
  const parsed = JSON.parse(
    sessionWithSamplesToJson({ session: session(), samples: [] }),
  );
  expect(parsed).toHaveLength(1);
  expect(parsed[0].type).toBe('session');
});

test('filenames are stable and filesystem-safe', () => {
  expect(buildExportFilename(session(), 'csv')).toBe(
    'qos-walk-1-1700000000000.csv',
  );
  expect(
    buildExportFilename(session({ id: 'a/b c:d' }), 'json'),
  ).toBe('qos-a_b_c_d-1700000000000.json');
});
