/**
 * In-memory TcpTransport for unit tests. Never touches native modules.
 * Probe outcomes are scripted per host in call order; transfers return
 * fixed outcomes. Every call is recorded for assertions.
 */

import type {
  ByteTransferOutcome,
  DownloadRequest,
  TcpProbeOutcome,
  TcpTransport,
  UploadRequest,
} from '../types';

export type ProbeScript = (
  host: string,
  callIndexForHost: number,
) => TcpProbeOutcome;

export function fixedRtts(rtts: number[]): ProbeScript {
  return (_host, index) => {
    const rtt = rtts[index];
    return rtt === undefined ? { ok: false, error: 'timeout' } : { ok: true, rttMs: rtt };
  };
}

export class FakeTransport implements TcpTransport {
  probeCalls: Array<{ host: string; port: number; timeoutMs: number }> = [];
  downloadCalls: DownloadRequest[] = [];
  uploadCalls: UploadRequest[] = [];
  /** When set, probe() throws instead of returning — a transport contract violation. */
  throwOnProbe: Error | null = null;

  constructor(
    private probeScript: ProbeScript = () => ({ ok: true, rttMs: 10 }),
    private downloadOutcome: ByteTransferOutcome = {
      ok: true,
      bytesTransferred: 1000000,
      elapsedMs: 1000,
    },
    private uploadOutcome: ByteTransferOutcome = {
      ok: true,
      bytesTransferred: 500000,
      elapsedMs: 1000,
    },
  ) {}

  async probe(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<TcpProbeOutcome> {
    this.probeCalls.push({ host, port, timeoutMs });
    if (this.throwOnProbe) {
      throw this.throwOnProbe;
    }
    const index =
      this.probeCalls.filter(call => call.host === host).length - 1;
    return this.probeScript(host, index);
  }

  async download(request: DownloadRequest): Promise<ByteTransferOutcome> {
    this.downloadCalls.push(request);
    return this.downloadOutcome;
  }

  async upload(request: UploadRequest): Promise<ByteTransferOutcome> {
    this.uploadCalls.push(request);
    return this.uploadOutcome;
  }
}
