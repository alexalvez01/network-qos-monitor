/**
 * Client-side throughput measurement (Stage 3, ADR-5).
 *
 * Pure orchestration logic: no React, no React Native, no native imports.
 * Mbps is computed on the device from bytes transferred over measured
 * elapsed time — the backend only serves a fixed-size payload
 * (`GET /download?bytes=N`) and echoes an upload (`POST /upload`).
 */

import type {
  ByteTransferOutcome,
  ClockFn,
  DownloadRequest,
  TcpTransport,
  ThroughputDirection,
  ThroughputResult,
  UploadRequest,
} from './types';
import { mbps } from './stats';

/**
 * Build the fixed-size download path for the reference backend, e.g.
 * `/download` + 1000000 -> `/download?bytes=1000000`. Preserves any query
 * string the base path already carries.
 */
export function buildDownloadPath(basePath: string, bytes: number): string {
  const separator = basePath.includes('?') ? '&' : '?';
  return `${basePath}${separator}bytes=${Math.floor(bytes)}`;
}

function sanitizeBytes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function sanitizeElapsed(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}

function failedResult(
  direction: ThroughputDirection,
  error: string,
  startedAt: number,
  endedAt: number,
): ThroughputResult {
  return {
    direction,
    bytesTransferred: 0,
    elapsedMs: 0,
    mbps: 0,
    ok: false,
    error,
    startedAt,
    endedAt,
  };
}

function toResult(
  direction: ThroughputDirection,
  outcome: ByteTransferOutcome,
  startedAt: number,
  endedAt: number,
): ThroughputResult {
  const bytes = sanitizeBytes(outcome.bytesTransferred);
  const elapsed = sanitizeElapsed(outcome.elapsedMs);
  if (!outcome.ok) {
    return {
      direction,
      bytesTransferred: bytes,
      elapsedMs: elapsed,
      mbps: 0,
      ok: false,
      error: outcome.error,
      startedAt,
      endedAt,
    };
  }
  return {
    direction,
    bytesTransferred: bytes,
    elapsedMs: elapsed,
    mbps: mbps(bytes, elapsed),
    ok: true,
    startedAt,
    endedAt,
  };
}

function thrownMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

/**
 * Download `expectedBytes` over a raw socket and report device-side Mbps.
 * Rejects invalid sizes without touching the transport. Never throws: a
 * throwing transport (contract violation) becomes a failed result.
 */
export async function measureDownload(
  transport: TcpTransport,
  request: DownloadRequest,
  deps: { now?: ClockFn } = {},
): Promise<ThroughputResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  if (!Number.isFinite(request.expectedBytes) || request.expectedBytes <= 0) {
    return failedResult('download', 'invalid-expected-bytes', startedAt, now());
  }
  try {
    const outcome = await transport.download(request);
    return toResult('download', outcome, startedAt, now());
  } catch (err) {
    return failedResult('download', thrownMessage(err), startedAt, now());
  }
}

/**
 * Upload `payloadBytes` to the echo endpoint and report device-side Mbps.
 * Same never-throw contract as measureDownload.
 */
export async function measureUpload(
  transport: TcpTransport,
  request: UploadRequest,
  deps: { now?: ClockFn } = {},
): Promise<ThroughputResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  if (!Number.isFinite(request.payloadBytes) || request.payloadBytes <= 0) {
    return failedResult('upload', 'invalid-payload-bytes', startedAt, now());
  }
  try {
    const outcome = await transport.upload(request);
    return toResult('upload', outcome, startedAt, now());
  } catch (err) {
    return failedResult('upload', thrownMessage(err), startedAt, now());
  }
}
