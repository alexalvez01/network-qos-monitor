import {
  __resetSettingsStoreForTests,
  buildEngineConfig,
  DEFAULT_SETTINGS,
  isValidHost,
  parseSettings,
  serializeSettings,
  settingsProblems,
  useSettingsStore,
} from '../settingsStore';

beforeEach(() => {
  __resetSettingsStoreForTests();
});

test('defaults are runnable with three probe hosts', () => {
  expect(DEFAULT_SETTINGS.hosts).toHaveLength(3);
  expect(settingsProblems(DEFAULT_SETTINGS)).toEqual([]);
});

test('isValidHost accepts IPv4 and DNS names, rejects junk', () => {
  expect(isValidHost('1.1.1.1')).toBe(true);
  expect(isValidHost('dns.google')).toBe(true);
  expect(isValidHost('10.0.2.2')).toBe(true);
  expect(isValidHost('300.1.1.1')).toBe(false);
  expect(isValidHost('not a host')).toBe(false);
  expect(isValidHost('   ')).toBe(false);
});

test('settingsProblems flags too few hosts, bad hosts and bad ports', () => {
  const problems = settingsProblems({
    ...DEFAULT_SETTINGS,
    hosts: ['1.1.1.1', 'bad host', ''],
    probePort: 0,
    backendPort: 70000,
  });
  expect(problems).toEqual([
    'Configure at least 3 probe hosts.',
    'Host 2 is not a valid IP or hostname.',
    'Probe port must be between 1 and 65535.',
    'Backend port must be between 1 and 65535.',
  ]);
});

test('backend address is ignored when throughput is off', () => {
  expect(
    settingsProblems({ ...DEFAULT_SETTINGS, includeThroughput: false, backendHost: '' }),
  ).toEqual([]);
});

test('buildEngineConfig trims hosts and maps the backend', () => {
  const config = buildEngineConfig({
    ...DEFAULT_SETTINGS,
    hosts: [' 1.1.1.1 ', '8.8.8.8', 'one.one.one.one', ''],
    backendHost: '192.168.0.10',
    backendPort: 8080,
  });
  expect(config.probe.hosts).toEqual(['1.1.1.1', '8.8.8.8', 'one.one.one.one']);
  expect(config.throughput?.host).toBe('192.168.0.10');
  expect(config.throughput?.port).toBe(8080);
  expect(
    buildEngineConfig({ ...DEFAULT_SETTINGS, includeThroughput: false }).throughput,
  ).toBeNull();
});

test('settings round-trip and malformed input falls back to defaults', () => {
  const custom = { ...DEFAULT_SETTINGS, hosts: ['a.com', 'b.com', 'c.com', 'd.com'], autoIntervalSec: 60 };
  expect(parseSettings(serializeSettings(custom))).toEqual(custom);
  expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS);
  expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(parseSettings(JSON.stringify({ hosts: ['x'], autoIntervalSec: 7 }))).toEqual(
    DEFAULT_SETTINGS,
  );
});

test('store edits hosts but never drops below three', () => {
  const store = useSettingsStore.getState();
  store.setHost(0, '9.9.9.9');
  store.addHost();
  expect(useSettingsStore.getState().settings.hosts).toHaveLength(4);
  useSettingsStore.getState().removeHost(3);
  useSettingsStore.getState().removeHost(0);
  const hosts = useSettingsStore.getState().settings.hosts;
  expect(hosts).toHaveLength(3);
  expect(hosts[0]).toBe('9.9.9.9');
});
