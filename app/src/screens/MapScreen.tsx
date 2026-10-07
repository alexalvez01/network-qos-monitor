/**
 * Stage 5 map screen (RF-05): coverage heat layer over OSM raster tiles.
 *
 * Visual idea: the map is the hero and fills the screen; a compact metric
 * selector sits above it and a single detail/legend card below it. Missing
 * data always renders as an explicit notice — never an empty grey map.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import HeatMapView from '../visualization/heatLayer/HeatMapView';
import {
  aggregateHeatCells,
  heatBounds,
  METRIC_LABELS,
  METRIC_UNITS,
  metricValue,
  qualityColor,
} from '../visualization/heat/heat';
import type {
  HeatCell,
  HeatPoint,
  QualityMetric,
} from '../visualization/heat/heat';
import { useSessionData } from '../visualization/history/useSessionData';
import { useVisualizationStore } from '../visualization/visualizationStore';
import { seedHeatPoints } from '../visualization/testing/seedWalk';
import { sampleToHeatPoint } from '../visualization/heat/heat';
import { COLORS } from '../visualization/theme';

const METRICS: QualityMetric[] = ['latency', 'throughput', 'dbm'];

function LegendDot({ score, label }: { score: number; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendDot,
          { backgroundColor: qualityColor(score, 0.9) },
        ]}
      />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

export default function MapScreen() {
  const metric = useVisualizationStore(s => s.metric);
  const setMetric = useVisualizationStore(s => s.setMetric);
  const showDemoWalk = useVisualizationStore(s => s.showDemoWalk);
  const setShowDemoWalk = useVisualizationStore(s => s.setShowDemoWalk);
  const { loading, error, sessions, reload } = useSessionData();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const demoPoints = useMemo<HeatPoint[]>(
    () => (showDemoWalk ? seedHeatPoints() : []),
    [showDemoWalk],
  );

  const points = useMemo<HeatPoint[]>(() => {
    const real: HeatPoint[] = [];
    for (const entry of sessions) {
      for (const sample of entry.samples) {
        real.push(sampleToHeatPoint(sample));
      }
    }
    return [...real, ...demoPoints];
  }, [sessions, demoPoints]);

  const hasMetricData = useMemo(
    () => points.some(point => metricValue(point, metric) !== null),
    [points, metric],
  );

  const cells = useMemo(
    () => (hasMetricData ? aggregateHeatCells(points, { metric }) : []),
    [points, metric, hasMetricData],
  );
  const region = useMemo(() => heatBounds(points), [points]);

  const selectedCell: HeatCell | null =
    cells.find(cell => cell.key === selectedKey) ?? null;

  const onSelectMetric = (next: QualityMetric) => {
    setMetric(next);
    setSelectedKey(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Coverage map</Text>
        <Text style={styles.subtitle}>
          {METRIC_LABELS[metric]} quality from recorded walks
          {showDemoWalk ? ' (includes demo data)' : ''}
        </Text>
      </View>

      <View style={styles.metricRow} accessibilityRole="tablist">
        {METRICS.map(item => {
          const active = item === metric;
          return (
            <Pressable
              key={item}
              style={[styles.metricButton, active && styles.metricActive]}
              onPress={() => onSelectMetric(item)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Show ${METRIC_LABELS[item]} heat layer`}>
              <Text
                style={[
                  styles.metricText,
                  active && styles.metricTextActive,
                ]}>
                {METRIC_LABELS[item]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.mapWrap}>
        <HeatMapView
          cells={cells}
          selectedKey={selectedKey}
          onSelectCell={cell => setSelectedKey(cell ? cell.key : null)}
          region={region}
        />
        {loading ? (
          <View style={styles.overlay}>
            <ActivityIndicator color={COLORS.signal} />
            <Text style={styles.overlayText}>Loading recorded walks…</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>
              Storage read failed: {error}
            </Text>
            <Pressable
              style={styles.retryButton}
              onPress={reload}
              accessibilityRole="button"
              accessibilityLabel="Retry loading walks">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {!loading && !error && points.length === 0 ? (
          <View style={styles.overlay}>
            <Text style={styles.emptyTitle}>No walks recorded yet</Text>
            <Text style={styles.emptyBody}>
              Record a walk to paint coverage here, or preview the layer
              with the demo walk below.
            </Text>
          </View>
        ) : null}
      </View>

      {metric === 'dbm' && !hasMetricData ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            No signal samples available. Signal mapping needs the Stage 2
            native radio module on Android; iOS never exposes signal
            strength, so latency or throughput is the quality metric there.
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        {selectedCell ? (
          <View style={styles.detail}>
            <Text style={styles.detailValue}>
              {Math.round(selectedCell.value * 10) / 10} {METRIC_UNITS[metric]}
            </Text>
            <Text style={styles.detailMeta}>
              Mean over {selectedCell.count}{' '}
              {selectedCell.count === 1 ? 'sample' : 'samples'} in this area.
              Tap empty map to clear.
            </Text>
          </View>
        ) : (
          <View style={styles.legend}>
            <LegendDot score={0} label="Poor" />
            <LegendDot score={0.5} label="Fair" />
            <LegendDot score={1} label="Good" />
            <Text style={styles.legendHint}>Tap a circle for detail</Text>
          </View>
        )}
        <Pressable
          style={[styles.demoButton, showDemoWalk && styles.demoButtonOn]}
          onPress={() => setShowDemoWalk(!showDemoWalk)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showDemoWalk }}
          accessibilityLabel="Toggle demo walk overlay">
          <Text
            style={[
              styles.demoButtonText,
              showDemoWalk && styles.demoButtonTextOn,
            ]}>
            {showDemoWalk ? 'Hide demo walk' : 'Show demo walk'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.abyss,
    flex: 1,
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
  metricRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  metricButton: {
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  metricActive: {
    backgroundColor: COLORS.signal,
    borderColor: COLORS.signal,
  },
  metricText: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  metricTextActive: {
    color: COLORS.abyss,
  },
  mapWrap: {
    backgroundColor: COLORS.abyss,
    flex: 1,
    marginHorizontal: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(10, 31, 51, 0.82)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: 24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  overlayText: {
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
  notice: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.warn,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 20,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  noticeText: {
    color: COLORS.warn,
    fontSize: 12,
    lineHeight: 17,
  },
  footer: {
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  detail: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 10,
  },
  detailValue: {
    color: COLORS.signal,
    fontFamily: 'monospace',
    fontSize: 24,
    fontWeight: '800',
  },
  detailMeta: {
    color: COLORS.muted,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  legend: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendDot: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  legendLabel: {
    color: COLORS.ink,
    fontSize: 13,
  },
  legendHint: {
    color: COLORS.muted,
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
  },
  demoButton: {
    alignItems: 'center',
    borderColor: COLORS.panelEdge,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  demoButtonOn: {
    borderColor: COLORS.signal,
  },
  demoButtonText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  demoButtonTextOn: {
    color: COLORS.signal,
  },
});
