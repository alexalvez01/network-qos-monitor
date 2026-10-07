/**
 * Root shell for Stage 5: state-driven tabs across Status / Map / History.
 *
 * Deliberately no navigation library: three full-screen surfaces with no
 * deep links, params or nested stacks do not justify a router dependency.
 * The active tab lives in the visualization store (ADR-9) so any screen
 * can request a tab switch without prop drilling. StatusScreen is
 * untouched — it renders as the default tab exactly as Stage 1 built it.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StatusScreen from './src/screens/StatusScreen';
import MapScreen from './src/screens/MapScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import { useVisualizationStore } from './src/visualization/visualizationStore';
import type { VisualizationTab } from './src/visualization/visualizationStore';
import { COLORS } from './src/visualization/theme';

const TABS: Array<{ id: VisualizationTab; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'map', label: 'Map' },
  { id: 'history', label: 'History' },
];

function App() {
  const tab = useVisualizationStore(s => s.tab);
  const setTab = useVisualizationStore(s => s.setTab);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        {tab === 'status' ? (
          <StatusScreen />
        ) : tab === 'map' ? (
          <MapScreen />
        ) : (
          <HistoryScreen />
        )}
      </View>
      <View style={styles.bar} accessibilityRole="tablist">
        {TABS.map(item => {
          const active = item.id === tab;
          return (
            <Pressable
              key={item.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(item.id)}
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
