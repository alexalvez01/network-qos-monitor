/**
 * TCP probe scheduler (Stage 3, ADR-4).
 *
 * Pure scheduling logic: no React, no React Native, no native imports. The
 * socket work hides behind the injected TcpTransport, so this runs
 * identically on device and under Jest.
 */

import type {
  ClockFn,
  DelayFn,
  ProbeConfig,
  ProbeResult,
  RunDeps,
  TcpProbeOutcome,
  TcpTransport,
} from './types';
import {
  DEFAULT_PROBE_HOSTS,
  DEFAULT_PROBE_INTERVAL_MS,
  DEFAULT_PROBE_PORT,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_SAMPLES_PER_HOST,
} from './types';

function defaultDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface NormalizedProbeConfig {
  hosts: string[];
  port: number;
  samplesPerHost: number;
  timeoutMs: number;
  intervalMs: number;
}

/** Fill gaps defensively: empty hosts fall back to the ADR-4 defaults. */
function normalizeConfig(config: ProbeConfig): NormalizedProbeConfig {
  const hosts =
    config.hosts.length > 0 ? [...config.hosts] : [...DEFAULT_PROBE_HOSTS];
  const port =
    Number.isFinite(config.port) && config.port > 0
      ? Math.floor(config.port)
      : DEFAULT_PROBE_PORT;
  const samplesPerHost =
    Number.isFinite(config.samplesPerHost) && config.samplesPerHost > 0
      ? Math.floor(config.samplesPerHost)
      : DEFAULT_SAMPLES_PER_HOST;
  const timeoutMs =
    Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_PROBE_TIMEOUT_MS;
  const intervalMs =
    Number.isFinite(config.intervalMs) && config.intervalMs > 0
      ? config.intervalMs
      : DEFAULT_PROBE_INTERVAL_MS;
  return { hosts, port, samplesPerHost, timeoutMs, intervalMs };
}

/** A transport that throws (contract violation) still yields a failed probe, never a crash. */
async function safeProbe(
  transport: TcpTransport,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<TcpProbeOutcome> {
  try {
    const outcome = await transport.probe(host, port, timeoutMs);
    if (!outcome || typeof outcome.ok !== 'boolean') {
      return { ok: false, error: 'invalid-outcome' };
    }
    if (outcome.ok) {
      if (!Number.isFinite(outcome.rttMs) || outcome.rttMs < 0) {
        return { ok: false, error: 'invalid-rtt' };
      }
      return outcome;
    }
    const error =
      typeof outcome.error === 'string' && outcome.error.length > 0
        ? outcome.error
        : 'probe-failed';
    return { ok: false, error };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.message ? err.message : String(err),
    };
  }
}

function isTimeoutError(error: string): boolean {
  return error.toLowerCase().includes('timeout');
}

/**
 * Run the probe batch: every host gets `samplesPerHost` sequential
 * connect() probes with sequence IDs, paced by `intervalMs`. The batch
 * never rejects — per-probe failures are recorded as unanswered results
 * so the loss ratio stays meaningful.
 */
export async function runProbeBatch(
  transport: TcpTransport,
  config: ProbeConfig,
  deps: RunDeps = {},
): Promise<ProbeResult[]> {
  const normalized = normalizeConfig(config);
  const now: ClockFn = deps.now ?? Date.now;
  const delay: DelayFn = deps.delay ?? defaultDelay;
  let seq =
    deps.firstSequenceId !== undefined &&
    Number.isFinite(deps.firstSequenceId) &&
    deps.firstSequenceId >= 0
      ? Math.floor(deps.firstSequenceId)
      : 1;

  const results: ProbeResult[] = [];
  const total = normalized.hosts.length * normalized.samplesPerHost;
  let done = 0;
  for (const host of normalized.hosts) {
    for (let i = 0; i < normalized.samplesPerHost; i++) {
      const startedAt = now();
      const outcome = await safeProbe(
        transport,
        host,
        normalized.port,
        normalized.timeoutMs,
      );
      const endedAt = now();
      if (outcome.ok) {
        results.push({
          seq: seq++,
          host,
          port: normalized.port,
          rttMs: outcome.rttMs,
          timedOut: false,
          startedAt,
          endedAt,
        });
      } else {
        results.push({
          seq: seq++,
          host,
          port: normalized.port,
          rttMs: null,
          timedOut: isTimeoutError(outcome.error),
          error: outcome.error,
          startedAt,
          endedAt,
        });
      }
      done++;
      // Pace consecutive probes, but never sleep after the final one.
      if (done < total) {
        await delay(normalized.intervalMs);
      }
    }
  }
  return results;
}
