/**
 * Production TcpTransport backed by react-native-tcp-socket (ADR-4, ADR-5).
 *
 * This is the ONLY module in the measurement engine allowed to import the
 * native socket library. probe.ts, throughput.ts, stats.ts, types.ts and
 * engine.ts never import this file, so Jest (Node on Windows, no native
 * modules) only ever loads it on device.
 *
 * Protocol notes (reference Fastify backend, lands in a later stage):
 * - Probe: bare TCP connect() to port 443, then destroy. Connect-completion
 *   time is exactly one round trip (ADR-4) — no TLS handshake.
 * - Download: `GET <path> HTTP/1.1` with `Connection: close`; counts body
 *   bytes after the header delimiter and completes at `expectedBytes` or
 *   when the server closes.
 * - Upload: `POST <path>` with a fixed filler payload; completes on first
 *   response bytes or server close. Mbps counts the bytes we sent. The
 *   byte-count cross-check against the echo body is a backend-contract
 *   TODO: the echo response format is defined when the backend lands.
 */

import TcpSocket from 'react-native-tcp-socket';
import type {
  ByteTransferOutcome,
  DownloadRequest,
  TcpProbeOutcome,
  TcpTransport,
  UploadRequest,
} from './types';
import { DEFAULT_PROBE_TIMEOUT_MS } from './types';

type NativeSocket = ReturnType<typeof TcpSocket.createConnection>;

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

function effectiveTimeout(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_PROBE_TIMEOUT_MS;
}

function destroyQuietly(socket: NativeSocket | null): void {
  if (!socket) {
    return;
  }
  try {
    socket.destroy();
  } catch {
    // Already torn down; the outcome has been recorded.
  }
}

function probeOnce(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<TcpProbeOutcome> {
  const deadline = effectiveTimeout(timeoutMs);
  return new Promise<TcpProbeOutcome>(resolve => {
    const startedAt = Date.now();
    let settled = false;
    let socket: NativeSocket | null = null;
    const finish = (outcome: TcpProbeOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      destroyQuietly(socket);
      resolve(outcome);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: 'timeout' }),
      deadline,
    );
    try {
      socket = TcpSocket.createConnection(
        { host, port, connectTimeout: deadline },
        () => finish({ ok: true, rttMs: Date.now() - startedAt }),
      );
    } catch (err) {
      finish({ ok: false, error: toErrorMessage(err) });
      return;
    }
    // destroy() after a successful connect also emits 'close' — the
    // settled guard keeps that from overwriting the success.
    socket.once('error', (err: Error) =>
      finish({ ok: false, error: toErrorMessage(err) }),
    );
    socket.once('close', () =>
      finish({ ok: false, error: 'closed-before-connect' }),
    );
  });
}

/**
 * Count bytes in an incoming chunk. With no encoding set the library
 * delivers Buffers (byte length is exact); fall back to string length for
 * string chunks.
 */
function chunkByteLength(chunk: { length: number }): number {
  return chunk.length;
}

