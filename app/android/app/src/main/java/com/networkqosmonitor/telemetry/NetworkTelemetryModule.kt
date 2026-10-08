package com.networkqosmonitor.telemetry

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.CellIdentityNr
import android.telephony.CellInfo
import android.telephony.CellInfoCdma
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.PhoneStateListener
import android.telephony.SignalStrength
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * Stage 2 native telemetry TurboModule (ADR-1, risk R4).
 *
 * One-shot reads via `getCurrentNetworkInfo()`; live updates via the
 * codegen `onSignalStrengthChanged` / `onNetworkStateChanged` emitters,
 * driven by the platform's own telephony listeners — never polled from JS.
 *
 * Graceful degradation is the whole point of this file:
 * - `READ_PHONE_STATE` is checked before every telephony touch. Without the
 *   grant the module resolves a typed unavailable result instead of throwing.
 * - `allCellInfo` is frequently null or empty (emulators, aeroplane mode,
 *   some OEMs). That yields null dBm/identity, not a crash.
 * - `SecurityException` / `UnsupportedOperationException` are caught per
 *   call site, per API level, because OEM behavior varies.
 */
class NetworkTelemetryModule(reactContext: ReactApplicationContext) :
  NativeNetworkTelemetrySpec(reactContext) {

  companion object {
    const val NAME = "NativeNetworkTelemetry"
  }

  private val appContext: Context = reactContext.applicationContext
  private val telephonyManager: TelephonyManager? =
    reactContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager

  private val mainHandler = Handler(Looper.getMainLooper())
  private var listenerCount = 0
  private var lastNetworkType: String? = null
  private var telephonyCallback: TelephonyCallback? = null
  private var phoneStateListener: PhoneStateListener? = null

  override fun getName(): String = NAME

  // ---------------------------------------------------------------- one-shot

  override fun getCurrentNetworkInfo(promise: Promise) {
    try {
      promise.resolve(buildNetworkInfo())
    } catch (error: Exception) {
      promise.reject("E_TELEMETRY_READ", "Unable to read network info", error)
    }
  }

  private fun hasPhoneStatePermission(): Boolean =
    ContextCompat.checkSelfPermission(
      appContext,
      Manifest.permission.READ_PHONE_STATE,
    ) == PackageManager.PERMISSION_GRANTED

  private fun buildNetworkInfo(): WritableMap {
    val map = Arguments.createMap()
    if (telephonyManager == null || !hasPhoneStatePermission()) {
      map.putString("networkType", "UNKNOWN")
      map.putNull("signalDbm")
      map.putNull("cellIdentity")
      map.putNull("carrierName")
      map.putBoolean("available", false)
      return map
    }
    val networkType = readNetworkType()
    val (dbm, identity) = readServingCell()
    val carrier = readCarrierName()
    map.putString("networkType", networkType)
    if (dbm != null) map.putDouble("signalDbm", dbm) else map.putNull("signalDbm")
    if (identity != null) {
      map.putString("cellIdentity", identity)
    } else {
      map.putNull("cellIdentity")
    }
    if (carrier != null) {
      map.putString("carrierName", carrier)
    } else {
      map.putNull("carrierName")
    }
    map.putBoolean("available", true)
    return map
  }

  private fun readNetworkType(): String {
    val manager = telephonyManager ?: return "UNKNOWN"
    return try {
      // Requires READ_PHONE_STATE; guarded by the caller, caught regardless.
      networkTypeName(manager.dataNetworkType)
    } catch (security: SecurityException) {
      "UNKNOWN"
    } catch (unsupported: UnsupportedOperationException) {
      "UNKNOWN"
    }
  }

  private fun readCarrierName(): String? {
    val manager = telephonyManager ?: return null
    return try {
      manager.networkOperatorName?.takeIf { it.isNotBlank() }
    } catch (security: SecurityException) {
      null
    } catch (unsupported: UnsupportedOperationException) {
      null
    }
  }

  /**
   * Returns serving-cell dBm plus a stable identity string, or nulls when
   * the platform withholds cell data. Prefers the registered cell and falls
   * back to the first entry — never assumes a non-empty list.
   */
  private fun readServingCell(): Pair<Double?, String?> {
    val manager = telephonyManager ?: return Pair(null, null)
    val cells: List<CellInfo> =
      try {
        // Needs READ_PHONE_STATE and, since API 29, fine location for full
        // data. Emulators and aeroplane mode return null or an empty list.
        manager.allCellInfo ?: return Pair(null, null)
      } catch (security: SecurityException) {
        return Pair(null, null)
      } catch (unsupported: UnsupportedOperationException) {
        return Pair(null, null)
      }
    if (cells.isEmpty()) return Pair(null, null)
    val serving = cells.firstOrNull { it.isRegistered } ?: cells.first()
    return Pair(readDbm(serving), readCellIdentity(serving))
  }

  private fun readDbm(info: CellInfo): Double? {
    return try {
      val dbm = info.cellSignalStrength.dbm
      if (dbm == CellInfo.UNAVAILABLE) null else dbm.toDouble()
    } catch (error: Exception) {
      null
    }
  }

  private fun readCellIdentity(info: CellInfo): String? {
    return try {
      when (info) {
        is CellInfoLte -> {
          val id = info.cellIdentity
          identityLabel("LTE", "ci" to id.ci.toLong(), "pci" to id.pci.toLong(), "tac" to id.tac.toLong())
        }
        is CellInfoNr -> {
          // CellInfoNr.getCellIdentity() is declared to return the base
          // CellIdentity (verified against android-37.0), so Kotlin cannot
          // smart-cast it. The explicit cast is safe: the branch already
          // proved the concrete type, and this runs inside the try/catch.
          val id = info.cellIdentity as CellIdentityNr
          identityLabel("NR", "nci" to id.nci, "pci" to id.pci.toLong(), "tac" to id.tac.toLong())
        }
        is CellInfoGsm -> {
          val id = info.cellIdentity
          identityLabel("GSM", "cid" to id.cid.toLong(), "lac" to id.lac.toLong())
        }
        is CellInfoWcdma -> {
          val id = info.cellIdentity
          identityLabel("WCDMA", "cid" to id.cid.toLong(), "lac" to id.lac.toLong())
        }
        is CellInfoCdma -> {
          val id = info.cellIdentity
          identityLabel(
            "CDMA",
            "base" to id.basestationId.toLong(),
            "net" to id.networkId.toLong(),
            "sys" to id.systemId.toLong(),
          )
        }
        else -> null
      }
    } catch (error: Exception) {
      null
    }
  }

  /**
   * Compact identity such as "LTE ci=12345 pci=12 tac=34". Sentinel values
   * (`CellInfo.UNAVAILABLE`) are dropped; when nothing usable remains the
   * identity is null rather than a string of placeholders.
   */
  private fun identityLabel(kind: String, vararg fields: Pair<String, Long>): String? {
    val kept =
      fields.filter {
        it.second != CellInfo.UNAVAILABLE.toLong() &&
          it.second != Long.MAX_VALUE &&
          it.second >= 0
      }
    if (kept.isEmpty()) return null
    return (listOf(kind) + kept.map { "${it.first}=${it.second}" }).joinToString(" ")
  }

  private fun networkTypeName(type: Int): String =
    when (type) {
      // LTE-Advanced reports plain NETWORK_TYPE_LTE; there is no
      // NETWORK_TYPE_LTE_CA constant (only a bitmask that is not a type).
      TelephonyManager.NETWORK_TYPE_LTE -> "LTE"
      TelephonyManager.NETWORK_TYPE_NR -> "NR"
      TelephonyManager.NETWORK_TYPE_HSPAP,
      TelephonyManager.NETWORK_TYPE_HSPA,
      TelephonyManager.NETWORK_TYPE_HSDPA,
      TelephonyManager.NETWORK_TYPE_HSUPA,
      -> "HSPA"
      TelephonyManager.NETWORK_TYPE_UMTS -> "WCDMA"
      TelephonyManager.NETWORK_TYPE_EDGE,
      TelephonyManager.NETWORK_TYPE_GPRS,
      TelephonyManager.NETWORK_TYPE_GSM,
      -> "GSM"
      TelephonyManager.NETWORK_TYPE_CDMA,
      TelephonyManager.NETWORK_TYPE_1xRTT,
      TelephonyManager.NETWORK_TYPE_EHRPD,
      TelephonyManager.NETWORK_TYPE_EVDO_0,
      TelephonyManager.NETWORK_TYPE_EVDO_A,
      TelephonyManager.NETWORK_TYPE_EVDO_B,
      -> "CDMA"
      TelephonyManager.NETWORK_TYPE_IDEN -> "IDEN"
      TelephonyManager.NETWORK_TYPE_IWLAN -> "WIFI"
      TelephonyManager.NETWORK_TYPE_TD_SCDMA -> "TD-SCDMA"
      else -> "UNKNOWN"
    }

  // ------------------------------------------------------------- event plane

  /**
   * Lifecycle hooks for `NativeEventEmitter`: platform listeners start on
   * the first JS subscriber and stop when the last one leaves, so the radio
   * is never observed while nobody listens.
   */
  override fun addListener(eventType: String) {
    mainHandler.post {
      if (listenerCount == 0) startPlatformListeners()
      listenerCount += 1
    }
  }

  override fun removeListeners(count: Double) {
    mainHandler.post {
      listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
      if (listenerCount == 0) stopPlatformListeners()
    }
  }

  private fun startPlatformListeners() {
    val manager = telephonyManager ?: return
    if (!hasPhoneStatePermission()) return
    lastNetworkType = readNetworkType()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val callback =
          object : TelephonyCallback(), TelephonyCallback.SignalStrengthsListener {
            override fun onSignalStrengthsChanged(signalStrength: SignalStrength) {
              handleRadioUpdate()
            }
          }
        telephonyCallback = callback
        manager.registerTelephonyCallback(
          ContextCompat.getMainExecutor(appContext),
          callback,
        )
      } else {
        @Suppress("DEPRECATION")
        val listener =
          object : PhoneStateListener() {
            @Deprecated("Use TelephonyCallback on API 31+")
            @Suppress("DEPRECATION")
            override fun onSignalStrengthsChanged(signalStrength: SignalStrength?) {
              handleRadioUpdate()
            }
          }
        phoneStateListener = listener
        @Suppress("DEPRECATION")
        manager.listen(listener, PhoneStateListener.LISTEN_SIGNAL_STRENGTHS)
      }
    } catch (security: SecurityException) {
      stopPlatformListeners()
    } catch (unsupported: UnsupportedOperationException) {
      stopPlatformListeners()
    }
  }

  /**
   * Every platform signal callback re-reads the snapshot, always emits the
   * signal event, and emits a network-state event only on an actual radio
   * transition — network-type changes are detected, never polled.
   */
  private fun handleRadioUpdate() {
    if (!hasPhoneStatePermission()) return
    val networkType = readNetworkType()
    val (dbm, _) = readServingCell()
    val signalMap = Arguments.createMap()
    signalMap.putString("networkType", networkType)
    if (dbm != null) {
      signalMap.putDouble("signalDbm", dbm)
    } else {
      signalMap.putNull("signalDbm")
    }
    emitOnSignalStrengthChanged(signalMap)
    val previous = lastNetworkType
    if (previous != null && previous != networkType) {
      val stateMap = Arguments.createMap()
      stateMap.putString("networkType", networkType)
      stateMap.putString("previousNetworkType", previous)
      emitOnNetworkStateChanged(stateMap)
    }
    lastNetworkType = networkType
  }

  private fun stopPlatformListeners() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        telephonyCallback?.let { telephonyManager?.unregisterTelephonyCallback(it) }
      } else {
        @Suppress("DEPRECATION")
        phoneStateListener?.let {
          telephonyManager?.listen(it, PhoneStateListener.LISTEN_NONE)
        }
      }
    } catch (error: Exception) {
      // Teardown must never crash the host.
    }
    telephonyCallback = null
    phoneStateListener = null
  }

  override fun onCatalystInstanceDestroy() {
    mainHandler.post { stopPlatformListeners() }
    super.onCatalystInstanceDestroy()
  }
}
