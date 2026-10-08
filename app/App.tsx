/**
 * Root shell: state-driven tabs across Status / Measure / Map / History,
 * plus the Export surface and one-time background-fetch registration.
 *
 * Deliberately no navigation library: three full-screen surfaces with no
 * deep links, params or nested stacks do not justify a router dependency.
 * The active tab lives in the visualization store (ADR-9) so any screen
 * can request a tab switch without prop drilling. StatusScreen is
 * untouched — it renders as the default tab exactly as Stage 1 built it.
 *
 * Export rides on local state instead of the visualization store on
 * purpose: VisualizationTab is owned by Stage 5 and off-limits, and an
 * export overlay is not a visualization concern. The background pass is
 * registered once here (RF-07); WorkManager owns the cadence afterwards.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StatusScreen from './src/screens/StatusScreen';
import MeasureScreen from './src/screens/MeasureScreen';
import MapScreen from './src/screens/MapScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ExportScreen from './src/screens/ExportScreen';
import { useVisualizationStore } from './src/visualization/visualizationStore';
import type { VisualizationTab } from './src/visualization/visualizationStore';
import { configureBackgroundFetch } from './src/background/backgroundTask';
import { COLORS } from './src/visualization/theme';
import { useNetworkStore } from './src/store/networkStore';
import { startNativeTelemetry } from './src/telemetry/networkTelemetry';

const TABS: Array<{ id: VisualizationTab; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'measure', label: 'Measure' },
  { id: 'map', label: 'Map' },
  { id: 'history', label: 'History' },
];

function App() {
  const tab = useVisualizationStore(s => s.tab);
  const setTab = useVisualizationStore(s => s.setTab);
  const [exportOpen, setExportOpen] = useState(false);

  // Fire-and-forget by contract: configureBackgroundFetch never rejects,
  // it mirrors failure to the background store instead.
  useEffect(() => {
    configureBackgroundFetch();
  }, []);

  // Radio state is app-wide: Measure stamps every sample with it, so the
  // listeners must outlive any single tab.
  useEffect(() => {
    const stopNetInfo = useNetworkStore.getState().startMonitoring();
    const stopTelemetry = startNativeTelemetry();
    return () => {
      stopTelemetry();
      stopNetInfo();
    };
  }, []);

  const openTab = (id: VisualizationTab) => {
    setExportOpen(false);
    setTab(id);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        {exportOpen ? (
          <ExportScreen onBack={() => setExportOpen(false)} />
        ) : tab === 'status' ? (
          <StatusScreen />
        ) : tab === 'measure' ? (
          <MeasureScreen />
        ) : tab === 'map' ? (
          <MapScreen />
        ) : (
          <HistoryScreen />
        )}
      </View>
      <View style={styles.bar} accessibilityRole="tablist">
        {TABS.map(item => {
          const active = item.id === tab && !exportOpen;
          return (
            <Pressable
              key={item.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => openTab(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${item.label} tab`}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {item.label}
              </Text>
              {active ? <View style={styles.tabDot} /> : null}
            </Pressable>
          );
        })}
        <Pressable
          style={[styles.tab, exportOpen && styles.tabActive]}
          onPress={() => setExportOpen(true)}
          accessibilityRole="tab"
          accessibilityState={{ selected: exportOpen }}
          accessibilityLabel="Export tab">
          <Text style={[styles.tabText, exportOpen && styles.tabTextActive]}>
            Export
          </Text>
          {exportOpen ? <View style={styles.tabDot} /> : null}
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
  body: {
    flex: 1,
  },
  bar: {
    backgroundColor: COLORS.abyss,
    borderTopColor: COLORS.panelEdge,
    borderTopWidth: 1,
    flexDirection: 'row',
    minHeight: 60,
  },
  tab: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 60,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: COLORS.panel,
  },
  tabText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: COLORS.signal,
  },
  tabDot: {
    backgroundColor: COLORS.signal,
    borderRadius: 2,
    height: 4,
    marginTop: 4,
    width: 16,
  },
});

export default App;
