/**
 * Stage 5 history screen (RF-06): recorded walks plus per-walk detail with
 * latency and throughput time-series charts.
 *
 * Visual idea: a quiet list of walk rows; tapping a row opens the
 * instrument view for that walk — stat tiles first, then the two charts.
 * Every state (loading, error, empty, no-filter-match) says something
 * useful; the screen is never blank.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LineChart from '../visualization/charts/LineChart';
import {
  DATE_RANGE_LABELS,
  filterSummaries,
  formatDuration,
  formatLatency,
  formatThroughput,
  formatTimestamp,
  resolveDateRange,
  summarizeSession,
  WORLD_AREA,
} from '../visualization/history/history';
import type {
  DateRangePreset,
  SessionSummary,
} from '../visualization/history/history';
import { useSessionData } from '../visualization/history/useSessionData';
import { useVisualizationStore } from '../visualization/visualizationStore';
import { CHART_SERIES, COLORS } from '../visualization/theme';

function lastFinite(values: ReadonlyArray<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

function WalkRow({
  summary,
  onOpen,
}: {
  summary: SessionSummary;
  onOpen: () => void;
}) {
  const name = summary.session.name ?? 'Unnamed walk';
  const networks =
    summary.networkTypes.length > 0 ? summary.networkTypes.join(', ') : 'Unknown link';
  return (
    <Pressable
      style={styles.row}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open walk ${name}`}>
      <View style={styles.rowMain}>
        <Text style={styles.rowName}>{name}</Text>
        <Text style={styles.rowDate}>
          {formatTimestamp(summary.session.startedAt)}
        </Text>
        <Text style={styles.rowMeta}>
          {summary.sampleCount} {summary.sampleCount === 1 ? 'sample' : 'samples'} ·{' '}
          {formatLatency(summary.meanLatencyMs)} mean ·{' '}
          {formatThroughput(summary.maxThroughputMbps)} best · {networks}
        </Text>
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

export default function HistoryScreen() {
  const selectedSessionId = useVisualizationStore(s => s.selectedSessionId);
  const selectSession = useVisualizationStore(s => s.selectSession);
  const { loading, error, sessions, reload } = useSessionData();
  const [networkFilter, setNetworkFilter] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
  const [locationOnly, setLocationOnly] = useState(false);

  const summaries = useMemo<SessionSummary[]>(
    () =>
      sessions.map(entry => summarizeSession(entry.session, entry.samples)),
    [sessions],
  );

  const availableNetworks = useMemo(() => {
    const set = new Set<string>();
    for (const summary of summaries) {
      for (const network of summary.networkTypes) {
        set.add(network);
      }
    }
    return [...set].sort();
  }, [summaries]);

  const visible = useMemo(() => {
    const range = resolveDateRange(datePreset, Date.now());
    return filterSummaries(summaries, {
      networkType: networkFilter,
      startMs: range?.startMs ?? null,
      endMs: range?.endMs ?? null,
      // A phone list cannot hand-draw a box, so "With location" wires the
      // area clause as the whole-world box: exactly the has-position test.
      area: locationOnly ? WORLD_AREA : null,
    });
  }, [summaries, networkFilter, datePreset, locationOnly]);

  const filtersActive =
    networkFilter !== null || datePreset !== 'all' || locationOnly;

  const clearFilters = () => {
    setNetworkFilter(null);
    setDatePreset('all');
    setLocationOnly(false);
  };

  const activeFilterNames = useMemo(() => {
    const names: string[] = [];
    if (networkFilter) {
      names.push(`link ${networkFilter}`);
    }
    if (datePreset !== 'all') {
      names.push(DATE_RANGE_LABELS[datePreset].toLowerCase());
    }
    if (locationOnly) {
      names.push('with location');
    }
    return names;
  }, [networkFilter, datePreset, locationOnly]);

  const selected = useMemo(() => {
    if (!selectedSessionId) {
      return null;
    }
    return sessions.find(entry => entry.session.id === selectedSessionId) ?? null;
  }, [sessions, selectedSessionId]);

  if (selected) {
    const latencyValues = selected.samples.map(sample => sample.rttMeanMs);
    const throughputValues = selected.samples.map(sample => sample.downloadMbps);
    const summary =
      summaries.find(item => item.session.id === selected.session.id) ??
      summarizeSession(selected.session, selected.samples);
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Pressable
            style={styles.backButton}
            onPress={() => selectSession(null)}
            accessibilityRole="button"
            accessibilityLabel="Back to recorded walks">
            <Text style={styles.backText}>‹ Walks</Text>
          </Pressable>
          <Text style={styles.title}>
            {selected.session.name ?? 'Unnamed walk'}
          </Text>
          <Text style={styles.subtitle}>
            {formatTimestamp(selected.session.startedAt)} ·{' '}
            {formatDuration(selected.session.startedAt, selected.session.endedAt)}
          </Text>
          <View style={styles.grid}>
            <StatTile label="Samples" value={String(selected.samples.length)} />
            <StatTile
              label="Mean latency"
              value={formatLatency(summary.meanLatencyMs)}
            />
            <StatTile
              label="Best throughput"
              value={formatThroughput(summary.maxThroughputMbps)}
            />
            <StatTile
              label="Link"
              value={
                summary.networkTypes.length > 0
                  ? summary.networkTypes.join(', ')
                  : 'Unknown'
              }
            />
          </View>
          <LineChart
            title="Latency over the walk"
            latestLabel={formatLatency(lastFinite(latencyValues))}
            values={latencyValues}
            color={CHART_SERIES.latency}
            emptyMessage="No latency samples in this walk — every probe went unanswered."
          />
          <LineChart
            title="Throughput over the walk"
            latestLabel={formatThroughput(lastFinite(throughputValues))}
            values={throughputValues}
            color={CHART_SERIES.throughput}
            emptyMessage="No throughput samples in this walk — the transfer test did not complete."
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Recorded walks</Text>
        <Text style={styles.subtitle}>
          Every walk kept on this device, newest first
        </Text>
      </View>

      {availableNetworks.length > 0 ? (
        <>
          <Text style={styles.filterLabel}>Link</Text>
          <View style={styles.chips}>
            <FilterChip
              label="All"
              active={networkFilter === null}
              onPress={() => setNetworkFilter(null)}
            />
            {availableNetworks.map(network => (
              <FilterChip
                key={network}
                label={network}
                active={networkFilter === network}
                onPress={() =>
                  setNetworkFilter(current => (current === network ? null : network))
                }
              />
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.filterLabel}>When</Text>
      <View style={styles.chips}>
        {(Object.keys(DATE_RANGE_LABELS) as DateRangePreset[]).map(preset => (
          <FilterChip
            key={preset}
            label={DATE_RANGE_LABELS[preset]}
            active={datePreset === preset}
            onPress={() => setDatePreset(preset)}
          />
        ))}
      </View>

      <Text style={styles.filterLabel}>Where</Text>
      <View style={styles.chips}>
        <FilterChip
          label="All areas"
          active={!locationOnly}
          onPress={() => setLocationOnly(false)}
        />
        <FilterChip
          label="With location"
          active={locationOnly}
          onPress={() => setLocationOnly(true)}
        />
      </View>

      {filtersActive && !loading && !error ? (
        <View style={styles.resultRow}>
          <Text style={styles.resultText}>
            Showing {visible.length} of {summaries.length}{' '}
            {summaries.length === 1 ? 'walk' : 'walks'}
          </Text>
          <Pressable
            style={styles.clearButton}
            onPress={clearFilters}
            accessibilityRole="button"
            accessibilityLabel="Clear all history filters">
            <Text style={styles.clearText}>Clear filters</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.signal} />
          <Text style={styles.centerText}>Loading recorded walks…</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Storage read failed: {error}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={reload}
            accessibilityRole="button"
            accessibilityLabel="Retry loading walks">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error && summaries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No recorded walks yet</Text>
          <Text style={styles.emptyBody}>
            Finished walks appear here with their latency and throughput
            charts. The map screen offers a demo walk to preview the layout.
          </Text>
        </View>
      ) : null}

      {!loading && !error && summaries.length > 0 && visible.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No walks match these filters</Text>
          <Text style={styles.emptyBody}>
            Nothing recorded{activeFilterNames.length > 0 ? ` ${activeFilterNames.join(', ')}` : ''}.
            Clear the filters to see every walk.
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={clearFilters}
            accessibilityRole="button"
            accessibilityLabel="Clear all history filters">
            <Text style={styles.retryText}>Clear filters</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error ? (
        <ScrollView contentContainerStyle={styles.list}>
          {visible.map(summary => (
            <WalkRow
              key={summary.session.id}
              summary={summary}
              onOpen={() => selectSession(summary.session.id)}
            />
          ))}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Filter by ${label}`}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.abyss,
    flex: 1,
  },
  scroll: {
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  title: {
    color: COLORS.ink,
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  filterLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  resultRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  resultText: {
    color: COLORS.muted,
    fontSize: 12,
  },
  clearButton: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
  },
  clearText: {
    color: COLORS.signal,
    fontSize: 13,
    fontWeight: '700',
  },
  chip: {
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  chipActive: {
    backgroundColor: COLORS.signal,
    borderColor: COLORS.signal,
  },
  chipText: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: COLORS.abyss,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centerText: {
    color: COLORS.ink,
    fontSize: 14,
    marginTop: 8,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.signal,
    borderRadius: 10,
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  retryText: {
    color: COLORS.abyss,
    fontSize: 15,
    fontWeight: '700',
  },
  emptyTitle: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: '700',
  },
  emptyBody: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    textAlign: 'center',
  },
  list: {
    gap: 10,
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  row: {
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowMain: {
    flex: 1,
  },
  rowName: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  rowDate: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 2,
  },
  rowMeta: {
    color: COLORS.ink,
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 4,
  },
  rowChevron: {
    color: COLORS.muted,
    fontSize: 24,
    marginLeft: 8,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: 16,
  },
  backText: {
    color: COLORS.signal,
    fontSize: 16,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 14,
  },
  tile: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tileLabel: {
    color: COLORS.muted,
    fontSize: 12,
  },
  tileValue: {
    color: COLORS.ink,
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
});
