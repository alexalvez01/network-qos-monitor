/**
 * Runtime permission flow for Stage 1.
 *
 * Android only. Uses the React Native core PermissionsAndroid API — no extra
 * dependency. iOS permissions are declared in Info.plist and requested by the
 * Geolocation API when first used, so every status here is `unavailable` off
 * Android.
 *
 * Ordering rules (all enforced and unit tested):
 * - Foreground location (FINE + COARSE) is requested first.
 * - ACCESS_BACKGROUND_LOCATION is requested on its own, and only after the
 *   foreground grant succeeds. Android 11+ rejects a bundled request.
 * - POST_NOTIFICATIONS is requested separately on Android 13+ (API 33).
 * - READ_PHONE_STATE is requested on its own step (RF-01/RF-05 telemetry).
 *
 * The flow takes its platform/request primitives as injectable `PermissionDeps`
 * so it can be unit tested without touching native code.
 */

import { PermissionsAndroid, Permission, Platform } from 'react-native';

export type PermissionStatus =
  | 'granted'
  | 'denied'
  | 'never_ask_again'
  | 'unavailable'
  | 'unknown';

export interface AppPermissionStatuses {
  foregroundLocation: PermissionStatus;
  backgroundLocation: PermissionStatus;
  phoneState: PermissionStatus;
  notifications: PermissionStatus;
}

export interface PermissionDeps {
  platformOS: string;
  /** Android API level, e.g. 34. Ignored off Android. */
  apiLevel: number;
  check: (permission: Permission) => Promise<boolean>;
  request: (permission: Permission) => Promise<string>;
}

const ANDROID_PERMISSIONS = {
  fineLocation: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  coarseLocation: PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  backgroundLocation:
    PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
  phoneState: PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
  notifications: PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
};

const GRANTED = 'granted';

function toStatus(result: string): PermissionStatus {
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'granted';
  }
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    return 'never_ask_again';
  }
  if (result === PermissionsAndroid.RESULTS.DENIED) {
    return 'denied';
  }
  return 'unknown';
}

export function defaultDeps(): PermissionDeps {
  const apiLevel =
    Platform.OS === 'android' ? Number(Platform.Version) || 0 : 0;
  return {
    platformOS: Platform.OS,
    apiLevel,
    check: (permission: Permission) => PermissionsAndroid.check(permission),
    request: (permission: Permission) =>
      PermissionsAndroid.request(permission),
  };
}

const UNAVAILABLE_ALL: AppPermissionStatuses = {
  foregroundLocation: 'unavailable',
  backgroundLocation: 'unavailable',
  phoneState: 'unavailable',
  notifications: 'unavailable',
};

async function safeCheck(
  deps: PermissionDeps,
  permission: Permission,
): Promise<PermissionStatus> {
  try {
    const granted = await deps.check(permission);
    return granted ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

async function safeRequest(
  deps: PermissionDeps,
  permission: Permission,
): Promise<PermissionStatus> {
  try {
    const result = await deps.request(permission);
    return toStatus(result);
  } catch {
    return 'unknown';
  }
}

/**
 * Read the current status of every Stage 1 permission without prompting.
 * Below API 29 there is no background-location permission (the foreground
 * grant covers it); below API 33 there is no notification runtime permission.
 * Both report `granted` there because nothing blocks the feature.
 */
export async function checkAppPermissions(
  deps: PermissionDeps = defaultDeps(),
): Promise<AppPermissionStatuses> {
  if (deps.platformOS !== 'android') {
    return { ...UNAVAILABLE_ALL };
  }
  const [fine, coarse] = await Promise.all([
    safeCheck(deps, ANDROID_PERMISSIONS.fineLocation),
    safeCheck(deps, ANDROID_PERMISSIONS.coarseLocation),
  ]);
  const foregroundLocation: PermissionStatus =
    fine === 'granted' || coarse === 'granted' ? 'granted' : fine;
  const backgroundLocation =
    deps.apiLevel < 29
      ? foregroundLocation
      : await safeCheck(deps, ANDROID_PERMISSIONS.backgroundLocation);
  const phoneState = await safeCheck(deps, ANDROID_PERMISSIONS.phoneState);
  const notifications =
    deps.apiLevel < 33
      ? GRANTED
      : await safeCheck(deps, ANDROID_PERMISSIONS.notifications);
  return { foregroundLocation, backgroundLocation, phoneState, notifications };
}

/**
 * Run the full request flow in the mandated order. Background location is
 * requested only when the foreground grant succeeded; notifications are a
 * separate step on API 33+.
 */
export async function requestAppPermissions(
  deps: PermissionDeps = defaultDeps(),
): Promise<AppPermissionStatuses> {
  if (deps.platformOS !== 'android') {
    return { ...UNAVAILABLE_ALL };
  }
  const fine = await safeRequest(deps, ANDROID_PERMISSIONS.fineLocation);
  const coarse = await safeRequest(deps, ANDROID_PERMISSIONS.coarseLocation);
  const foregroundLocation: PermissionStatus =
    fine === 'granted' || coarse === 'granted' ? 'granted' : fine;

  let backgroundLocation: PermissionStatus = 'denied';
  if (foregroundLocation === 'granted') {
    backgroundLocation =
      deps.apiLevel < 29
        ? 'granted'
        : await safeRequest(deps, ANDROID_PERMISSIONS.backgroundLocation);
  }

  const phoneState = await safeRequest(deps, ANDROID_PERMISSIONS.phoneState);
  const notifications =
    deps.apiLevel < 33
      ? GRANTED
      : await safeRequest(deps, ANDROID_PERMISSIONS.notifications);

  return { foregroundLocation, backgroundLocation, phoneState, notifications };
}
