import CoreTelephony
import Foundation

/**
 * Stage 2 iOS telemetry (ADR-1, ADR-2).
 *
 * Platform facts, not gaps: `serviceCurrentRadioAccessTechnology` still
 * reports the radio access technology, but carrier fields have returned
 * scrubbed placeholders since iOS 16.4 and signal strength in dBm was never
 * a public API. This class therefore exposes the network type and reports
 * carrier/RSSI as unavailable — never fabricated, never blank.
 *
 * NOTE (Windows author): this file cannot be compiled on the development
 * machine (no Xcode). It mirrors the codegen spec exactly and stays within
 * long-stable CoreTelephony API. Verify with a cloud-Mac build before
 * relying on it.
 */
@objcMembers public class NetworkTelemetry: NSObject {
  private let telephonyInfo = CTTelephonyNetworkInfo()

  /// Exact radio string such as LTE, NR, WCDMA, GSM, or UNKNOWN.
  public func currentNetworkType() -> String {
    guard let technologies = telephonyInfo.serviceCurrentRadioAccessTechnology,
          let radio = technologies.values.first,
          !radio.isEmpty else {
      return "UNKNOWN"
    }
    return NetworkTelemetry.mapRadioAccessTechnology(radio)
  }

  /// Maps CoreTelephony radio constants to the shared spec vocabulary.
  public static func mapRadioAccessTechnology(_ radio: String) -> String {
    switch radio {
    case CTRadioAccessTechnologyLTE:
      return "LTE"
    case CTRadioAccessTechnologyNR, CTRadioAccessTechnologyNRNSA:
      return "NR"
    case CTRadioAccessTechnologyHSDPA, CTRadioAccessTechnologyHSUPA,
         CTRadioAccessTechnologyWCDMA:
      return "WCDMA"
    case CTRadioAccessTechnologyEdge:
      return "GSM"
    case CTRadioAccessTechnologyCDMA1x, CTRadioAccessTechnologyCDMAEVDORev0,
         CTRadioAccessTechnologyCDMAEVDORevA, CTRadioAccessTechnologyCDMAEVDORevB,
         CTRadioAccessTechnologyeHRPD:
      return "CDMA"
    default:
      return "UNKNOWN"
    }
  }
}
