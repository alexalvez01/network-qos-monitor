/**
 * History-list derived data for Stage 5 (RF-06).
 *
 * Pure TypeScript: session summaries, list filtering and display
 * formatting. The HistoryScreen only renders what these functions return,
 * so every rule below (filter semantics, null handling, label formats) is
 * unit-tested on Windows without SQLite or React Native.
 */

import type { SampleRecord, SessionRecord } from '../../data/types';

export interface SessionSummary {
  session: SessionRecord;
  sampleCount: number;
  /** Distinct non-empty connection classes across the session's samples. */
  networkTypes: string[];
  /** Mean of the samples' mean RTTs; null when no sample has one. */
  meanLatencyMs: number | null;
  /** Best download throughput seen; null when no sample has one. */
  maxThroughputMbps: number | null;
  /** Inclusive geographic window; null when the session has no samples. */
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null;
}

export interface HistoryFilter {
  /** Keep sessions containing at least one sample of this class; null = all. */
  networkType?: string | null;
  /** Inclusive epoch-ms window on the session start; null edge = open. */
  startMs?: number | null;
  endMs?: number | null;
  /** Case-insensitive substring on the session name; '' or undefined = all. */
  query?: string;
}

/**
 * Collapse one session and its samples into the single row the list
 * renders. Samples from other sessions must be filtered by the caller —
 * this function trusts its input the way the repository returns it.
 */
export function summarizeSession(
  session: SessionRecord,
  samples: readonly SampleRecord[],
): SessionSummary {
  const networkSet = new Set<string>();
  let latencySum = 0;
  let latencySeen = 0;
  let maxThroughput: number | null = null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const sample of samples) {
    if (sample.networkType && sample.networkType.length > 0) {
      networkSet.add(sample.networkType);
    }
    if (typeof sample.rttMeanMs === 'number' && Number.isFinite(sample.rttMeanMs)) {
      latencySum += sample.rttMeanMs;
      latencySeen += 1;
    }
    if (
      typeof sample.downloadMbps === 'number' &&
      Number.isFinite(sample.downloadMbps) &&
      (maxThroughput === null || sample.downloadMbps > maxThroughput)
    ) {
      maxThroughput = sample.downloadMbps;
    }
    if (
      Number.isFinite(sample.latitude) &&
      Number.isFinite(sample.longitude)
    ) {
      minLat = Math.min(minLat, sample.latitude);
      maxLat = Math.max(maxLat, sample.latitude);
      minLng = Math.min(minLng, sample.longitude);
      maxLng = Math.max(maxLng, sample.longitude);
    }
  }

  return {
    session,
    sampleCount: samples.length,
    networkTypes: [...networkSet].sort(),
    meanLatencyMs: latencySeen > 0 ? latencySum / latencySeen : null,
    maxThroughputMbps: maxThroughput,
    bounds:
      samples.length > 0 && minLat !== Infinity
        ? { minLat, maxLat, minLng, maxLng }
        : null,
  };
}

/** Apply the history filter; every clause is AND-combined, all optional. */
export function filterSummaries(
  summaries: readonly SessionSummary[],
  filter: HistoryFilter = {},
): SessionSummary[] {
  // Inverted edges are ordered; a lone edge leaves the other side open.
  const bothEdges = filter.startMs != null && filter.endMs != null;
  const lo = bothEdges
    ? Math.min(filter.startMs as number, filter.endMs as number)
    : (filter.startMs ?? null);
  const hi = bothEdges
    ? Math.max(filter.startMs as number, filter.endMs as number)
    : (filter.endMs ?? null);
  const query = (filter.query ?? '').trim().toLowerCase();

  return summaries.filter(summary => {
    if (filter.networkType) {
      if (!summary.networkTypes.includes(filter.networkType)) {
        return false;
      }
    }
    if (lo !== null && summary.session.startedAt < lo) {
      return false;
    }
    if (hi !== null && summary.session.startedAt > hi) {
      return false;
    }
    if (query.length > 0) {
      const name = summary.session.name ?? '';
      if (!name.toLowerCase().includes(query)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * UTC `YYYY-MM-DD HH:mm`: deterministic across devices and time zones so
 * tests and defense screenshots agree. Local time would be friendlier but
 * untestable without timezone fixtures.
 */
export function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return 'Unknown time';
  }
  const date = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

/** Human duration between two epoch-ms stamps; open sessions read "Ongoing". */
export function formatDuration(startedAt: number, endedAt: number | null): string {
  if (!Number.isFinite(startedAt)) {
    return 'Unknown duration';
  }
  if (endedAt === null) {
    return 'Ongoing';
  }
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** Latency readout; missing data is labeled, never rendered as 0 ms. */
export function formatLatency(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'No data';
  }
  return `${Math.round(value)} ms`;
}

/** Throughput readout with one decimal; missing data is labeled. */
export function formatThroughput(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'No data';
  }
  return `${(Math.round(value * 10) / 10).toFixed(1)} Mbps`;
}
