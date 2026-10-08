# Architecture

How the Network QoS Monitor is put together, seam by seam. The README states
the shape; this document states the mechanics: what each layer owns, what the
contracts are, and why the bulk of the product runs under Jest on Windows with
no device.

## Layer map

```
┌─────────────────────────────────────────────────────────────┐
│ Screens  Status · Measure · Map · History · Export (RN)     │
│          subscribe to stores, render; never open sockets     │
├─────────────────────────────────────────────────────────────┤
│ Stores   networkStore · visualizationStore · backgroundStore │
│          (Zustand — the ONLY cross-layer contract, ADR-9)    │
├──────────▲───────────────────────────────▲──────────────────┤
│          │ publishes               hooks │ read via          │
│ Measurement engine          Persistence repository          │
│ probe · stats · throughput  op-sqlite · queries · geo        │
│ (pure TS + injected         (pure SQL builders + injected    │
│  transport)                  Database)                      │
├─────────────────────────────────────────────────────────────┤
│ Native edge  TurboModule spec · HeatMapView · background     │
│ fetch registration · Notifee · geolocation (thin adapters)   │
└─────────────────────────────────────────────────────────────┘
```

Module inventory (`app/src/`):

| Directory | Owns | Imports native code? |
|---|---|---|
| `measurement/` | Probe scheduler, RTT/jitter/loss stats, throughput, engine | No — `TcpTransport` is injected |
| `data/` | Schema, SQL builders, repository, geo contracts | Only `database.ts` / `geoNative.ts` (the edge); `queries.ts`, `repository.ts`, `geo.ts` are pure |
| `telemetry/` | Native-module consumer, NetInfo composition | Yes, behind `applyNativeTelemetry()` |
| `specs/` | `NativeNetworkTelemetry.ts` codegen spec | Yes (codegen input) |
| `store/` + `visualization/*Store` + `background/*Store` | UI + job state | No |
| `visualization/heat`, `charts/`, `history/` | Aggregation, SVG paths, summaries, filters | No |
| `background/` | Pass orchestration, degradation thresholds | Lazily (dynamic import), never at module scope |
| `export/` | CSV/JSON serializers (pure) + share glue | Only `Share` in the thin glue |
| `screens/` | Composition of the above | Via hooks only |

## The Zustand seam (ADR-9)

Three stores, one rule: **stores hold state, never perform work.**

- `store/networkStore.ts` — connectivity snapshot. `mapNetInfoToSnapshot()`
  is a pure NetInfo→snapshot mapper (tested); the Stage 2 native module
  overlays `subtype`/`signalDbm`/`cellIdentity` through the
  `NativeTelemetryPatch` contract without touching selectors.
- `visualization/visualizationStore.ts` — active tab, heat metric,
  selected session, demo overlay. The tab lives here so any screen can
  request a switch without prop drilling; the metric is shared by the map
  and the history detail.
- `background/backgroundStore.ts` — job status (`scheduled`/`running`/
  `error`), last run timestamp and outcome. The only way the UI observes
  WorkManager.

Async reads stay in screen-level hooks (`visualization/history/useSessionData.ts`):
the repository is constructed, `init()` runs, sessions load, failures become
error state. No store module imports the database, which is why every store
test runs without op-sqlite.

## Injection seams

Each boundary with the outside world is a constructor/factory parameter, not
an import. Tests pass fakes; the device path passes real adapters.

| Seam | Contract | Device implementation | Fake in tests |
|---|---|---|---|
| TCP transport | `TcpTransport` (`measurement/types.ts`) | `react-native-tcp-socket` (`measurement/transport.ts`) | In-memory socket with scripted RTTs |
| Storage | `Database` (`data/database.ts`) | `op-sqlite` (`openAppDatabase()`) | Row-array double executing `QuerySpec`s |
| Position | `GeoLocator` (`data/geo.ts`) | `@react-native-community/geolocation` (`data/geoNative.ts`) | Fixed coordinate |
| Notification | `(reason: string) => Promise<unknown>` | Notifee (`notifications/notifee.ts`) | Recorder fn |
| Clock | `() => number` / `now` options | `Date.now` | Fixed epoch |

