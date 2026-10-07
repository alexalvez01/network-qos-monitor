/**
 * Measurement engine contracts (Stage 3 — RF-02, RF-03).
 *
 * Pure TypeScript: no React, no React Native, no native-module imports.
 *
 * The TcpTransport interface is the seam that keeps every statistic and
 * scheduler unit-testable on Node/Windows: production injects the
 * react-native-tcp-socket implementation from transport.ts, unit tests
 * inject an in-memory fake. probe.ts and throughput.ts depend only on this
 * file, never on transport.ts, so importing them in Jest can never pull the
 * native module in.
 */

// ---------------------------------------------------------------------------
// Transport seam
// ---------------------------------------------------------------------------

/** Outcome of a single TCP connect() probe (ADR-4). */
export type TcpProbeOutcome =
  | { ok: true; rttMs: number }
  | { ok: false; error: string };

/** Outcome of a raw-socket byte transfer (ADR-5). */
export type ByteTransferOutcome =
  | { ok: true; bytesTransferred: number; elapsedMs: number }
  | { ok: false; error: string; bytesTransferred: number; elapsedMs: number };

export interface DownloadRequest {
  host: string;
  port: number;
  /** e.g. `/download?bytes=1000000` — fixed-size payload on the reference backend. */
  path: string;
  /** How many payload bytes the backend was asked to serve. */
  expectedBytes: number;
  timeoutMs: number;
}

export interface UploadRequest {
  host: string;
  port: number;
  /** e.g. `/upload` — echo endpoint on the reference backend. */
  path: string;
  /** Payload size in bytes. */
  payloadBytes: number;
  timeoutMs: number;
}

export interface TcpTransport {
  /**
   * TCP connect() to host:port. Resolves once connected or on deadline.
   * ADR-4: this measures connect() completion time only — no TLS handshake.
   * Implementations must never throw; report failures as `{ ok: false }`.
   */
  probe(host: string, port: number, timeoutMs: number): Promise<TcpProbeOutcome>;
  download(request: DownloadRequest): Promise<ByteTransferOutcome>;
  upload(request: UploadRequest): Promise<ByteTransferOutcome>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default probe targets per ADR-4: stable anycast resolvers reachable from AR. */
export const DEFAULT_PROBE_HOSTS: readonly string[] = [
  '1.1.1.1',
  '8.8.8.8',
  '9.9.9.9',
];

/** Probes target TCP port 443 (ADR-4): exactly one round trip, no TLS. */
export const DEFAULT_PROBE_PORT = 443;
export const DEFAULT_SAMPLES_PER_HOST = 4;
export const DEFAULT_PROBE_TIMEOUT_MS = 3000;
export const DEFAULT_PROBE_INTERVAL_MS = 200;

export interface ProbeConfig {
  hosts: readonly string[];
  port: number;
  samplesPerHost: number;
  timeoutMs: number;
  /** Pacing delay between consecutive probes. */
  intervalMs: number;
}

export const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  hosts: DEFAULT_PROBE_HOSTS,
  port: DEFAULT_PROBE_PORT,
  samplesPerHost: DEFAULT_SAMPLES_PER_HOST,
  timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  intervalMs: DEFAULT_PROBE_INTERVAL_MS,
};

/**
 * Reference-backend throughput settings (ADR-5). Host/port are placeholders
 * until the Fastify backend lands; override them when pointing at the real
 * `GET /download?bytes=N` / `POST /upload` service.
 */
export interface ThroughputConfig {
  host: string;
  port: number;
  downloadPath: string;
  downloadBytes: number;
  uploadPath: string;
  uploadBytes: number;
  timeoutMs: number;
  includeDownload: boolean;
  includeUpload: boolean;
}

export const DEFAULT_THROUGHPUT_CONFIG: ThroughputConfig = {
  host: '127.0.0.1',
  port: 3000,
  downloadPath: '/download',
  downloadBytes: 1000000,
  uploadPath: '/upload',
  uploadBytes: 500000,
  timeoutMs: 15000,
  includeDownload: true,
  includeUpload: true,
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface ProbeResult {
  /** Per-batch sequence ID (ADR-4): unanswered probes over a window give loss. */
  seq: number;
  host: string;
  port: number;
  /** Connect time in ms; null when the probe went unanswered. */
  rttMs: number | null;
  timedOut: boolean;
  error?: string;
  startedAt: number;
  endedAt: number;
}

export interface RttSummary {
  /** Answered samples only. */
  count: number;
  minMs: number | null;
  maxMs: number | null;
  meanMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  /**
   * Mean absolute successive difference of consecutive RTT samples — the
   * PLAN's RFC 3550 formulation. Null when there is nothing to compare.
   */
  jitterMs: number | null;
}

export interface HostMeasurement {
  host: string;
  port: number;
  sent: number;
  answered: number;
  /** Fraction of unanswered probes in [0, 1]; null when nothing was sent. */
  lossRatio: number | null;
  rtt: RttSummary;
}

export type ThroughputDirection = 'download' | 'upload';

export interface ThroughputResult {
  direction: ThroughputDirection;
  bytesTransferred: number;
  elapsedMs: number;
  /** Device-side Mbps from bytes over measured elapsed time (ADR-5). */
  mbps: number;
  ok: boolean;
  error?: string;
  startedAt: number;
  endedAt: number;
}

export interface MeasurementSet {
  startedAt: number;
  endedAt: number;
  hosts: HostMeasurement[];
  download: ThroughputResult | null;
  upload: ThroughputResult | null;
}

// ---------------------------------------------------------------------------
// Injectable dependencies (clocks keep the schedulers deterministic in tests)
// ---------------------------------------------------------------------------

export type ClockFn = () => number;
export type DelayFn = (ms: number) => Promise<void>;

export interface RunDeps {
  now?: ClockFn;
  delay?: DelayFn;
  /** First sequence ID for this batch; defaults to 1. */
  firstSequenceId?: number;
}
