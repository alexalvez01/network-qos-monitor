/**
 * Pure RTT / jitter / loss / throughput statistics (Stage 3).
 *
 * No React, no React Native, no native imports — safe to run under Jest.
 * All functions are total: empty inputs and degenerate durations yield null
 * or 0 instead of NaN, Infinity, or throws.
 */

import type { HostMeasurement, ProbeResult, RttSummary } from './types';

/**
 * Percentile with linear interpolation between closest ranks (the method
 * used by most QoS dashboards). `p` is clamped to [0, 100]. Returns null
 * for an empty input.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(100, Math.max(0, p));
  const rank = (clamped / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];
  if (lowerValue === undefined || upperValue === undefined) {
    return null;
  }
  if (lower === upper) {
    return lowerValue;
  }
  const fraction = rank - lower;
  return lowerValue + (upperValue - lowerValue) * fraction;
}

/**
 * Jitter as defined for this project (PLAN ADR-4): the mean absolute
 * successive difference of consecutive RTT samples. This is the "RFC 3550
 * style" formulation from the plan — a plain mean of |RTT[i] - RTT[i-1]|,
 * not the EWMA estimator from section 6.4.1 of the RFC. Order matters:
 * pass samples in measurement order, not sorted.
 *
 * Returns null for an empty input and 0 for a single sample (nothing to
 * differ from yet).
 */
export function jitterRfc3550(samples: readonly number[]): number | null {
  if (samples.length === 0) {
    return null;
  }
  if (samples.length === 1) {
    return 0;
  }
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += Math.abs(samples[i] - samples[i - 1]);
  }
  return total / (samples.length - 1);
}

/**
 * Loss ratio in [0, 1]: unanswered probes over the window. Returns null
 * when nothing was sent — absence of probes is not zero loss.
 */
export function lossRatio(sent: number, answered: number): number | null {
  if (!Number.isFinite(sent) || sent <= 0) {
    return null;
  }
  const ok = Math.min(Math.max(0, answered), sent);
  return (sent - ok) / sent;
}

/** Loss ratio over a probe window; a probe counts as answered when it has an RTT. */
export function lossRatioOfResults(results: readonly ProbeResult[]): number | null {
  if (results.length === 0) {
    return null;
  }
  let answered = 0;
  for (const result of results) {
    if (result.rttMs !== null) {
      answered++;
    }
  }
  return lossRatio(results.length, answered);
}

/**
 * Device-side throughput in megabits per second (ADR-5): bytes transferred
 * over measured elapsed time. Guards against divide-by-zero: any
 * non-positive or non-finite input yields 0, never Infinity or NaN.
 */
export function mbps(bytesTransferred: number, elapsedMs: number): number {
  if (!Number.isFinite(bytesTransferred) || !Number.isFinite(elapsedMs)) {
    return 0;
  }
  if (bytesTransferred <= 0 || elapsedMs <= 0) {
    return 0;
  }
  return bytesTransferred * 8 * (1000 / elapsedMs) / 1_000_000;
}

/** Full RTT summary over answered samples in measurement order. */
export function describeRtt(samples: readonly number[]): RttSummary {
  const empty: RttSummary = {
    count: 0,
    minMs: null,
    maxMs: null,
    meanMs: null,
    p50Ms: null,
    p90Ms: null,
    p95Ms: null,
    jitterMs: null,
  };
  if (samples.length === 0) {
    return empty;
  }
  let min = samples[0];
  let max = samples[0];
  let total = 0;
  for (const sample of samples) {
    if (sample < min) {
      min = sample;
    }
    if (sample > max) {
      max = sample;
    }
    total += sample;
  }
  return {
    count: samples.length,
    minMs: min,
    maxMs: max,
    meanMs: total / samples.length,
    p50Ms: percentile(samples, 50),
    p90Ms: percentile(samples, 90),
    p95Ms: percentile(samples, 95),
    jitterMs: jitterRfc3550(samples),
  };
}

/**
 * Aggregate one host's probe window. Unanswered probes (rttMs null) feed
 * the loss ratio; only answered samples feed the RTT summary.
 */
export function summarizeHost(
  host: string,
  port: number,
  results: readonly ProbeResult[],
): HostMeasurement {
  const rtts: number[] = [];
  for (const result of results) {
    if (result.rttMs !== null) {
      rtts.push(result.rttMs);
    }
  }
  return {
    host,
    port,
    sent: results.length,
    answered: rtts.length,
    lossRatio: lossRatio(results.length, rtts.length),
    rtt: describeRtt(rtts),
  };
}
