// RCTNetworkTelemetry.mm
// Stage 2 native telemetry TurboModule, iOS adapter (ADR-1, ADR-2).
//
// Contract mirrored from the Android implementation:
// - `getCurrentNetworkInfo` resolves the network type and honestly reports
//   carrier/RSSI as unavailable (null), per ADR-2.
// - `onNetworkStateChanged` fires from CoreTelephony's own radio-technology
//   notification — never polled from JS.
// - `onSignalStrengthChanged` is declared by the shared spec but never
//   emitted on iOS: dBm was never a public API. The JS bridge treats the
//   absence of events as "unavailable", which is the honest state.
//
// NOTE (Windows author): cannot be compiled without Xcode. Keep changes to
// this file conservative and re-verify on a cloud-Mac build.

#import "RCTNetworkTelemetry.h"
#import "NetworkQoSMonitor-Swift.h"

#import <CoreTelephony/CTTelephonyNetworkInfo.h>

@implementation RCTNetworkTelemetry {
  NetworkTelemetry *_telemetry;
  NSString *_lastNetworkType;
  id _radioObserver;
}

- (instancetype)init
{
  if (self = [super init]) {
    _telemetry = [NetworkTelemetry new];
    _lastNetworkType = [_telemetry currentNetworkType];
  }
  return self;
}

+ (NSString *)moduleName
{
  return @"NativeNetworkTelemetry";
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeNetworkTelemetrySpecJSI>(params);
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[@"onSignalStrengthChanged", @"onNetworkStateChanged"];
}

- (void)startObserving
{
  if (_radioObserver != nil) {
    return;
  }
  __weak __typeof(self) weakSelf = self;
  _radioObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:CTServiceRadioAccessTechnologyDidChangeNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification *_Nonnull note) {
                [weakSelf handleRadioChange:note];
              }];
}

- (void)stopObserving
{
  if (_radioObserver != nil) {
    [[NSNotificationCenter defaultCenter] removeObserver:_radioObserver];
    _radioObserver = nil;
  }
}

- (void)handleRadioChange:(NSNotification *)note
{
  NSString *next = [_telemetry currentNetworkType];
  NSString *previous = _lastNetworkType;
  _lastNetworkType = next;
  if (previous != nil && ![previous isEqualToString:next]) {
    [self emitOnNetworkStateChanged:@{
      @"networkType" : next,
      @"previousNetworkType" : previous,
    }];
  }
}

- (void)getCurrentNetworkInfo:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject
{
  @try {
    NSString *networkType = [_telemetry currentNetworkType];
    _lastNetworkType = networkType;
    // Carrier and RSSI are unavailable by platform policy (ADR-2):
    // CTCarrier returns scrubbed placeholders since iOS 16.4 and dBm was
    // never public. Nulls here are honesty, not missing code.
    resolve(@{
      @"networkType" : networkType,
      @"signalDbm" : [NSNull null],
      @"cellIdentity" : [NSNull null],
      @"carrierName" : [NSNull null],
      @"available" : @YES,
    });
  } @catch (NSException *exception) {
    reject(@"E_TELEMETRY_READ", @"Unable to read network info", nil);
  }
}

@end
