import {
  buildDownloadPath,
  measureDownload,
  measureUpload,
} from '../throughput';
import { FakeTransport } from '../testing/fakeTransport';

test('download reports device-side Mbps from the transfer outcome', async () => {
  const transport = new FakeTransport(
    () => ({ ok: true, rttMs: 10 }),
    { ok: true, bytesTransferred: 1000000, elapsedMs: 2000 },
  );
  const result = await measureDownload(transport, {
    host: '10.0.0.1',
    port: 3000,
    path: '/download?bytes=1000000',
    expectedBytes: 1000000,
    timeoutMs: 15000,
  });
  expect(result.ok).toBe(true);
  expect(result.direction).toBe('download');
  expect(result.mbps).toBe(4);
  expect(transport.downloadCalls).toHaveLength(1);
  expect(transport.downloadCalls[0]?.path).toBe('/download?bytes=1000000');
});

test('download rejects invalid sizes without touching the transport', async () => {
  const transport = new FakeTransport();
  for (const expectedBytes of [0, -100, NaN]) {
    const result = await measureDownload(transport, {
      host: '10.0.0.1',
      port: 3000,
      path: '/download',
      expectedBytes,
      timeoutMs: 15000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid-expected-bytes');
    expect(result.mbps).toBe(0);
  }
  expect(transport.downloadCalls).toHaveLength(0);
});

test('failed transfers keep partial bytes with zero Mbps', async () => {
  const transport = new FakeTransport(
    () => ({ ok: true, rttMs: 10 }),
    { ok: false, error: 'incomplete', bytesTransferred: 400000, elapsedMs: 1000 },
  );
  const result = await measureDownload(transport, {
    host: '10.0.0.1',
    port: 3000,
    path: '/download?bytes=1000000',
    expectedBytes: 1000000,
    timeoutMs: 15000,
  });
  expect(result.ok).toBe(false);
  expect(result.error).toBe('incomplete');
  expect(result.bytesTransferred).toBe(400000);
  expect(result.mbps).toBe(0);
});

test('zero-duration transfers yield 0 Mbps instead of Infinity', async () => {
  const transport = new FakeTransport(
    () => ({ ok: true, rttMs: 10 }),
    { ok: true, bytesTransferred: 1000000, elapsedMs: 0 },
  );
  const result = await measureDownload(transport, {
    host: '10.0.0.1',
    port: 3000,
    path: '/download?bytes=1000000',
    expectedBytes: 1000000,
    timeoutMs: 15000,
  });
  expect(result.ok).toBe(true);
  expect(result.mbps).toBe(0);
});

test('upload reports Mbps and validates its payload', async () => {
  const transport = new FakeTransport(
    () => ({ ok: true, rttMs: 10 }),
    { ok: true, bytesTransferred: 1000000, elapsedMs: 1000 },
    { ok: true, bytesTransferred: 500000, elapsedMs: 1000 },
  );
  const ok = await measureUpload(transport, {
    host: '10.0.0.1',
    port: 3000,
    path: '/upload',
    payloadBytes: 500000,
    timeoutMs: 15000,
  });
  expect(ok.ok).toBe(true);
  expect(ok.direction).toBe('upload');
  expect(ok.mbps).toBe(4);

  const bad = await measureUpload(transport, {
    host: '10.0.0.1',
    port: 3000,
    path: '/upload',
    payloadBytes: 0,
    timeoutMs: 15000,
  });
  expect(bad.ok).toBe(false);
  expect(bad.error).toBe('invalid-payload-bytes');
  expect(transport.uploadCalls).toHaveLength(1);
});

test('a throwing transport becomes a failed result, never a throw', async () => {
  const transport = new FakeTransport();
  const latency: {
    download: () => Promise<never>;
    upload: () => Promise<never>;
  } = {
    download: async () => {
      throw new Error('socket gone');
    },
    upload: async () => {
      throw new Error('socket gone');
    },
  };
  transport.download = latency.download;
  transport.upload = latency.upload;
  const download = await measureDownload(transport, {
    host: '10.0.0.1',
    port: 3000,
    path: '/download?bytes=10',
    expectedBytes: 10,
    timeoutMs: 100,
  });
  expect(download.ok).toBe(false);
  expect(download.error).toBe('socket gone');
  const upload = await measureUpload(transport, {
    host: '10.0.0.1',
    port: 3000,
    path: '/upload',
    payloadBytes: 10,
    timeoutMs: 100,
  });
  expect(upload.ok).toBe(false);
  expect(upload.error).toBe('socket gone');
});

test('buildDownloadPath appends the byte count correctly', () => {
  expect(buildDownloadPath('/download', 1000000)).toBe(
    '/download?bytes=1000000',
  );
  expect(buildDownloadPath('/download?token=abc', 500)).toBe(
    '/download?token=abc&bytes=500',
  );
});