function downloadOnce(request: DownloadRequest): Promise<ByteTransferOutcome> {
  const deadline = effectiveTimeout(request.timeoutMs);
  const expected = Math.floor(request.expectedBytes);
  return new Promise<ByteTransferOutcome>(resolve => {
    const startedAt = Date.now();
    let settled = false;
    let socket: NativeSocket | null = null;
    let headText = '';
    let headersDone = false;
    let contentLength: number | null = null;
    let bodyBytes = 0;
    const finish = (outcome: ByteTransferOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      destroyQuietly(socket);
      resolve(outcome);
    };
    const elapsed = (): number => Date.now() - startedAt;
    const finishIfComplete = (): void => {
      if (expected > 0 && bodyBytes >= expected) {
        finish({ ok: true, bytesTransferred: bodyBytes, elapsedMs: elapsed() });
      } else if (contentLength !== null && bodyBytes >= contentLength) {
        // Server declared (and sent) a shorter body than requested.
        fail('incomplete');
      }
    };
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: 'timeout',
          bytesTransferred: bodyBytes,
          elapsedMs: elapsed(),
        }),
      deadline,
    );
    const fail = (error: string): void =>
      finish({
        ok: false,
        error,
        bytesTransferred: bodyBytes,
        elapsedMs: elapsed(),
      });
    try {
      socket = TcpSocket.createConnection(
        { host: request.host, port: request.port, connectTimeout: deadline },
        () => {
          const target = request.path.startsWith('/')
            ? request.path
            : `/${request.path}`;
          socket?.write(
            `GET ${target} HTTP/1.1\r\nHost: ${request.host}\r\nConnection: close\r\n\r\n`,
          );
        },
      );
    } catch (err) {
      fail(toErrorMessage(err));
      return;
    }
    socket.once('error', (err: Error) => fail(toErrorMessage(err)));
    socket.on('data', chunk => {
      if (settled) {
        return;
      }
      if (!headersDone) {
        // HTTP headers are ASCII, so char length matches byte length here.
        headText += typeof chunk === 'string' ? chunk : chunk.toString();
        const delimiter = headText.indexOf('\r\n\r\n');
        if (delimiter >= 0) {
          headersDone = true;
          bodyBytes += headText.length - (delimiter + 4);
          const match = headText.match(/content-length:\s*(\d+)/i);
          contentLength =
            match && match[1] ? parseInt(match[1], 10) : null;
          finishIfComplete();
        }
      } else {
        bodyBytes += chunkByteLength(chunk);
        finishIfComplete();
      }
    });
    socket.once('close', () => {
      if (bodyBytes >= expected && expected > 0) {
        finish({ ok: true, bytesTransferred: bodyBytes, elapsedMs: elapsed() });
      } else {
        fail('incomplete');
      }
    });
  });
}

function uploadOnce(request: UploadRequest): Promise<ByteTransferOutcome> {
  const deadline = effectiveTimeout(request.timeoutMs);
  const payloadBytes = Math.floor(request.payloadBytes);
  return new Promise<ByteTransferOutcome>(resolve => {
    const startedAt = Date.now();
    let settled = false;
    let socket: NativeSocket | null = null;
    const finish = (outcome: ByteTransferOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      destroyQuietly(socket);
      resolve(outcome);
    };
    const elapsed = (): number => Date.now() - startedAt;
    const fail = (error: string): void =>
      finish({
        ok: false,
        error,
        bytesTransferred: 0,
        elapsedMs: elapsed(),
      });
    const succeed = (): void =>
      finish({ ok: true, bytesTransferred: payloadBytes, elapsedMs: elapsed() });
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: 'timeout',
          bytesTransferred: 0,
          elapsedMs: elapsed(),
        }),
      deadline,
    );
    try {
      socket = TcpSocket.createConnection(
        { host: request.host, port: request.port, connectTimeout: deadline },
        () => {
          const target = request.path.startsWith('/')
            ? request.path
            : `/${request.path}`;
          const current = socket;
          if (!current) {
            fail('socket-lost-before-write');
            return;
          }
          current.write(
            `POST ${target} HTTP/1.1\r\nHost: ${request.host}\r\nContent-Length: ${payloadBytes}\r\nConnection: close\r\n\r\n`,
          );
          // Fixed filler payload; the echo server counts bytes, not content.
          current.write('x'.repeat(payloadBytes));
        },
      );
    } catch (err) {
      fail(toErrorMessage(err));
      return;
    }
    socket.once('error', (err: Error) => fail(toErrorMessage(err)));
    // First response bytes or server close both mean the echo round trip
    // completed; Mbps counts the bytes we sent.
    socket.once('data', () => succeed());
    socket.once('close', () => succeed());
  });
}

/** Production transport factory. Call only on device, never under Jest. */
export function createTcpSocketTransport(): TcpTransport {
  return {
    probe: (host, port, timeoutMs) => probeOnce(host, port, timeoutMs),
    download: request => downloadOnce(request),
    upload: request => uploadOnce(request),
  };
}
