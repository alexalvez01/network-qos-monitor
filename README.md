# Network QoS Monitor

A React Native (CLI) app that measures mobile network quality — latency, jitter,
loss and throughput — tags each pass with GPS, persists it in on-device SQLite,
and renders coverage as a map heat layer, time-series charts and a filterable
history. Built as a university deliverable (FCyT, Concepción del Uruguay).

**Status: all 7 stages implemented.** What remains is runtime proof on real
hardware: RSSI/carrier (Android device), background passes with the screen off,
and the demo video. See [Limitations](#limitations-stated-plainly).

## Quick path

```bash
git clone <repo-url>
cd TP5/app
npm install
npm run android            # or: npx react-native run-android
```

Prerequisites (verified on the author's machine, PLAN.md §1):

| Component | Value |
|---|---|
| Node / npm | v24.14.0 / 11.11.0 |
| JDK | Android Studio's bundled JBR (OpenJDK 25.0.2) — set `JAVA_HOME` to `<Android Studio>\jbr` |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk` — set `ANDROID_HOME` there; `app/android/local.properties` also pins `sdk.dir` so the build does not depend on ambient variables |
| SDK platform | `android-37` (matches RN 0.87's `compileSdk 37`); `minSdk 24`, `targetSdk 36` |
| Build | Hermes on, New Architecture on; cold `assembleDebug` takes ~6.5 minutes — budget for it |

Verify the checkout before touching anything:

```bash
cd app
npm test            # Jest — pure-TS layers, no device needed
npm run lint        # ESLint
npx tsc --noEmit    # TypeScript
```

## What it measures

| RF | Feature | Where |
|---|---|---|
| RF-01 | Connection class + radio subtype, dBm, cell identity | `src/store/networkStore.ts`, `src/telemetry/`, `src/specs/` (TurboModule spec) |
| RF-02 | RTT / jitter / loss over TCP connect probes | `src/measurement/probe.ts`, `stats.ts`, `engine.ts` |
| RF-03 | Download / upload throughput vs the reference backend | `src/measurement/throughput.ts` |
| RF-04 | Sessions + samples in SQLite, queryable by date and box | `src/data/` |
| RF-05 | Coverage heat layer over OSM tiles | `src/visualization/heat/`, `heatLayer/` |
| RF-06 | Walk list + latency/throughput charts | `src/screens/HistoryScreen.tsx`, `visualization/charts/` |
| RF-07 | Periodic background sampling + degradation alert | `src/background/`, `src/notifications/` |
| RF-08 | CSV / JSON export through the share sheet | `src/export/` |
| RF-09 | History filters: network type, date range, area | `src/visualization/history/history.ts` |

## Architecture

Four layers. Dependencies point inward; layers never import each other's
internals. Full version: `docs/architecture.md`.

```
Measurement (engine, probe, throughput — pure TS)
    │ publishes results
    ▼
State (Zustand stores — the ONLY cross-layer contract, ADR-9)
    ▲ subscribes              ▲ reads via hooks
Visualization (screens, map, charts)      Persistence (op-sqlite via repository)
    └── background passes and export also talk to the stores, never to screens
```

- **The Zustand seam (ADR-9).** `networkStore`, `visualizationStore`,
  `backgroundStore` hold UI state only. Async work (repository reads, socket
  passes) lives in engines and screen-level hooks. No store imports native
  code, so every store loads under Jest.
- **Injection seams (testability without a device).** Each seam takes its
  dependency as a parameter: the engine takes a `TcpTransport`, the repository
  takes a `Database`, background passes take transport/repository/locator/
  notify/clock overrides, export takes the repository. Tests inject fakes;
  the device path injects `react-native-tcp-socket`, `op-sqlite`, the system
  locator. Nothing in these modules imports a native module at scope.
- **Pure-TS core.** Probe scheduling, RFC 3550 jitter, loss ratios, Mbps math,
  percentiles, SQL builders, heat aggregation, chart series, history summaries
  and history filters are plain TypeScript with zero React/React Native
  imports — 152 Jest tests run on Windows with no emulator.
- **Native edge (thin by design).** TurboModule spec
  (`src/specs/NativeNetworkTelemetry.ts`) implemented in Kotlin/Swift for radio
  data; `HeatMapView` turns pre-aggregated cells into map circles; background
  fetch delegates cadence to WorkManager. All branching logic stays in TS.

## Decisions (ADR-1…ADR-10, condensed)

| ADR | Decision |
|---|---|
| 1 | Native telemetry is a codegen TurboModule, event-driven (methods for one-shot reads, native events for signal/network changes) — not a legacy bridge module. |
| 2 | iOS exposes **network type only**. Carrier is scrubbed since iOS 16.4, RSSI was never public; the UI shows "unavailable on this platform", never fabricated values. Android keys the heatmap on dBm, iOS on latency/throughput. |
| 3 | Background sampling is guaranteed on Android (WorkManager) and **opportunistic on iOS** (`BGAppRefreshTask` on the OS energy budget). Declared scope, not a shortfall. |
| 4 | Latency = **TCP connect() time to port 443** (one round trip): no ICMP (blocked on mobile nets, unreachable from JS), no TLS (extra round trips contaminate the sample). Default hosts `1.1.1.1`, `8.8.8.8`, `9.9.9.9`. |
| 5 | Throughput is computed **client-side over raw sockets** against a dumb backend, so server latency and `fetch` overhead never skew Mbps. |
| 6 | Persistence is SQLite via **`@op-engineering/op-sqlite`** (JSI, New Architecture): time-range scans, network filters and bounding-box queries are exactly what SQL indexes are for. `react-native-sqlite-storage` (legacy bridge) and WatermelonDB (unneeded sync) were rejected. |
| 7 | Heat layer = translucent radius-weighted circles over **OSM raster tiles** — no map-provider token for a university deliverable. |
| 8 | Charts are drawn with **`react-native-svg` directly** — `victory-native` would pull Skia + Reanimated for two line charts. |
| 9 | **Zustand is the single reactive seam** between background work and UI; sockets and timers stay off the render path. |
| 10 | **Android is the dev loop** (local builds), **iOS is the validation device** (the only real hardware available); shared TypeScript is the bulk of the product and serves both. Android carries the full RF set; iOS carries RF-02…RF-09 plus a deliberately reduced RF-01. |

## Reference backend

Throughput needs a payload server. It lives in `backend/` (separate
deliverable) as a Fastify service with exactly two endpoints the app depends on:

- `GET /download?bytes=N` — serves a fixed buffer of N bytes.
- `POST /upload` — echoes the byte count.

The app reads only `mbps = bytes / elapsed` on-device (ADR-5); any server that
honours that contract works. Point the app at it via the throughput config in
`src/measurement/types.ts`.

## Limitations, stated plainly

The brief asks for these explicitly. Deeper version: `docs/limitations.md`.

1. **iOS background sampling is opportunistic, not guaranteed** (ADR-3). The OS
   decides when `BGAppRefreshTask` fires; "every 15 minutes with the app
   closed" is not achievable on iOS as literally specified.
2. **iOS exposes network type only** (ADR-2). Carrier returns placeholders
   since iOS 16.4 and RSSI was never public; the heatmap falls back to
   latency/throughput and missing fields render as "Not available".
3. **`@notifee/react-native` (9.1.8, no release since 2024-12) is unverified
   against RN 0.87 at runtime.** It compiles and autolinks; notification
   display still needs a real-device confirmation.
4. **OSM tiles via `UrlTile` cannot carry an identifying User-Agent header.**
   Zoom is capped at 18 and tile volume is modest (one raster layer, no
   prefetch), which mitigates but does not remove the policy caveat.
5. **Measure on real 4G/5G for a credible demo, not campus Wi-Fi.** Wi-Fi
   numbers misrepresent the mobile-QoS premise of the brief.
6. **Background passes are probes-only (no throughput)** to fit the headless
   time/battery budget — background history covers latency/loss/jitter only.

## Demo video

Not yet recorded. **It must be recorded on a real Android device by the owner:**
a walk on cellular data showing the Status readouts, the heat layer painting,
a History walk with charts, and one background pass accumulating. No
placeholder is included — a video of an emulator would misrepresent the radio
behaviour this app exists to measure.

## Repository layout

```
TP5/
├── PLAN.md                 # implementation plan, stages, risk register
├── README.md               # this document
├── docs/
│   ├── architecture.md     # layers, seams, module map, testing strategy
│   └── limitations.md      # platform and dependency caveats, in depth
├── app/                    # React Native CLI application (RN 0.87.1)
│   └── src/
│       ├── measurement/    # engine, probes, throughput, stats (pure TS)
│       ├── data/           # SQLite schema, queries, repository, geo (pure + thin native edge)
│       ├── telemetry/      # native-module consumer, NetInfo composition
│       ├── store/          # network Zustand store
│       ├── visualization/  # heat math, charts, history filters, theme, stores
│       ├── background/     # WorkManager passes, degradation detection, store
│       ├── notifications/  # Notifee wrapper
│       ├── export/         # CSV/JSON serializers + share-sheet glue
│       ├── permissions/    # runtime permission flow
│       └── screens/        # Status, Map, History, Export
└── backend/                # Fastify reference server (separate deliverable)
```

## Review checklist

- [ ] `npm test` green (19 suites, 152 tests), `npx tsc --noEmit` exit 0
- [ ] Filters combine (link + date + area) and Clear restores the full list
- [ ] Every screen states loading / error / empty explicitly — no blank surface
- [ ] No screen fabricates carrier or dBm where the platform withholds them
- [ ] Demo data is always labeled "demo" (map overlay, seed walk name)
