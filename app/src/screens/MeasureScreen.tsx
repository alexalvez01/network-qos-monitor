/**
 * Measure screen (RF-02, RF-03, RF-04): the foreground test bench.
 *
 * Same instrument language as Status: one primary action (run a test),
 * a walk card that says whether results are being recorded, a per-host
 * latency table (min / avg / max / jitter / loss), throughput tiles, and
 * the editable probe hosts and backend address underneath. Every state
 * — idle, running, failed, not recording — is spelled out.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMeasurementStore } from '../measurement/measurementStore';
import {
  endWalk,
  runPassNow,
  startAuto,
  startWalk,
  stopAuto,
  useMeasureController,
} from '../measurement/measureController';
import {
  AUTO_INTERVAL_CHOICES_SEC,
  MIN_PROBE_HOSTS,
  settingsProblems,
  useSettingsStore,
} from '../measurement/settingsStore';
import { useWalkStore } from '../measurement/walkStore';
import { networkTypeLabel } from '../measurement/foregroundPass';
import type { SaveOutcome } from '../measurement/foregroundPass';
import type { HostMeasurement, ThroughputResult } from '../measurement/types';
import { loadSettings, saveSettings } from '../measurement/settingsPersistence';
import { openAppDatabase } from '../data/database';
import { useNetworkStore } from '../store/networkStore';
import { COLORS } from '../visualization/theme';

function ms(value: number | null): string {
  return value == null ? '—' : `${Math.round(value)}`;
}

function saveLabel(save: SaveOutcome | null): string {
  if (!save) {
    return 'No test run yet.';
  }
  switch (save.status) {
    case 'saved':
      return `Saved ${save.rows} samples to the walk.`;
    case 'no-session':
      return 'Not recorded: start a walk to save results to the map.';
    case 'no-fix':
      return `Not recorded: no GPS fix (${save.reason}).`;
    case 'failed':
      return `Not recorded: ${save.reason}`;
  }
}

function useCountdown(target: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (target == null) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  return target == null ? null : Math.max(0, Math.ceil((target - now) / 1000));
}

function HostRow({ host }: { host: HostMeasurement }) {
  const loss =
    host.lossRatio == null ? '—' : `${Math.round(host.lossRatio * 100)}%`;
  const lossy = (host.lossRatio ?? 0) > 0;
  return (
    <View style={styles.hostRow}>
      <Text style={styles.hostName} numberOfLines={1}>
        {host.host}
      </Text>
      <Text style={styles.cell}>{ms(host.rtt.minMs)}</Text>
      <Text style={[styles.cell, styles.cellStrong]}>{ms(host.rtt.meanMs)}</Text>
      <Text style={styles.cell}>{ms(host.rtt.maxMs)}</Text>
      <Text style={styles.cell}>{ms(host.rtt.jitterMs)}</Text>
      <Text style={[styles.cell, lossy && styles.cellBad]}>{loss}</Text>
    </View>
  );
}

function ThroughputTile({
  label,
  result,
}: {
  label: string;
  result: ThroughputResult | null;
}) {
  const failed = result != null && !result.ok;
  return (
    <View style={styles.tpTile}>
      <Text style={styles.tpLabel}>{label}</Text>
      {result == null ? (
        <Text style={[styles.tpValue, styles.dimmed]}>—</Text>
      ) : failed ? (
        <Text style={[styles.tpError]} numberOfLines={2}>
          Failed: {result.error ?? 'error'}
        </Text>
      ) : (
        <Text style={styles.tpValue}>
          {result.mbps.toFixed(1)}
          <Text style={styles.tpUnit}> Mbps</Text>
        </Text>
      )}
      {result && result.ok ? (
        <Text style={styles.tpHint}>
          {(result.bytesTransferred / 1e6).toFixed(1)} MB in{' '}
          {(result.elapsedMs / 1000).toFixed(2)} s
        </Text>
      ) : null}
    </View>
  );
}

export default function MeasureScreen() {
  const latest = useMeasurementStore(s => s.latest);
  const running = useMeasureController(s => s.running);
  const auto = useMeasureController(s => s.auto);
  const nextRunAt = useMeasureController(s => s.nextRunAt);
  const error = useMeasureController(s => s.error);
  const lastAlert = useMeasureController(s => s.lastAlert);
  const walk = useWalkStore(s => s.walk);
  const passesSaved = useWalkStore(s => s.passesSaved);
  const lastSave = useWalkStore(s => s.lastSave);
  const lastPosition = useWalkStore(s => s.lastPosition);
  const settings = useSettingsStore(s => s.settings);
  const linkLabel = useNetworkStore(
    s => networkTypeLabel(s)?.toUpperCase() ?? 'unknown link',
  );
  const [walkBusy, setWalkBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const countdown = useCountdown(running ? null : nextRunAt);

  useEffect(() => {
    loadSettings(openAppDatabase()).then(
      loaded => useSettingsStore.getState().replace(loaded),
      () => undefined,
    );
  }, []);

  const problems = settingsProblems(settings);

  const onToggleWalk = async () => {
    setWalkBusy(true);
    try {
      if (walk) {
        await endWalk();
      } else {
        await startWalk();
      }
    } finally {
      setWalkBusy(false);
    }
  };

  const onSaveSettings = async () => {
    if (problems.length > 0) {
      setSettingsNote(problems[0] ?? null);
      return;
    }
    try {
      await saveSettings(openAppDatabase(), settings);
      setSettingsNote('Saved. Next test uses these hosts.');
    } catch (err) {
      setSettingsNote(
        `Could not save: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Measure</Text>
        <Text style={styles.subtitle}>
          TCP connect RTT to {settings.hosts.filter(Boolean).length} hosts
          {settings.includeThroughput ? ' + download/upload throughput' : ''} ·{' '}
          on {linkLabel}
        </Text>

        <View style={[styles.walkCard, walk && styles.walkCardActive]}>
          <View style={styles.walkHead}>
            <View
              style={[
                styles.recDot,
                { backgroundColor: walk ? COLORS.danger : COLORS.muted },
              ]}
            />
            <Text style={styles.walkTitle}>
              {walk ? `Recording: ${walk.name}` : 'Not recording'}
            </Text>
          </View>
          <Text style={styles.walkNote}>
            {walk
              ? `${passesSaved} test${passesSaved === 1 ? '' : 's'} saved with GPS. Results appear on Map and History.`
              : 'Start a walk to tag every test with GPS and save it to the coverage map.'}
          </Text>
          {lastPosition ? (
            <Text style={styles.walkGps}>
              GPS {lastPosition.latitude.toFixed(5)},{' '}
              {lastPosition.longitude.toFixed(5)}
              {lastPosition.accuracy != null
                ? ` ±${Math.round(lastPosition.accuracy)} m`
                : ''}
            </Text>
          ) : null}
          <Pressable
            style={[styles.walkButton, walk && styles.walkButtonStop]}
            onPress={onToggleWalk}
            disabled={walkBusy}
            accessibilityRole="button"
            accessibilityLabel={walk ? 'End walk' : 'Start walk'}>
            {walkBusy ? (
              <ActivityIndicator color={COLORS.ink} />
            ) : (
              <Text style={styles.walkButtonText}>
                {walk ? 'End walk' : 'Start walk'}
              </Text>
            )}
          </Pressable>
        </View>

        <Pressable
          style={[styles.runButton, (running || problems.length > 0) && styles.busy]}
          onPress={runPassNow}
          disabled={running || problems.length > 0}
          accessibilityRole="button"
          accessibilityLabel="Run test now">
          {running ? (
            <View style={styles.runBusy}>
              <ActivityIndicator color={COLORS.abyss} />
              <Text style={styles.runText}>Measuring…</Text>
            </View>
          ) : (
            <Text style={styles.runText}>Run test now</Text>
          )}
        </Pressable>

        <View style={styles.autoRow}>
          <View style={styles.autoText}>
            <Text style={styles.autoLabel}>
              Repeat every {settings.autoIntervalSec} s
            </Text>
            <Text style={styles.autoHint}>
              {auto
                ? running
                  ? 'Test in progress…'
                  : countdown != null
                    ? `Next test in ${countdown} s`
                    : 'Scheduled'
                : 'Keeps measuring while you walk, even on other tabs.'}
            </Text>
          </View>
          <Switch
            value={auto}
            onValueChange={value => (value ? startAuto() : stopAuto())}
            disabled={problems.length > 0}
            trackColor={{ true: COLORS.signal, false: COLORS.panelEdge }}
            thumbColor={COLORS.ink}
            accessibilityLabel="Repeat test automatically"
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {lastAlert ? (
          <Text style={styles.alert}>⚠ {lastAlert}</Text>
        ) : null}
        <Text style={styles.saveNote}>{saveLabel(lastSave)}</Text>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Latency per host (ms)</Text>
          <View style={[styles.hostRow, styles.headRow]}>
            <Text style={[styles.hostName, styles.headText]}>Host</Text>
            <Text style={[styles.cell, styles.headText]}>min</Text>
            <Text style={[styles.cell, styles.headText]}>avg</Text>
            <Text style={[styles.cell, styles.headText]}>max</Text>
            <Text style={[styles.cell, styles.headText]}>jitter</Text>
            <Text style={[styles.cell, styles.headText]}>loss</Text>
          </View>
          {latest ? (
            latest.hosts.map(host => <HostRow key={host.host} host={host} />)
          ) : (
            <Text style={styles.empty}>Run a test to see RTT statistics.</Text>
          )}
          {latest ? (
            <Text style={styles.panelHint}>
              {latest.hosts[0]?.sent ?? 0} TCP connects per host to port{' '}
              {latest.hosts[0]?.port ?? settings.probePort} · jitter per RFC 3550
              · {new Date(latest.endedAt).toLocaleTimeString()}
            </Text>
          ) : null}
        </View>

        <View style={styles.tpRow}>
          <ThroughputTile label="Download" result={latest?.download ?? null} />
          <ThroughputTile label="Upload" result={latest?.upload ?? null} />
        </View>

        <Pressable
          style={styles.settingsHead}
          onPress={() => setSettingsOpen(open => !open)}
          accessibilityRole="button"
          accessibilityLabel="Toggle test settings">
          <Text style={styles.panelTitle}>Test settings</Text>
          <Text style={styles.chevron}>{settingsOpen ? '▲' : '▼'}</Text>
        </Pressable>

        {settingsOpen ? (
          <View style={styles.panel}>
            <Text style={styles.fieldLabel}>
              Probe hosts (min. {MIN_PROBE_HOSTS}), TCP port {settings.probePort}
            </Text>
            {settings.hosts.map((host, index) => (
              <View key={index} style={styles.hostEdit}>
                <TextInput
                  style={styles.input}
                  value={host}
                  onChangeText={value =>
                    useSettingsStore.getState().setHost(index, value)
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="IP or hostname"
                  placeholderTextColor={COLORS.muted}
                  accessibilityLabel={`Probe host ${index + 1}`}
                />
                {settings.hosts.length > MIN_PROBE_HOSTS ? (
                  <Pressable
                    style={styles.smallButton}
                    onPress={() => useSettingsStore.getState().removeHost(index)}
                    accessibilityLabel={`Remove host ${index + 1}`}>
                    <Text style={styles.smallButtonText}>✕</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            <Pressable
              style={styles.addButton}
              onPress={() => useSettingsStore.getState().addHost()}
              accessibilityRole="button">
              <Text style={styles.addButtonText}>+ Add host</Text>
            </Pressable>

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Throughput test</Text>
              <Switch
                value={settings.includeThroughput}
                onValueChange={value =>
                  useSettingsStore.getState().update({ includeThroughput: value })
                }
                trackColor={{ true: COLORS.signal, false: COLORS.panelEdge }}
                thumbColor={COLORS.ink}
              />
            </View>
            <Text style={styles.fieldLabel}>Reference backend (host : port)</Text>
            <View style={styles.hostEdit}>
              <TextInput
                style={[styles.input, styles.inputWide]}
                value={settings.backendHost}
                onChangeText={value =>
                  useSettingsStore.getState().update({ backendHost: value })
                }
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Backend host"
              />
              <TextInput
                style={[styles.input, styles.inputPort]}
                value={String(settings.backendPort)}
                onChangeText={value =>
                  useSettingsStore
                    .getState()
                    .update({ backendPort: Number.parseInt(value, 10) || 0 })
                }
                keyboardType="number-pad"
                accessibilityLabel="Backend port"
              />
            </View>

            <Text style={styles.fieldLabel}>Repeat interval</Text>
            <View style={styles.chips}>
              {AUTO_INTERVAL_CHOICES_SEC.map(sec => {
                const active = settings.autoIntervalSec === sec;
                return (
                  <Pressable
                    key={sec}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() =>
                      useSettingsStore.getState().update({ autoIntervalSec: sec })
                    }
                    accessibilityState={{ selected: active }}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {sec} s
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {problems.map(problem => (
              <Text key={problem} style={styles.error}>
                {problem}
              </Text>
            ))}
            <Pressable
              style={styles.saveButton}
              onPress={onSaveSettings}
              accessibilityRole="button">
              <Text style={styles.saveButtonText}>Save settings</Text>
            </Pressable>
            {settingsNote ? (
              <Text style={styles.panelHint}>{settingsNote}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.abyss, flex: 1 },
  scroll: { paddingBottom: 32, paddingHorizontal: 20, paddingTop: 12 },
  title: { color: COLORS.ink, fontSize: 22, fontWeight: '700' },
  subtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  walkCard: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  walkCardActive: { borderColor: COLORS.danger },
  walkHead: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  recDot: { borderRadius: 6, height: 12, width: 12 },
  walkTitle: { color: COLORS.ink, flexShrink: 1, fontSize: 16, fontWeight: '700' },
  walkNote: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 6 },
  walkGps: { color: COLORS.signal, fontFamily: 'monospace', fontSize: 12, marginTop: 6 },
  walkButton: {
    alignItems: 'center',
    borderColor: COLORS.signal,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 11,
  },
  walkButtonStop: { borderColor: COLORS.danger },
  walkButtonText: { color: COLORS.ink, fontSize: 15, fontWeight: '700' },
  runButton: {
    alignItems: 'center',
    backgroundColor: COLORS.signal,
    borderRadius: 14,
    marginTop: 14,
    paddingVertical: 16,
  },
  busy: { opacity: 0.7 },
  runBusy: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  runText: { color: COLORS.abyss, fontSize: 17, fontWeight: '800' },
  autoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  autoText: { flex: 1 },
  autoLabel: { color: COLORS.ink, fontSize: 15, fontWeight: '600' },
  autoHint: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  error: { color: COLORS.danger, fontSize: 13, marginTop: 8 },
  alert: { color: COLORS.warn, fontSize: 13, marginTop: 8 },
  saveNote: { color: COLORS.muted, fontSize: 12, marginTop: 8 },
  panel: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
  },
  panelTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '700' },
  panelHint: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  headRow: { borderBottomColor: COLORS.panelEdge, borderBottomWidth: 1, marginTop: 8 },
  headText: { color: COLORS.muted, fontFamily: undefined, fontSize: 11, fontWeight: '400' },
  hostRow: { alignItems: 'center', flexDirection: 'row', paddingVertical: 7 },
  hostName: { color: COLORS.ink, flex: 2.2, fontFamily: 'monospace', fontSize: 13 },
  cell: {
    color: COLORS.ink,
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 13,
    textAlign: 'right',
  },
  cellStrong: { color: COLORS.signal, fontWeight: '700' },
  cellBad: { color: COLORS.danger },
  empty: { color: COLORS.muted, fontSize: 13, fontStyle: 'italic', marginTop: 10 },
  tpRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  tpTile: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    padding: 14,
  },
  tpLabel: { color: COLORS.muted, fontSize: 12 },
  tpValue: {
    color: COLORS.ink,
    fontFamily: 'monospace',
    fontSize: 26,
    fontWeight: '800',
    marginTop: 6,
  },
  tpUnit: { color: COLORS.muted, fontSize: 13, fontWeight: '400' },
  tpHint: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  tpError: { color: COLORS.danger, fontSize: 12, marginTop: 8 },
  dimmed: { color: COLORS.muted },
  settingsHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingVertical: 6,
  },
  chevron: { color: COLORS.muted, fontSize: 14 },
  fieldLabel: { color: COLORS.muted, fontSize: 12, marginBottom: 6, marginTop: 10 },
  hostEdit: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.abyss,
    borderColor: COLORS.panelEdge,
    borderRadius: 10,
    borderWidth: 1,
    color: COLORS.ink,
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  inputWide: { flex: 3 },
  inputPort: { flex: 1 },
  smallButton: {
    alignItems: 'center',
    borderColor: COLORS.panelEdge,
    borderRadius: 10,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  smallButtonText: { color: COLORS.muted, fontSize: 16 },
  addButton: { paddingVertical: 6 },
  addButtonText: { color: COLORS.signal, fontSize: 14, fontWeight: '600' },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    borderColor: COLORS.panelEdge,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: COLORS.signal, borderColor: COLORS.signal },
  chipText: { color: COLORS.ink, fontSize: 13 },
  chipTextActive: { color: COLORS.abyss, fontWeight: '700' },
  saveButton: {
    alignItems: 'center',
    backgroundColor: COLORS.panelEdge,
    borderRadius: 12,
    marginTop: 14,
    paddingVertical: 12,
  },
  saveButtonText: { color: COLORS.ink, fontSize: 15, fontWeight: '700' },
});
