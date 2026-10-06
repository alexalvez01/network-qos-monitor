# Network QoS Monitor — Implementation Plan

**Course**: Desarrollo de Aplicaciones Móviles 2026 — FCyT, Concepción del Uruguay
**Career**: Licenciatura en Sistemas de Información
**Stack mandate**: React Native CLI (Expo Go is explicitly ruled out by the brief — custom native modules are required)

---

## 1. Environment Audit (verified 2026-10-05)

Everything below was probed on the actual machine, not assumed.

| Component | Status | Notes |
|---|---|---|
| Node | `v24.14.0` | OK |
| npm | `11.11.0` | OK |
| Git | `2.53.0.windows.1` | OK |
| JDK | **OpenJDK 25.0.2, NOT on PATH** | Bundled as Android Studio's JBR at `C:\Program Files\Android\Android Studio\jbr` |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | **unset** | SDK exists at `%LOCALAPPDATA%\Android\Sdk` |
| Android platforms | **only `android-37.0`** | No `android-36` |
| Build tools | `36.0.0` | OK |
| `cmdline-tools` / `sdkmanager` | **absent** | Cannot install additional SDK packages from the shell |
| `platform-tools` (`adb`), emulator, system-images | present | `android-37.1` image |

### Toolchain baseline — VERIFIED by a real build

`npx @react-native-community/cli@latest init NetworkQoSMonitor --directory app --version 0.87.1`, followed by
`./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a` against JBR 25.

**Result: `BUILD SUCCESSFUL` in 6m32s — `app-debug.apk`, 36.96 MB.**

What the build proved, replacing two assumptions with evidence:

- **R1 — resolved.** Gradle 9.4.1 (pinned by the RN 0.87 wrapper) runs on OpenJDK 25.0.2 without complaint. No JDK 21 install needed.
- **R2 — resolved.** RN 0.87 pins `compileSdk 37`, which matches the pre-installed `android-37.0` platform. AGP's own SDK downloader supplied `build-tools 37.0.0`, `cmake 3.22.1` and the NDK on demand, with `android-sdk-license` already accepted. **`cmdline-tools` is therefore not a blocker** — the assumption that a missing `sdkmanager` would break the build was wrong.
- `minSdk 24`, `targetSdk 36`, Hermes on, New Architecture on (`newArchEnabled=true`).
- `android/local.properties` pins `sdk.dir` explicitly so the build does not depend on ambient environment variables.
- Cosmetic only: a `package=` attribute warning from `react-native-safe-area-context`. Harmless.

Remaining toolchain caveat: build times are ~6.5 minutes cold. Budget for that rather than assuming fast iteration.

---

## 2. Dependency Health Check (verified against the npm registry)

The brief suggests libraries. Two of them have rotted since the brief was written.

| Suggested in brief | Latest | Last publish | Verdict |
|---|---|---|---|
| `@react-native-community/netinfo` | 12.0.1 | 2026-02 | Healthy |
| `react-native-tcp-socket` | 6.4.3 | 2026-09 | Healthy |
| `react-native-maps` | 1.29.11 | 2026-09 | Healthy |
| `react-native-background-fetch` | 4.4.2 | 2026-04 | Healthy |
| `react-native-svg` | 15.15.5 | 2026-05 | Healthy |
| `zustand` | 5.0.15 | 2026-08 | Healthy |
| **`react-native-geolocation-service`** | 5.3.1 | **2022-09** | **Abandoned (~4 years). Do not use.** Replace with `@react-native-community/geolocation` (official successor, 3.4.0, 2024-09). |
| **`react-native-sqlite-storage`** | 6.0.1 | 2025-02 | **Legacy bridge, effectively abandoned.** Replace with `@op-engineering/op-sqlite` (18.2.5, 2026-09, JSI + New Architecture). |
| **`@notifee/react-native`** | 9.1.8 | **2024-12** | **No release in ~22 months.** Works, but unverified against RN 0.87. Spike it in Stage 1. |

### Dependency spike — PASSED (verified by build, not assumed)

All nine packages installed with no peer-dependency conflicts, and `:app:assembleDebug` stayed green.

**Result: `BUILD SUCCESSFUL` in 2m51s — `app-debug.apk`, 59.54 MB** (36.96 MB before the dependencies).

Autolinking confirmed for every native package: `react-native-community_netinfo`, `react-native-community_geolocation`, `op-engineering_op-sqlite` (compiles real C++ via CMake), `react-native-tcp-socket`, `react-native-maps`, `react-native-svg`, `react-native-background-fetch`, `notifee_react-native`, plus the template's `react-native-safe-area-context`.

