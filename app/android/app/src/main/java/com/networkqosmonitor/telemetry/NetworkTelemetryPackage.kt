package com.networkqosmonitor.telemetry

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers the Stage 2 telemetry TurboModule (ADR-1). */
class NetworkTelemetryPackage : BaseReactPackage() {

  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? =
    if (name == NetworkTelemetryModule.NAME) {
      NetworkTelemetryModule(reactContext)
    } else {
      null
    }

  override fun getReactModuleInfoProvider() =
    ReactModuleInfoProvider {
      mapOf(
        NetworkTelemetryModule.NAME to
          ReactModuleInfo(
            name = NetworkTelemetryModule.NAME,
            className = NetworkTelemetryModule.NAME,
            canOverrideExistingModule = false,
            needsEagerInit = false,
            isCxxModule = false,
            isTurboModule = true,
          ),
      )
    }
}
