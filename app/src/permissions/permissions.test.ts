import {
  checkAppPermissions,
  PermissionDeps,
  requestAppPermissions,
} from './permissions';
import { PermissionsAndroid, Permission } from 'react-native';

const GRANTED = 'granted';
const DENIED = 'denied';
const NEVER_ASK_AGAIN = 'never_ask_again';

function makeDeps(requestOrder: string[], grants: Record<string, string>): PermissionDeps {
  return {
    platformOS: 'android',
    apiLevel: 34,
    check: async () => false,
    request: async (permission: Permission) => {
      requestOrder.push(permission);
      return grants[permission] ?? DENIED;
    },
  };
}

const FINE = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
const COARSE = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
const BACKGROUND =
  PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION;
const PHONE = PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE;
const NOTIFS = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;

test('requests background only after a foreground grant', async () => {
  const order: string[] = [];
  const deps = makeDeps(order, {
    [FINE]: GRANTED,
    [COARSE]: DENIED,
    [BACKGROUND]: GRANTED,
    [PHONE]: GRANTED,
    [NOTIFS]: GRANTED,
  });
  const result = await requestAppPermissions(deps);
  expect(result.foregroundLocation).toBe('granted');
  expect(result.backgroundLocation).toBe('granted');
  expect(order.indexOf(BACKGROUND)).toBeGreaterThan(order.indexOf(FINE));
  expect(order.indexOf(BACKGROUND)).toBeGreaterThan(order.indexOf(COARSE));
});

test('skips background when foreground is denied', async () => {
  const order: string[] = [];
  const deps = makeDeps(order, { [FINE]: DENIED, [COARSE]: DENIED });
  const result = await requestAppPermissions(deps);
  expect(result.foregroundLocation).toBe('denied');
  expect(result.backgroundLocation).toBe('denied');
  expect(order).not.toContain(BACKGROUND);
});

test('notifications are a separate step after location', async () => {
  const order: string[] = [];
  const deps = makeDeps(order, {
    [FINE]: GRANTED,
    [COARSE]: GRANTED,
    [BACKGROUND]: GRANTED,
    [PHONE]: GRANTED,
    [NOTIFS]: NEVER_ASK_AGAIN,
  });
  const result = await requestAppPermissions(deps);
  expect(result.notifications).toBe('never_ask_again');
  expect(order.indexOf(NOTIFS)).toBeGreaterThan(order.indexOf(BACKGROUND));
});

test('api below 33 reports notifications granted without prompting', async () => {
  const order: string[] = [];
  const deps: PermissionDeps = {
    ...makeDeps(order, {}),
    apiLevel: 31,
  };
  const result = await requestAppPermissions(deps);
  expect(result.notifications).toBe('granted');
  expect(order).not.toContain(NOTIFS);
});

test('off android everything is unavailable', async () => {
  const deps: PermissionDeps = {
    platformOS: 'ios',
    apiLevel: 0,
    check: async () => {
      throw new Error('must not be called');
    },
    request: async () => {
      throw new Error('must not be called');
    },
  };
  expect(await requestAppPermissions(deps)).toEqual({
    foregroundLocation: 'unavailable',
    backgroundLocation: 'unavailable',
    phoneState: 'unavailable',
    notifications: 'unavailable',
  });
  expect(await checkAppPermissions(deps)).toEqual({
    foregroundLocation: 'unavailable',
    backgroundLocation: 'unavailable',
    phoneState: 'unavailable',
    notifications: 'unavailable',
  });
});