Consequences worth naming:

- `measurement/engine.ts` never knows what a socket is; `data/repository.ts`
  never knows what SQLite is; `background/backgroundTask.ts` resolves all five
  deps in `resolveDeps()` and every native module loads via dynamic import so
  importing the file under Jest (or on a broken native side) cannot throw.
- `export/shareExport.ts` receives the repository as an argument and shares
  through React Native's built-in `Share` — no new dependency for RF-08.

## Data flow: one measurement pass

1. Foreground: the engine runs probes (`probe.ts`: TCP connect to port 443
   per host) and, when configured, a throughput transfer (`throughput.ts`:
   `GET /download?bytes=N`, `POST /upload`, Mbps measured on-device).
2. Statistics (`stats.ts`: mean, min/max, p50/p90/p95, RFC 3550 jitter, loss
   ratio) collapse raw samples into a `MeasurementSet`.
3. The repository expands the set into one row per host
   (`measurementSetToSamples`), stamps coordinates + network type, and writes
   under a session id. No coordinates → `MissingCoordinatesError`, whole set
   rejected: partial sets are never stored.
4. Foreground: the Measure screen calls `measureController` (outside React,
   so auto-repeat survives tab switches), which runs `runForegroundPass()`:
   probes the user-configured hosts (≥3, persisted in `app_settings`), runs
   download/upload against the reference backend, publishes to the
   measurement store and, inside an active walk, saves the set with GPS,
   network type and live dBm.
5. Background: `runBackgroundMeasurementPass()` repeats the same path with
   `{ probe: DEFAULT_PROBE_CONFIG, throughput: null }` — probes-only, no
   megabyte download in a headless window — under the rolling `'background'`
   session, then runs `detectDegradation()` thresholds and notifies.
6. Presentation reads through hooks into summaries (`history.ts`), heat cells
   (`heat/heat.ts`: grid aggregation, score normalization, color mapping) and
   chart series (`charts/`), rendered by `LineChart` (react-native-svg paths)
   and `HeatMapView` (OSM raster tiles as Images + SVG circles; projection
   and tile math in `heat/tiles.ts`).

## Query shapes (RF-04 → RF-09)

`data/queries.ts` builds every SQL string plus positional params with no
native import, so all shapes are unit-tested:

- `selectSessions` / `selectSessionById` / `insertSession` / `updateSessionEnd`
- `selectSamplesByDateRange` (edges ordered, inclusive `BETWEEN`)
- `selectSamplesByNetworkType`
- `selectSamplesByBoundingBox` (`normalizeBoundingBox` orders inverted edges
  and clamps to ±90/±180; antimeridian-crossing boxes must be split by the
  caller — documented in the function)
- `selectSamplesBySession`, all with `ORDER BY` + `LIMIT`/`OFFSET` paging
  (offset requires limit: `LIMIT -1 OFFSET ?` keeps the builder honest)

RF-09 filtering happens in memory over `SessionSummary`s in
`visualization/history/history.ts` (network clause, date window,
bounding-box intersection via `WORLD_AREA` semantics, name query) while the
SQL builders cover the storage-level equivalents. Both are pure and tested;
the History screen only renders what they return.

## Testing strategy

- **Jest on Windows, no device:** 23 suites / 176 tests covering stats,
  engine, probe scheduling, throughput math, SQL builders, repository mapping,
  heat aggregation, chart series, history summaries/filters/formatting,
  export serializers, degradation thresholds, background-pass orchestration,
  permission mapping and all three stores.
- **Not under Jest (by decision):** `HeatMapView` (all its math lives in
  tested `heat.ts` / `tiles.ts`), `useSessionData`
  (op-sqlite has no Node harness — failures surface as error state), native
  Kotlin/Swift and WorkManager cadence (device-only).
- **Deterministic fixtures:** the demo walk (`visualization/testing/seedWalk.ts`)
  is seeded (LCG) — tests, emulator screenshots and the future demo video all
  see the same synthetic walk, always labeled as demo.
