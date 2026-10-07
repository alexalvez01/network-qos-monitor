/**
 * CSV/JSON session export for Stage 6 (RF-08).
 *
 * Pure TypeScript: no React, no React Native, no native imports — safe to
 * run under Jest. CSV follows RFC-4180 (quoted fields, doubled quotes,
 * CRLF line endings); JSON is a plain array so any consumer can parse it
 * without knowing this app's store shapes.
 */

import type {
  SampleRecord,
  SessionRecord,
  SessionWithSamples,
} from '../data/types';

export const SAMPLE_CSV_COLUMNS: readonly string[] = [
  'session_id',
  'timestamp',
  'latitude',
  'longitude',
  'accuracy',
  'network_type',
  'host',
  'port',
  'sent',
  'answered',
  'loss_ratio',
  'rtt_min_ms',
  'rtt_max_ms',
  'rtt_mean_ms',
  'rtt_p50_ms',
  'rtt_p90_ms',
  'rtt_p95_ms',
  'rtt_jitter_ms',
  'download_mbps',
  'upload_mbps',
];

export const SESSION_CSV_COLUMNS: readonly string[] = [
  'id',
  'started_at',
  'ended_at',
  'name',
];

/** RFC-4180 escaping: quote only when the field needs it, double quotes. */
export function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function cell(value: number | string | null): string {
  if (value === null) {
    return '';
  }
  return escapeCsvField(String(value));
}

function sampleToRow(sample: SampleRecord): string {
  return [
    cell(sample.sessionId),
    cell(sample.timestamp),
    cell(sample.latitude),
    cell(sample.longitude),
    cell(sample.accuracy),
    cell(sample.networkType),
    cell(sample.host),
    cell(sample.port),
    cell(sample.sent),
    cell(sample.answered),
    cell(sample.lossRatio),
    cell(sample.rttMinMs),
    cell(sample.rttMaxMs),
    cell(sample.rttMeanMs),
    cell(sample.rttP50Ms),
    cell(sample.rttP90Ms),
    cell(sample.rttP95Ms),
    cell(sample.rttJitterMs),
    cell(sample.downloadMbps),
    cell(sample.uploadMbps),
  ].join(',');
}

/** One session row as header + single record (nulls export as empty). */
export function sessionToCsv(session: SessionRecord): string {
  const row = [
    cell(session.id),
    cell(session.startedAt),
    cell(session.endedAt),
    cell(session.name),
  ].join(',');
  return `${SESSION_CSV_COLUMNS.join(',')}\r\n${row}`;
}

/** Sample rows as header + one record per sample; header only when empty. */
export function samplesToCsv(samples: readonly SampleRecord[]): string {
  const rows = samples.map(sampleToRow);
  return [SAMPLE_CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

/**
 * One shareable CSV document: the session table first, then the samples
 * table, each with its own header. The two tables have different columns,
 * so they stay separate instead of being forced into one ragged shape —
 * split the document on the samples header before parsing.
 */
export function sessionWithSamplesToCsv(input: SessionWithSamples): string {
  return `${sessionToCsv(input.session)}\r\n${samplesToCsv(input.samples)}`;
}

export type ExportJsonRow =
  | ({ type: 'session' } & SessionRecord)
  | ({ type: 'sample' } & SampleRecord);

/**
 * Plain JSON array: element zero is the session descriptor, the rest are
 * that session's samples in timestamp order. The `type` discriminator
 * tells consumers which is which without an envelope object.
 */
export function sessionWithSamplesToJson(input: SessionWithSamples): string {
  const rows: ExportJsonRow[] = [
    { type: 'session', ...input.session },
    ...input.samples.map(sample => ({ type: 'sample' as const, ...sample })),
  ];
  return JSON.stringify(rows, null, 2);
}

/** Filesystem-safe share filename: `qos-<sessionId>-<startedAt>.<ext>`. */
export function buildExportFilename(
  session: SessionRecord,
  extension: 'csv' | 'json',
): string {
  const safeId = session.id.replace(/[^A-Za-z0-9_-]/g, '_');
  return `qos-${safeId}-${session.startedAt}.${extension}`;
}
