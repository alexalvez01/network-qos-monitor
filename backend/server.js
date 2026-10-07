'use strict';

/**
 * Reference throughput backend (PLAN.md "Reference backend", ADR-5).
 *
 * The app measures throughput client-side over RAW TCP sockets
 * (app/src/measurement/transport.ts): it hand-writes
 * `GET <path> HTTP/1.1` / `POST <path> HTTP/1.1` and counts bytes on the
 * device. This server only has to serve a fixed-size payload and echo an
 * upload byte count. Mbps is never computed here.
 *
 * Wire contract (exactly what transport.ts sends):
 * - Download: `GET /download?bytes=N` with `Connection: close`. The client
 *   counts body bytes after the `\r\n\r\n` header delimiter and parses the
 *   `Content-Length` header, so the response MUST carry an accurate
 *   Content-Length and exactly N body bytes.
 * - Upload: `POST /upload` with `Content-Length: M`, NO Content-Type header,
 *   followed by M filler bytes. The client completes on the first response
 *   bytes (or server close) and counts the bytes IT sent — the JSON echo
 *   body `{"receivedBytes": M}` is a cross-check, not the measurement.
 *
 * No CORS: the app uses react-native-tcp-socket (plain TCP), not
 * fetch/XHR, so browsers and preflights are never involved.
 */

const Fastify = require('fastify');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 MB ceiling per response

// Allocated ONCE at startup and sliced per request (slice shares memory,
// no copy, no per-request allocation). Filled with ASCII 'x' to mirror the
// filler payload the app sends on upload.
const PAYLOAD = Buffer.alloc(MAX_DOWNLOAD_BYTES, 0x78);

const fastify = Fastify({
  logger: true,
  bodyLimit: 32 * 1024 * 1024, // accept uploads up to 32 MB
});

// The app's POST carries no Content-Type header, so parse every body as raw
// bytes instead of relying on Fastify's JSON parser.
fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => {
  done(null, body == null ? Buffer.alloc(0) : body);
});

fastify.get('/download', async (request, reply) => {
  const wanted = Math.floor(Number(request.query.bytes));
  if (!Number.isFinite(wanted) || wanted <= 0) {
    return reply
      .code(400)
      .send({ error: 'query parameter "bytes" must be a positive integer' });
  }
  // Clamp oversized requests instead of failing: the client treats a short
  // body (Content-Length < expected) as 'incomplete'.
  const size = Math.min(wanted, MAX_DOWNLOAD_BYTES);
  return reply
    .header('Content-Length', size)
    .type('application/octet-stream')
    .send(PAYLOAD.subarray(0, size));
});

fastify.post('/upload', async (request, reply) => {
  const body = request.body;
  const receivedBytes = Buffer.isBuffer(body) ? body.length : 0;
  return reply.send({ receivedBytes });
});

async function start() {
  // 0.0.0.0 so a phone on the same LAN can reach the service.
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
}

// Only listen when run directly (`node server.js` / `npm start`).
// Requiring this module (e.g. `node -e "require('./server.js')"`) must exit.
if (require.main === module) {
  start().catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });
}

module.exports = { fastify, start, MAX_DOWNLOAD_BYTES };
