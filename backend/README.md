# Reference throughput backend — run it and point the app at it

Two-endpoint Fastify service the app measures against: `GET /download?bytes=N`
serves a fixed-size payload, `POST /upload` echoes the received byte count.
Throughput (Mbps) is computed on the device — this server only moves bytes.

## Quick path

1. Start it (pick one):
   - Node: `npm install && npm start`
   - Docker: `docker build -t qos-backend . && docker run -p 3000:3000 qos-backend`
2. Point the app at it: in `app/src/measurement/types.ts`,
   `DEFAULT_THROUGHPUT_CONFIG` defaults to `host: '127.0.0.1', port: 3000`.
   Replace `host` with this machine's LAN IP (e.g. `192.168.1.20`) — a phone
   cannot reach your loopback — and keep `port: 3000` unless you changed `PORT`.
3. Verify: `Invoke-WebRequest http://<host>:3000/download?bytes=1024` should
   return 1024 bytes; a POST to `http://<host>:3000/upload` should return
   `{"receivedBytes": <sent>}`.

## Details

| Topic | Decision |
|-------|----------|
| Endpoints | `GET /download?bytes=N` → `application/octet-stream`, exact `Content-Length: N`; `POST /upload` → `{"receivedBytes": M}`. Nothing else exists. |
| Fixed buffer | One 20 MB buffer is allocated at startup and sliced per request — never re-allocated. Requests above 20 MB are clamped, not rejected. |
| Upload parsing | The app sends raw bytes with no `Content-Type`, so every request body is read as a buffer. `receivedBytes` is the raw body length. |
| Bind address | `0.0.0.0` (LAN-reachable). Override the port with `PORT=4000 npm start` or `-e PORT=4000 -p 4000:4000` in Docker. |
| No CORS | The app uses `react-native-tcp-socket` (plain TCP, hand-written HTTP/1.1), not fetch/XHR — preflights never happen. |
| Errors | `GET /download` without a positive `bytes` returns `400 { "error": ... }`. |

## Checklist

- [ ] Server logs `listening at http://0.0.0.0:3000` on start.
- [ ] Phone and computer are on the same Wi-Fi/LAN.
- [ ] App `ThroughputConfig.host` is the computer's LAN IP, not `127.0.0.1`.
- [ ] Android emulator (if used instead of a phone) reaches the host via `10.0.2.2`.

## Next step

Run a Stage 3 headless measurement against it (`downloadBytes: 1000000`,
`uploadBytes: 500000` in `DEFAULT_THROUGHPUT_CONFIG`) and confirm Mbps shows
up in the measurement set.