**What a green build does not prove.** Compilation is not runtime. A library can compile cleanly against the New Architecture and still fail at runtime if its JS side expects the legacy bridge. `@notifee/react-native` (no release since 2024-12) and `@react-native-community/geolocation` (2024-09) are the two to watch. Both need a real device to confirm — that is Stage 1's remaining exit criterion, not the build.

### Android manifest gaps — the actual work of Stage 1

The generated manifest declares exactly one permission: `INTERNET`. Every requirement below is therefore still blocked, and each line is a prerequisite for a specific RF.

| Must add | Blocks | Notes |
|---|---|---|
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | RF-04, RF-05 | Runtime request required, not just declaration |
| `READ_PHONE_STATE` | RF-01, RF-05 | `TelephonyManager` and `SubscriptionManager` both refuse without it |
| `POST_NOTIFICATIONS` | RF-07 | Runtime request on Android 13+; a notification that silently never appears is worse than none |
| `ACCESS_NETWORK_STATE` | RF-01 | NetInfo reads more accurately with it |
| `ACCESS_BACKGROUND_LOCATION` | RF-07 | Separate grant, separate screen in Android 11+ — cannot be bundled with the foreground grant |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` | RF-07 | Required for a foreground service on Android 14+ |
| `RECEIVE_BOOT_COMPLETED` | RF-07 | Re-register the WorkManager job after reboot, or background sampling silently stops |

### Map provider decision — no API key

`react-native-maps` on Android renders a blank, grey map and logs an authorization failure unless `com.google.android.geo.API_KEY` is present in the manifest. ADR-7 already ruled out depending on a provider token, so the map will use OpenStreetMap raster tiles through react-native-maps' `UrlTile`, which needs no account and no key. Tile requests must carry an identifying `User-Agent` to respect the OSM tile usage policy.


---

## 3. Architecture Decisions

### ADR-1 — Native telemetry module: TurboModule with codegen, event-driven

React Native 0.80+ defaults to the New Architecture and 0.87 is well past legacy-bridge deprecation. A hand-written legacy `ReactContextBaseJavaModule` would be building on a deprecated foundation. The module is declared as a spec (`NativeNetworkTelemetry.ts`) consumed by codegen, implemented in Kotlin and Swift.

Signal strength and cell registration change on their own cadence. Polling them from JS would burn battery and deliver stale data. The module therefore exposes:

- **Methods** for one-shot reads (`getCurrentNetworkInfo()`).
- **Native events** (`onSignalStrengthChanged`, `onNetworkStateChanged`) emitted from the platform's own listeners.

**Android source APIs**: `TelephonyManager.getDataNetworkType()`, `TelephonyCallback.SignalStrengthsListener` (API 31+; `PhoneStateListener` below that), `CellInfoLte` / `CellSignalStrengthLte.getDbm()`, `CellSignalStrengthNr.getDbm()` for 5G, `SubscriptionManager` for per-SIM attribution, and `CellIdentityGsm`/`Cdma`/`Nr` for cell tower identifiers that can feed OpenCelliD.

### ADR-2 — iOS exposes almost nothing. Verified, not assumed

This ADR was originally written as "iOS gives network type + carrier". **That was wrong, and the correction matters.**

| Capability | Android | iOS |
|---|---|---|
| Network type (LTE / 5G NR / WiFi) | ✅ `getDataNetworkType()` | ✅ `serviceCurrentRadioAccessTechnology` |
| Carrier name, MCC, MNC, ISO country | ✅ | ❌ **scrubbed since iOS 16.4** — returns `--` / `65535` on real devices too |
| Signal strength in dBm | ✅ `CellSignalStrength.getDbm()` | ❌ never public; `MXCellularConditionMetric` gives 24h histogrammed bars only |
| SIM presence | ✅ | ❌ undetectable |
| Signal on iOS Simulator | — | ❌ `CTCarrier` is `nil` — Simulator has no telephony at all |

Two separate platform limits, often conflated:

1. **Carrier is dead on modern iOS.** Apple deprecated `CTCarrier` in iOS 16.4 and made it return static placeholders for privacy. This affects **real iPhones**, not only the Simulator. An app that displays `carrier.carrierName` shows `--` in 2026.
2. **Signal strength was never available.** Getting it requires a private API plus a carrier entitlement that third-party apps are not granted. `MetricKit` returns only bars over a 24-hour histogram — no dBm, no timestamps.

Consequences for this project:

- RF-01 on iOS delivers **network type only**. Carrier display must show "unavailable on this platform", never a blank or a fabricated value.
- RF-05 on iOS has **no signal dimension**. The heatmap must key on latency/throughput instead. On Android it can key on dBm.
- The iOS Simulator is useless for telephony, so RF-01 cannot be validated there either — a real iPhone is required even to see the network type.
- NetInfo still provides connection type (WiFi/cellular) on iOS, which is why RF-01 must be built as a **composition**: NetInfo for the connection class, CoreTelephony for the radio access technology, and neither for carrier or RSSI.

Documenting these as real platform constraints is worth more in the defense than faking them.

### ADR-3 — Background sampling: Android guaranteed, iOS best-effort and declared

RF-07 asks for periodic sampling "with the app closed or the device locked".

- **Android** — `react-native-background-fetch` on WorkManager. Real, user-visible, periodic. Deliverable as specified.
- **iOS** — `BGAppRefreshTask` is scheduled by the OS on its own energy budget. There is no API that guarantees periodicity for a terminated app. Not achievable as literally specified.

Scope is therefore declared: **Android delivers RF-07 as written; iOS delivers opportunistic refresh plus a documented limitation.** The brief explicitly asks the README to state limitations, so this is the intended shape of the deliverable, not a shortfall.

### ADR-4 — Probe TCP connect time, not ICMP and not TLS

RF-02 asks for RTT against 3+ hosts. ICMP is blocked or rate-limited on many mobile networks and is not reachable from JS anyway. TLS handshakes to port 443 add a second and third round trip, contaminating the sample.

Measurement target is **TCP connect() completion time to port 443** — exactly one round trip, which is a clean and defensible QoS metric. Default hosts (all stable, all reachable from AR): `1.1.1.1`, `8.8.8.8`, `9.9.9.9`. Configurable per RF-02.

- **Jitter** — RFC 3550 style: mean absolute successive difference of consecutive RTT samples.
- **Loss** — probes carry sequence IDs; unanswered probes over a window give the loss ratio.

### ADR-5 — Throughput measured client-side over raw sockets

The reference backend exists only to serve a fixed-size payload and to echo an upload. Mbps is computed on the device from bytes transferred over measured elapsed time. This keeps the measurement independent of the server's own latency and avoids `fetch`/`XMLHttpRequest` overhead skewing the numbers.

### ADR-6 — Persistence: SQLite via `op-sqlite`

The query shape is exactly what SQL indexes are good at: time-range scans, network-type filters, bounding-box geo queries. WatermelonDB adds sync machinery this app does not need. `op-sqlite` is JSI-based and New-Architecture native. One indexed table plus a session table.

### ADR-7 — Heatmap rendered natively, no map provider token

`react-native-maps` has no heatmap layer. The Mapbox alternative requires an account and an API token, which is a poor thing to make a university deliverable depend on. The heat layer is instead a set of translucent, radius-weighted circles composited over the map — deterministic, token-free, and explainable from first principles.

### ADR-8 — Charts drawn with `react-native-svg` directly

`victory-native` pulls in Skia and Reanimated for what this app needs (two or three line charts). Drawing the paths directly keeps the dependency graph small and makes the rendering explainable in the document.

### ADR-9 — Zustand as the single reactive seam

Layers never import each other's internals. The Measurement Engine publishes to the store; the Presentation Layer subscribes. The store is the only contract between background work and UI, which is what keeps sockets and timers off the render path.

---

## 4. Stage Plan

> **Sequencing change vs. the brief.** The brief installs each native dependency in the stage that first uses it. That defers every compatibility discovery to weeks 4–7, when there is no time left to react. Stage 1 below instead installs **every** native dependency and proves a green debug build immediately, so the risk surface is known in week 1.

### Stage 0 — Toolchain (half day)
Set `JAVA_HOME` to the JBR (fall back to a JDK 21 install if Gradle rejects 25). Set `ANDROID_HOME`. Install `cmdline-tools` via Android Studio's SDK Manager. Confirm `./gradlew` runs.
**Exit**: `./gradlew --version` succeeds on a supported JDK, and the SDK platform RN 0.87 requires is present.

### Stage 1 — Spike and baseline (1 week)
**Done**: scaffolded `app/` (RN 0.87.1), installed all nine native dependencies, proved a green `assembleDebug` twice, fixed `sdk.dir` in `local.properties`, set `JAVA_HOME`/`ANDROID_HOME` at User scope.
**Remaining**: add the manifest permissions listed above, wire NetInfo, display live network type and carrier, and — on a physical device — confirm that `@notifee/react-native` and `@react-native-community/geolocation` actually run under the New Architecture.
**Exit**: one screen showing live connectivity; a runtime-confirmed list of every dependency that needed a workaround or replacement.
**RF**: RF-01 partial.

### Stage 2 — Native telemetry TurboModule (1.5 weeks)
Kotlin + Swift implementations, codegen spec, event emitters. Android exposes dBm and cell identity; iOS exposes network type and carrier.
**Exit**: a debug screen logging live RSSI and network-type transitions on a physical Android device.
**RF**: RF-01 complete.
> Highest-risk stage in the project and the one that gates RF-05. It runs early for that reason. Physical device required — emulators report synthetic cell data.

### Stage 3 — Measurement engine (1.5 weeks)
TCP probe scheduler, RTT/jitter/loss statistics, throughput test against the reference backend. All timing and statistics live in pure TypeScript with no React and no native imports.
**Exit**: unit tests on the statistics (jitter, loss, Mbps, percentiles) and a headless run producing a real measurement set.
**RF**: RF-02, RF-03.

### Stage 4 — Persistence and geolocation (1 week)
SQLite schema and indexed queries; location acquisition, permission handling and caching; measurement records written with timestamp and coordinates.
**Exit**: a session's measurements survive an app restart and are queryable by date and bounding box.
**RF**: RF-04.

### Stage 5 — Visualization (1.5 weeks)
Map with markers and the heat layer; time-series charts for latency and throughput; historical list.
**Exit**: a recorded screen showing a populated heatmap from a real walk.
**RF**: RF-05, RF-06.

### Stage 6 — Background, notifications, export (1 week)
Android WorkManager scheduling; degradation detection and local notification; CSV/JSON export via the share sheet.
**Exit**: measurements accumulating with the app backgrounded on a physical Android device.
**RF**: RF-07, RF-08.

### Stage 7 — Filters, polish, documentation (1 week)
History filters by network type, date range and area; UX pass; extended README covering architecture, decisions and limitations; demo video.
**Exit**: all deliverables present.
**RF**: RF-09.

### Reference backend (parallel, ~2 days)
Fastify service in a single container: `GET /download?bytes=N` serving a fixed buffer, `POST /upload` echoing byte counts. Dockerfile plus deployment instructions. Start it during Stage 3, when Stage 3 needs it.

---

## 5. Risk Register

| # | Risk | Status | Impact | Mitigation |
|---|---|---|---|---|
| R1 | JDK 25 unsupported by AGP/Gradle | **RESOLVED** — Gradle 9.4.1 runs on JBR 25 | — | None needed |
| R2 | Missing SDK platform / no `sdkmanager` | **RESOLVED** — AGP auto-downloaded build-tools, CMake and NDK | — | None needed |
| R3 | Native deps incompatible with RN 0.87 New Architecture | **PARTIALLY RESOLVED** — all nine compile; runtime unverified | Rework mid-project | Stage 1 installs everything up front; runtime check on a physical device is the remaining gate |
| R4 | `TelephonyManager` access needs permissions that vary by API level and OEM | RF-01 / RF-05 blocked | Handle `CellInfo` being empty or `SecurityException` per API level; document OEM variance |
| R5 | RF-07 impossible on iOS as literally specified | Scope claim | ADR-3 declares the split honestly |
| R6 | RSSI unavailable on iOS | Heatmap on iOS has no signal dimension | ADR-2; heatmap falls back to latency/throughput as the quality metric |
| R7 | Measuring at university Wi-Fi produces results that misrepresent mobile QoS | Weak demo | Demo data captured on 4G/5G, not campus Wi-Fi; document it |
| R8 | No physical Android device available | Stages 2 and 6 cannot be verified | Confirm device access before Stage 2 |
| R9 | Scope: 7 stages in ~8.5 weeks for one person | Incomplete delivery | Measurement engine and persistence are the demo's spine — protect those; heatmap polish is the cut candidate |

---

## 6. Repository Layout

```
TP5/
├── PLAN.md               # this document
├── README.md             # extended technical document (deliverable)
├── docs/
│   ├── architecture.md
│   └── limitations.md
├── app/                  # React Native CLI application
└── backend/              # Fastify reference server (deliverable)
```

---

## 7. iOS Feasibility (verified 2026-10-05)

**Q: can this be delivered for iPhone without owning a Mac?**

**Yes — a Mac is not required to build.** Xcode, CocoaPods and `xcodebuild` only exist on macOS, but they do not have to run on your own machine:

| Route | Cost | Notes |
|---|---|---|
| GitHub Actions `macos-*` runner | **Free for public repositories**, $0.062/min for private | A simulator build of RN 0.87.1 takes ~2m42s. Private repos bill 10x for macOS minutes against the 2,000 min/month allowance → ~200 effective minutes ≈ 15–20 builds |
| EAS Build Free tier | **15 iOS builds/month free**, then $2/build | Managed signing; a bare RN CLI project needs Expo config added |
| Rented cloud Mac | $20–100/month | Only worth it if you need the screen interactively |

**But a Mac is not the only requirement.** Three conditions stack, and only the first is solved by CI:

1. **A cloud Mac to compile** — solved free with a public GitHub repo.
2. **A physical iPhone.** The iOS Simulator reports `CTCarrier` as `nil` because it has no telephony stack. RF-01 cannot be observed there at all. There is no substitute for a real device.
3. **Code signing.** TestFlight — the deliverable explicitly says "TestFlight interno" — requires the Apple Developer Program at **$99/year**. A free Apple ID can sideload to a device you own, but installs expire every 7 days, which is fine for development and poor for a graded demo. There is no free TestFlight.

**Further platform limits apply regardless of build path** — see ADR-2: carrier is scrubbed since iOS 16.4, and signal strength is not obtainable on iOS at all.

### ADR-10 — Platform strategy: Android for the loop, iOS for the proof, both ship

**The brief mandates multiplatform (Android/iOS) and React Native is the mandated stack — so both platforms ship from one codebase.** What differs is not *whether* a platform gets built, but which platform is used for what during development.

Constraint that drives this ADR: the student owns **an iPhone and no Android device, and no Mac.**

| | Android | iOS |
|---|---|---|
| Compile loop | Local, 6.5 min cold | **Cloud Mac only** — no local `pod install` on Windows, so every iOS check is a push-and-wait cycle |
| Runtime device | Emulator only (`modem_simulator`, no `CellInfo`) | **Physical iPhone** |
| What it proves | Full feature set: RSSI, carrier, real LTE/NR `CellInfo` | Network type, GPS, background, and a real demo video |
| What it cannot prove | Real radio behaviour (no device) | RSSI and carrier (ADR-2) — platform limits, not implementation gaps |

**Roles:**

1. **Android is the development loop.** It compiles locally, iterates fast, and is where the native Kotlin module and the full RF set live. The emulator's radio simulation covers event-driven paths.
2. **iOS is the validation device.** It is the only real hardware available, so anything that must be proven on real silicon — geolocation, background execution, the recorded demo video — is proven on iPhone.
3. **Shared TypeScript is the bulk of the product.** The Measurement Engine (ADR-4, ADR-5), persistence schema, statistics, charts, filters and the Zustand store are platform-independent and unit-testable on Windows with Jest. They are built first, because they serve both platforms and they are the only layers that can be verified without any device or cloud build.

**Verification split, stated honestly:**

- Testable now, on Windows, no device: all measurement statistics, persistence queries, export formats, filtering logic.
- Testable locally, no device: Android compile, emulator UI and radio events.
- Testable only via cloud CI: iOS compile.
- Testable only on real hardware: RSSI (Android only), carrier (Android only), network type (iOS), background with the screen off, the demo video.

**What this means for the deliverable:** Android carries the complete RF set. iOS carries RF-02 through RF-09 and a deliberately reduced RF-01. That asymmetry is a platform fact, recorded in `docs/limitations.md` — not an unfinished feature.

**Cost:** zero if the repository is public (GitHub Actions macOS runners are free on public repos). `pod install` never runs locally, so there is no macOS dependency in the developer's own workflow.

## 8. Open Questions

~~1. Do you own an iPhone?~~ — **RESOLVED 2026-10-05: yes.** See ADR-10.
2. **Can the repository be public?** It makes the iOS build free on GitHub Actions. Closed repos bill macOS minutes at 10x.
3. Does the iPhone have an active cellular data plan (SIM or eSIM)? A QoS demo on WiFi only would not demonstrate the premise of the brief.
4. Apple Developer Program ($99/yr) for TestFlight, or free Apple ID sideloading with 7-day expiry?
5. Can the professor's course supply an Apple Developer account? Common for university iOS courses and removes the cost question entirely.
6. Is an Android device available from a relative or classmate, even for a short validation window? (R8)
7. Demo capture on real 4G/5G — depends on question 3. (R7)
