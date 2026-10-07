// RCTNetworkTelemetry.h
// Stage 2 native telemetry TurboModule, iOS adapter (ADR-1, ADR-2).
//
// The business logic lives in NetworkTelemetry.swift; this header declares
// the thin Objective-C++ adapter over the codegen-generated spec base,
// which provides the `emitOnSignalStrengthChanged` /
// `emitOnNetworkStateChanged` emitters and the JSI binding.
//
// NOTE (Windows author): `NetworkTelemetrySpec.h` is emitted by codegen
// during `pod install`. If the import below does not resolve in the cloud
// build, point it at the generated header location and keep the base class.

#import <React/RCTEventEmitter.h>

#if __has_include(<ReactCodegen/NetworkTelemetrySpec.h>)
#import <ReactCodegen/NetworkTelemetrySpec.h>
#else
#import "NetworkTelemetrySpec.h"
#endif

@interface RCTNetworkTelemetry : NativeNetworkTelemetrySpecBase <NativeNetworkTelemetrySpec>

@end
