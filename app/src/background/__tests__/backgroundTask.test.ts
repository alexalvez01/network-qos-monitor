import { asBackgroundFetchLike } from '../backgroundTask';

// Mirrors react-native-background-fetch 4.x: the default export is a class
// whose constants are static getters and whose API is static methods.
class ClassShapedPlugin {
  static get STATUS_AVAILABLE() {
    return 2;
  }
  static get STATUS_DENIED() {
    return 1;
  }
  static get NETWORK_TYPE_ANY() {
    return 1;
  }
  static configure() {
    return Promise.resolve(2);
  }
  static finish() {}
  static registerHeadlessTask() {}
}

test('accepts the class-shaped default export of the plugin', () => {
  expect(asBackgroundFetchLike(ClassShapedPlugin)).toBe(ClassShapedPlugin);
});

test('accepts an object with the same members', () => {
  const plugin = {
    STATUS_AVAILABLE: 2,
    STATUS_DENIED: 1,
    NETWORK_TYPE_ANY: 1,
    configure: async () => 2,
    finish: () => undefined,
    registerHeadlessTask: () => undefined,
  };
  expect(asBackgroundFetchLike(plugin)).toBe(plugin);
});

test('rejects missing or incomplete modules', () => {
  expect(asBackgroundFetchLike(undefined)).toBeNull();
  expect(asBackgroundFetchLike(null)).toBeNull();
  expect(asBackgroundFetchLike(() => undefined)).toBeNull();
  expect(asBackgroundFetchLike({ configure: () => undefined })).toBeNull();
});
