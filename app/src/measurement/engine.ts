/**
 * Measurement engine orchestrator (Stage 3 — RF-02, RF-03).
 *
 * Runs a probe batch plus optional throughput tests and publishes the
 * resulting MeasurementSet to the Zustand store (ADR-9). Headless: no
 * React, no React Native, no native imports — the transport is injected,
 * so the same code runs on device (real transport) and in Jest (fake).
 */

import type {
  HostMeasurement,
  MeasurementSet,
  ProbeConfig,
  ProbeResult,
  RunDeps,
  TcpTransport,
  ThroughputConfig,
  ThroughputResult,
} from './types';
import { DEFAULT_PROBE_PORT } from './types';
import { runProbeBatch } from './probe';
import { buildDownloadPath, measureDownload, measureUpload } from './throughput';
import { summarizeHost } from './stats';
import { useMeasurementStore } from './measurementStore';

export interface EngineConfig {
  probe: ProbeConfig;
  throughput?: ThroughputConfig | null;
}

/** Group probe results by host in first-seen order, summarizing each window. */
function groupByHost(results: ProbeResult[]): HostMeasurement[] {
  const order: string[] = [];
  const buckets = new Map<string, ProbeResult[]>();
  for (const result of results) {
    const bucket = buckets.get(result.host);
    if (bucket) {
      bucket.push(result);
    } else {
      buckets.set(result.host, [result]);
      order.push(result.host);
    }
  }
  return order.map(host => {
    const bucket = buckets.get(host) ?? [];
    const port = bucket[0]?.port ?? DEFAULT_PROBE_PORT;
    return summarizeHost(host, port, bucket);
  });
}

async function runThroughput(
  transport: TcpTransport,
  config: ThroughputConfig,
  deps: RunDeps,
): Promise<{ download: ThroughputResult | null; upload: ThroughputResult | null }> {
  let download: ThroughputResult | null = null;
  let upload: ThroughputResult | null = null;
  if (config.includeDownload) {
    download = await measureDownload(
      transport,
      {
        host: config.host,
        port: config.port,
        path: buildDownloadPath(config.downloadPath, config.downloadBytes),
        expectedBytes: config.downloadBytes,
        timeoutMs: config.timeoutMs,
      },
      deps,
    );
  }
  if (config.includeUpload) {
    upload = await measureUpload(
      transport,
      {
        host: config.host,
        port: config.port,
        path: config.uploadPath,
        payloadBytes: config.uploadBytes,
        timeoutMs: config.timeoutMs,
      },
      deps,
    );
  }
  return { download, upload };
}

/**
 * Run one full measurement pass and return the set without touching the
 * store — the headless entry point used by unit tests and background tasks.
 * Never rejects under a well-behaved transport: probe and throughput
 * failures are recorded inside the set (loss ratio, ok: false).
 */
export async function runHeadlessMeasurement(
  transport: TcpTransport,
  config: EngineConfig,
  deps: RunDeps = {},
): Promise<MeasurementSet> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const probeResults = await runProbeBatch(transport, config.probe, deps);
  const hosts = groupByHost(probeResults);
  const throughput = config.throughput ?? null;
  const { download, upload } = throughput
    ? await runThroughput(transport, throughput, deps)
    : { download: null, upload: null };
  const endedAt = now();
  return { startedAt, endedAt, hosts, download, upload };
}

/**
 * Run one pass and publish the set to the measurement store (ADR-9).
 * Tracks the running flag and records unexpected orchestration failures;
 * per-probe/per-transfer failures are data, not errors, and stay in the set.
 */
export async function runAndPublishMeasurement(
  transport: TcpTransport,
  config: EngineConfig,
  deps: RunDeps = {},
): Promise<MeasurementSet> {
  useMeasurementStore.getState().setRunning(true);
  try {
    const set = await runHeadlessMeasurement(transport, config, deps);
    useMeasurementStore.getState().publish(set);
    return set;
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : String(err);
    useMeasurementStore.getState().fail(message);
    throw err;
  } finally {
    useMeasurementStore.getState().setRunning(false);
  }
}
