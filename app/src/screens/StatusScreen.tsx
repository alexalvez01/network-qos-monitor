/**
 * Stage 1 status screen: live network instrumentation plus permission state.
 *
 * Visual idea: a field instrument, not a settings page. One hero readout
 * (connection class + radio subtype) with a live indicator, a small grid
 * of metric tiles, then a quiet permission panel with a single action.
 * Missing data always renders as an explicit empty state — never null,
 * undefined or -1 shown as data.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNetworkStore } from '../store/networkStore';
import {
  AppPermissionStatuses,
  checkAppPermissions,
  PermissionStatus,
  requestAppPermissions,
} from '../permissions/permissions';
import { COLORS } from '../visualization/theme';

const EMPTY = 'Not available';

function displayText(value: string | null): string {
  return value && value.length > 0 ? value : EMPTY;
}

function statusLabel(status: PermissionStatus): string {
  switch (status) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied';
    case 'never_ask_again':
      return 'Blocked in settings';
    case 'unavailable':
      return 'Not on this device';
    default:
      return 'Unknown';
  }
}

function statusColor(status: PermissionStatus): string {
  switch (status) {
    case 'granted':
      return COLORS.signal;
    case 'denied':
    case 'never_ask_again':
      return COLORS.danger;
    default:
      return COLORS.muted;
  }
}

function LiveDot({ connected }: { connected: boolean | null }) {
  const color =
    connected === true
      ? COLORS.signal
      : connected === false
        ? COLORS.danger
        : COLORS.warn;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function Hero({
  type,
  subtype,
  connected,
}: {
  type: string;
  subtype: string | null;
  connected: boolean | null;
}) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroRow}>
        <LiveDot connected={connected} />
        <Text style={styles.heroKicker}>Active connection</Text>
      </View>
      <Text style={styles.heroType}>{type}</Text>
      <Text style={[styles.heroSubtype, subtype == null && styles.dimmed]}>
        {subtype == null
          ? 'Radio subtype not available'
          : type.toLowerCase() === 'wifi'
            ? `Cellular radio standing by: ${subtype}`
            : subtype}
      </Text>
    </View>
  );
}

function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const isEmpty = value === EMPTY;
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, isEmpty && styles.dimmed]}>{value}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

function PermissionRow({
  label,
  status,
}: {
  label: string;
  status: PermissionStatus;
}) {
  return (
    <View style={styles.permRow}>
      <Text style={styles.permLabel}>{label}</Text>
      <View style={styles.permPill}>
        <View
          style={[styles.permDot, { backgroundColor: statusColor(status) }]}
        />
        <Text style={styles.permStatus}>{statusLabel(status)}</Text>
      </View>
    </View>
  );
}

const INITIAL_PERMISSIONS: AppPermissionStatuses = {
  foregroundLocation: 'unknown',
  backgroundLocation: 'unknown',
  phoneState: 'unknown',
  notifications: 'unknown',
};

export default function StatusScreen() {
  const type = useNetworkStore(s => s.type);
  const subtype = useNetworkStore(s => s.subtype);
  const cellularGeneration = useNetworkStore(s => s.cellularGeneration);
  const strength = useNetworkStore(s => s.strength);
  const carrier = useNetworkStore(s => s.carrier);
  const signalDbm = useNetworkStore(s => s.signalDbm);
  const cellIdentity = useNetworkStore(s => s.cellIdentity);
  const isConnected = useNetworkStore(s => s.isConnected);
  const isInternetReachable = useNetworkStore(s => s.isInternetReachable);

  const [permissions, setPermissions] =
    useState<AppPermissionStatuses>(INITIAL_PERMISSIONS);
  const [requesting, setRequesting] = useState(false);

  // NetInfo and native telemetry are started once in App (they feed
  // Measure too); this screen only reads the store.
  useEffect(() => {
    checkAppPermissions().then(setPermissions, () => undefined);
  }, []);

  const onRequestPermissions = useCallback(async () => {
    setRequesting(true);
    try {
      const next = await requestAppPermissions();
      setPermissions(next);
    } finally {
      setRequesting(false);
    }
  }, []);

  const connectivity =
    isConnected == null
      ? EMPTY
      : isConnected
        ? 'Connected'
        : 'Disconnected';
  const reachability =
    isInternetReachable == null
      ? EMPTY
      : isInternetReachable
        ? 'Reachable'
        : 'Unreachable';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.appName}>Network QoS Monitor</Text>
        <Text style={styles.appSub}>
          Live connection class, native radio details (carrier, dBm, cell)
          and permissions
        </Text>

        <Hero type={type} subtype={subtype} connected={isConnected} />

        <View style={styles.grid}>
          <MetricTile
            label="Cellular generation"
            value={cellularGeneration ? displayText(cellularGeneration.toUpperCase()) : EMPTY}
            hint="2G to 5G where reported"
          />
          <MetricTile
            label="Signal strength"
            value={strength == null ? EMPTY : `${strength} / 100`}
            hint="Wi-Fi level on Android"
          />
          <MetricTile label="Link state" value={connectivity} />
          <MetricTile label="Internet check" value={reachability} />
          <MetricTile
            label="Carrier"
            value={displayText(carrier)}
            hint="Blank on iOS 16.4 and later"
          />
          <MetricTile
            label="Signal in dBm"
            value={signalDbm == null ? EMPTY : `${signalDbm} dBm`}
            hint="Live RSSI from the native module"
          />
          <MetricTile
            label="Serving cell"
            value={displayText(cellIdentity)}
            hint="Cell identity for coverage mapping"
          />
        </View>

        <View style={styles.permPanel}>
          <Text style={styles.permTitle}>Permissions</Text>
          <Text style={styles.permNote}>
            Location tags each measurement for the coverage map. Background
            location is asked separately, after the foreground grant.
          </Text>
          <PermissionRow
            label="Foreground location"
            status={permissions.foregroundLocation}
          />
          <PermissionRow
            label="Background location"
            status={permissions.backgroundLocation}
          />
          <PermissionRow
            label="Phone state (radio info)"
            status={permissions.phoneState}
          />
          <PermissionRow
            label="Notifications (alerts)"
            status={permissions.notifications}
          />
          <Pressable
            style={[styles.button, requesting && styles.buttonBusy]}
            onPress={onRequestPermissions}
            disabled={requesting}
            accessibilityRole="button"
            accessibilityLabel="Request permissions">
            {requesting ? (
              <ActivityIndicator color={COLORS.abyss} />
            ) : (
              <Text style={styles.buttonText}>Request permissions</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.footnote}>
          On an emulator, or where the platform withholds a field, the panel
          above names the gap instead of guessing.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.abyss,
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
  },
  appName: {
    color: COLORS.ink,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  appSub: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  hero: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 22,
  },
  heroRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  heroKicker: {
    color: COLORS.muted,
    fontSize: 13,
  },
  heroType: {
    color: COLORS.ink,
    fontFamily: 'monospace',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 10,
  },
  heroSubtype: {
    color: COLORS.signal,
    fontFamily: 'monospace',
    fontSize: 16,
    marginTop: 2,
  },
  dimmed: {
    color: COLORS.muted,
    fontStyle: 'italic',
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
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 150,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  tileLabel: {
    color: COLORS.muted,
    fontSize: 12,
  },
  tileValue: {
    color: COLORS.ink,
    fontFamily: 'monospace',
    fontSize: 21,
    fontWeight: '700',
    marginTop: 6,
  },
  tileHint: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 4,
  },
  permPanel: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  permTitle: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: '700',
  },
  permNote: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 6,
    marginTop: 4,
  },
  permRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
  },
  permLabel: {
    color: COLORS.ink,
    fontSize: 14,
  },
  permPill: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  permDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  permStatus: {
    color: COLORS.ink,
    fontSize: 13,
  },
  button: {
    alignItems: 'center',
    backgroundColor: COLORS.signal,
    borderRadius: 12,
    marginTop: 12,
    paddingVertical: 13,
  },
  buttonBusy: {
    opacity: 0.75,
  },
  buttonText: {
    color: COLORS.abyss,
    fontSize: 15,
    fontWeight: '700',
  },
  footnote: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 14,
  },
});
