# Limitations

Honest constraints on what this app can and cannot do. Each entry names the
cause, the concrete impact on the deliverable, and what (if anything)
mitigates it. Written for the defense: documenting a platform fact is worth
more than faking the capability.

## 1. iOS background sampling is opportunistic, not guaranteed

- **Cause.** iOS offers `BGAppRefreshTask`, scheduled by the OS on its own
  energy budget. No API guarantees periodicity for a terminated app (ADR-3,
  PLAN risk R5).
- **Impact.** RF-07 as literally specified ("periodic sampling with the app
  closed") is deliverable on Android via WorkManager and best-effort only on
  iOS.
- **Mitigation.** Scope is declared, not hidden: Android carries RF-07 as
  written; the README and this file state the iOS behavior. The background
  store surfaces `scheduled` vs `error` so a silent stall reads as state,
  never as data.

## 2. iOS exposes network type only — no carrier, no RSSI

- **Cause.** Apple deprecated `CTCarrier` in iOS 16.4 (returns `--` /
  `65535` on real devices, `nil` on the Simulator which has no telephony
  stack); signal strength requires a private API plus a carrier entitlement
  third-party apps are not granted (ADR-2, PLAN risk R6).
- **Impact.** RF-01 on iOS delivers connection class (NetInfo) + radio access
  technology (CoreTelephony) and nothing else. The heatmap's `dbm` metric has
  no iOS dimension; iOS quality keys on latency/throughput instead.
- **Mitigation.** Missing fields stay `null` from the store to the screen and
  render as "Not available" — never blank, never fabricated. The map shows an
  explicit notice when the `dbm` metric has no samples. Per ADR-10 this
  asymmetry is a platform fact, not an unfinished feature.

## 3. `@notifee/react-native` runtime is unverified on RN 0.87

- **Cause.** Last publish 2024-12 (~22 months ago); it compiles and autolinks
  under the New Architecture but no release covers RN 0.87 (PLAN §2, risk R3).
- **Impact.** Degradation detection (`background/degradation.ts`) is tested;
  the actual notification display is not confirmed on a device.
- **Mitigation.** Stated here instead of assumed. The notification call sits
  behind the injected `notify` seam, so a replacement (or a Notifee upgrade)
  touches one adapter, not the pass orchestration. Confirm on a physical
  device before the defense.

## 4. OSM tiles cannot carry an identifying User-Agent

- **Cause.** `react-native-maps` 1.29.11 `UrlTile` exposes no header option,
  so tile requests go out without the identifying `User-Agent` the OSM tile
  usage policy asks for. No API key exists (ADR-7 ruled out provider tokens).
- **Impact.** A compliance caveat on the map layer: heavy or abusive tile use
  could draw attention under the policy.
- **Mitigation (partial).** Zoom is capped at 18 (street-level tiles add
  nothing to a coverage heatmap), there is exactly one raster layer, no
  prefetching, and volume is bounded by real usage. This reduces load but
  does not remove the caveat — hence this entry.

## 5. Demo on real 4G/5G, not campus Wi-Fi

- **Cause.** University Wi-Fi numbers say nothing about mobile radio quality;
  a QoS demo captured on Wi-Fi misrepresents the premise of the brief
  (PLAN risk R7).
- **Impact.** Any demo data or video captured on Wi-Fi weakens the defense.
- **Mitigation.** The demo video (still pending — recorded by the owner on a
  real Android device) must be a cellular walk. The seed demo walk exists so
  emulator screenshots never pretend to be measurements: synthetic data is
  always labeled "demo".

## 6. Background passes are probes-only (no throughput)

- **Cause.** A headless WorkManager window is short and battery-attributed to
  the app; a full multi-megabyte download every ~15 minutes does not fit that
  budget.
- **Impact.** Background history covers latency/loss/jitter only; throughput
  series come from foreground passes.
- **Mitigation.** Declared in the pass contract
  (`throughput: null` in `runBackgroundMeasurementPass`) and in the README.
  Foreground and background rows share one schema, so charts simply show gaps
  in throughput overnight — labeled "No data", never zero.

## 7. Open questions carried from PLAN.md §8

Still unresolved at Stage 7 exit; each affects validation, not code:

- Can the repository be **public**? It makes the iOS cloud build free
  (GitHub Actions macOS runners); private repos bill macOS minutes at 10x.
- Does the iPhone have an **active cellular data plan**? A Wi-Fi-only device
  cannot demonstrate the brief (see §5).
- **Apple Developer Program ($99/yr)** for TestFlight vs free-ID sideloading
  (7-day expiry)? Or a course-supplied account?
- Is an **Android device** available from a relative or classmate for a short
  validation window (PLAN risk R8)? Without one, RSSI, carrier and
  background-with-screen-off stay emulator-untested.
