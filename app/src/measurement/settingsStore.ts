/**
 * User-editable measurement settings (RF-02 "at least 3 configurable
 * hosts", RF-03 backend address), held in Zustand (ADR-9).
 *
 * Pure: no native imports. Persistence to SQLite happens in the screen
 * hook through `serializeSettings` / `parseSettings`, so this module and
 * its validation are unit-tested without a device.
 */

import { create } from 'zustand';
import type { EngineConfig } from './engine';
import {
  DEFAULT_PROBE_CONFIG,
  DEFAULT_PROBE_HOSTS,
  DEFAULT_PROBE_PORT,
  DEFAULT_THROUGHPUT_CONFIG,
} from './types';

export const MIN_PROBE_HOSTS = 3;
export const AUTO_INTERVAL_CHOICES_SEC: readonly number[] = [15, 30, 60];

export interface MeasurementSettings {
  hosts: string[];
  probePort: number;
  backendHost: string;
  backendPort: number;
  includeThroughput: boolean;
  autoIntervalSec: number;
}

export const DEFAULT_SETTINGS: MeasurementSettings = {
  hosts: [...DEFAULT_PROBE_HOSTS],
  probePort: DEFAULT_PROBE_PORT,
  backendHost: DEFAULT_THROUGHPUT_CONFIG.host,
  backendPort: DEFAULT_THROUGHPUT_CONFIG.port,
  includeThroughput: true,
  autoIntervalSec: 30,
};

const HOSTNAME = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** IPv4 literal or DNS name; the transport resolves names on device. */
export function isValidHost(value: string): boolean {
  const host = value.trim();
  if (host.length === 0) {
    return false;
  }
  if (/^[\d.]+$/.test(host)) {
    return IPV4.test(host);
  }
  return HOSTNAME.test(host);
}

export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Problems that block a run, in display order; empty when runnable. */
export function settingsProblems(settings: MeasurementSettings): string[] {
  const problems: string[] = [];
  const hosts = settings.hosts.map(host => host.trim()).filter(Boolean);
  if (hosts.length < MIN_PROBE_HOSTS) {
    problems.push(`Configure at least ${MIN_PROBE_HOSTS} probe hosts.`);
  }
  settings.hosts.forEach((host, index) => {
    if (host.trim().length > 0 && !isValidHost(host)) {
      problems.push(`Host ${index + 1} is not a valid IP or hostname.`);
    }
  });
  if (!isValidPort(settings.probePort)) {
    problems.push('Probe port must be between 1 and 65535.');
  }
  if (settings.includeThroughput) {
    if (!isValidHost(settings.backendHost)) {
      problems.push('Backend host is not a valid IP or hostname.');
    }
    if (!isValidPort(settings.backendPort)) {
      problems.push('Backend port must be between 1 and 65535.');
    }
  }
  return problems;
}

export function buildEngineConfig(settings: MeasurementSettings): EngineConfig {
  const hosts = settings.hosts.map(host => host.trim()).filter(Boolean);
  return {
    probe: { ...DEFAULT_PROBE_CONFIG, hosts, port: settings.probePort },
    throughput: settings.includeThroughput
      ? {
          ...DEFAULT_THROUGHPUT_CONFIG,
          host: settings.backendHost.trim(),
          port: settings.backendPort,
        }
      : null,
  };
}

export function serializeSettings(settings: MeasurementSettings): string {
  return JSON.stringify(settings);
}

/** Tolerant parse: unknown or malformed fields fall back to defaults. */
export function parseSettings(raw: string | null | undefined): MeasurementSettings {
  if (!raw) {
    return { ...DEFAULT_SETTINGS, hosts: [...DEFAULT_SETTINGS.hosts] };
  }
  let value: Partial<Record<keyof MeasurementSettings, unknown>>;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS, hosts: [...DEFAULT_SETTINGS.hosts] };
  }
  const hosts =
    Array.isArray(value.hosts) && value.hosts.every(h => typeof h === 'string')
      ? (value.hosts as string[])
      : [...DEFAULT_SETTINGS.hosts];
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    hosts: hosts.length >= MIN_PROBE_HOSTS ? hosts : [...DEFAULT_SETTINGS.hosts],
    probePort: num(value.probePort, DEFAULT_SETTINGS.probePort),
    backendHost:
      typeof value.backendHost === 'string'
        ? value.backendHost
        : DEFAULT_SETTINGS.backendHost,
    backendPort: num(value.backendPort, DEFAULT_SETTINGS.backendPort),
    includeThroughput:
      typeof value.includeThroughput === 'boolean'
        ? value.includeThroughput
        : DEFAULT_SETTINGS.includeThroughput,
    autoIntervalSec: AUTO_INTERVAL_CHOICES_SEC.includes(
      num(value.autoIntervalSec, -1),
    )
      ? num(value.autoIntervalSec, DEFAULT_SETTINGS.autoIntervalSec)
      : DEFAULT_SETTINGS.autoIntervalSec,
  };
}

interface SettingsState {
  settings: MeasurementSettings;
  replace: (settings: MeasurementSettings) => void;
  update: (patch: Partial<MeasurementSettings>) => void;
  setHost: (index: number, value: string) => void;
  addHost: () => void;
  removeHost: (index: number) => void;
}

export const useSettingsStore = create<SettingsState>()(set => ({
  settings: { ...DEFAULT_SETTINGS, hosts: [...DEFAULT_SETTINGS.hosts] },
  replace: settings => set({ settings }),
  update: patch => set(state => ({ settings: { ...state.settings, ...patch } })),
  setHost: (index, value) =>
    set(state => {
      const hosts = [...state.settings.hosts];
      if (index >= 0 && index < hosts.length) {
        hosts[index] = value;
      }
      return { settings: { ...state.settings, hosts } };
    }),
  addHost: () =>
    set(state => ({
      settings: { ...state.settings, hosts: [...state.settings.hosts, ''] },
    })),
  removeHost: index =>
    set(state => {
      if (state.settings.hosts.length <= MIN_PROBE_HOSTS) {
        return state;
      }
      const hosts = state.settings.hosts.filter((_, i) => i !== index);
      return { settings: { ...state.settings, hosts } };
    }),
}));

/** Test-only helper: reset store state between tests. */
export function __resetSettingsStoreForTests(): void {
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, hosts: [...DEFAULT_SETTINGS.hosts] },
  });
}
