/**
 * Notifee containment wrapper for Stage 6 (RF-07).
 *
 * PLAN dependency-health caveat: @notifee/react-native has no release since
 * 2024-12 and its runtime against RN 0.87 is unverified. ALL notifee access
 * lives in this file behind two guarantees:
 *
 * 1. The package is loaded lazily with a dynamic import — a missing or
 *    broken native side resolves to null here instead of crashing JS.
 * 2. Every exported function catches everything and reports success as a
 *    boolean. Callers (the background task) never see a throw.
 *
 * Nothing else in the app imports '@notifee/react-native', not even as a
 * type — the structural interfaces below are declared locally so this file
 * is the only module that can pull the dependency in.
 */

const DEGRADATION_CHANNEL_ID = 'qos-degradation';
const DEGRADATION_CHANNEL_NAME = 'Network degradation alerts';
// Mirrors notifee's AndroidImportance.HIGH (verified against the installed
// 9.1.8 dist: NONE 0, MIN 1, LOW 2, DEFAULT 3, HIGH 4). Kept as a literal
// so no notifee value is read at module scope.
const ANDROID_IMPORTANCE_HIGH = 4;

interface NotifeeChannelSpec {
  id: string;
  name: string;
  importance: number;
}

interface NotifeeLike {
  requestPermission?: () => Promise<unknown>;
  createChannel?: (channel: NotifeeChannelSpec) => Promise<string>;
  displayNotification?: (notification: {
    title: string;
    body: string;
    android?: {
      channelId: string;
      smallIcon?: string;
      pressAction?: { id: string };
    };
  }) => Promise<string>;
}

function asNotifeeLike(value: unknown): NotifeeLike | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<NotifeeLike>;
  if (
    typeof candidate.createChannel !== 'function' ||
    typeof candidate.displayNotification !== 'function'
  ) {
    return null;
  }
  return candidate as NotifeeLike;
}

async function loadNotifee(): Promise<NotifeeLike | null> {
  try {
    const module = (await import('@notifee/react-native')) as {
      default?: unknown;
    } & Record<string, unknown>;
    return asNotifeeLike(module.default ?? module);
  } catch {
    return null;
  }
}

let channelReady = false;

/**
 * Best-effort channel setup: request permission (Android 13+ needs the
 * runtime POST_NOTIFICATIONS grant from the Stage 1 flow; without it the
 * notification silently never appears, so ask again here harmlessly), then
 * create the degradation channel. True when displayNotification has a
 * channel to target; false keeps the caller from attempting the post.
 */
export async function ensureDegradationChannel(): Promise<boolean> {
  try {
    const notifee = await loadNotifee();
    if (!notifee?.createChannel) {
      return false;
    }
    if (typeof notifee.requestPermission === 'function') {
      try {
        await notifee.requestPermission();
      } catch {
        // Permission denial is not fatal: the channel still gets created
        // and the OS drops the post. Never let this throw.
      }
    }
    await notifee.createChannel({
      id: DEGRADATION_CHANNEL_ID,
      name: DEGRADATION_CHANNEL_NAME,
      importance: ANDROID_IMPORTANCE_HIGH,
    });
    channelReady = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Post a degradation alert. Resolves true when the notification was handed
 * to the OS, false when notifee is unavailable or the post failed — never
 * rejects, so the headless task can await it unconditionally.
 */
export async function notifyDegradation(reason: string): Promise<boolean> {
  try {
    const notifee = await loadNotifee();
    if (!notifee?.displayNotification) {
      return false;
    }
    if (!channelReady) {
      await ensureDegradationChannel();
    }
    await notifee.displayNotification({
      title: 'Network quality degraded',
      body: reason,
      android: {
        channelId: DEGRADATION_CHANNEL_ID,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'default' },
      },
    });
    return true;
  } catch {
    return false;
  }
}
