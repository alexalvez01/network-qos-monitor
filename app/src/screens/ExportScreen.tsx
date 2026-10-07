/**
 * Stage 6 export screen (RF-08): share a recorded walk as CSV or JSON.
 *
 * Entry point for the share-sheet action. Session data comes from the
 * Stage 5 loader hook (ADR-9: the store holds UI state only, reads live in
 * hooks); the actual share runs through src/export/shareExport.ts against
 * an injected repository. Background status from the Stage 6 store is shown
 * so the user can see the WorkManager pass is alive.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openAppDatabase } from '../data/database';
import { MeasurementRepository } from '../data/repository';
import { useSessionData } from '../visualization/history/useSessionData';
import { formatTimestamp } from '../visualization/history/history';
import { useBackgroundStore } from '../background/backgroundStore';
import {
  shareSessionExport,
} from '../export/shareExport';
import type { ExportFormat } from '../export/shareExport';
import { COLORS } from '../visualization/theme';

type ShareState =
  | { kind: 'idle' }
  | { kind: 'working'; format: ExportFormat }
  | { kind: 'done'; outcome: string }
  | { kind: 'error'; message: string };

function backgroundSummary(
  status: string,
  lastRunAt: number | null,
  lastOutcome: string | null,
): string {
  if (lastRunAt == null) {
    return `Background sampling: ${status} — no pass has run yet`;
  }
  const when = formatTimestamp(lastRunAt);
  return `Background sampling: ${status} — last pass ${when} (${lastOutcome ?? 'unknown'})`;
}

export default function ExportScreen({ onBack }: { onBack: () => void }) {
  const { loading, error, sessions, reload } = useSessionData();
  const bgStatus = useBackgroundStore(s => s.status);
  const lastRunAt = useBackgroundStore(s => s.lastRunAt);
  const lastOutcome = useBackgroundStore(s => s.lastOutcome);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [share, setShare] = useState<ShareState>({ kind: 'idle' });

  const onShare = useCallback(
    async (sessionId: string, format: ExportFormat) => {
      setShare({ kind: 'working', format });
      try {
        const repository = new MeasurementRepository(openAppDatabase());
        await repository.init();
        const outcome = await shareSessionExport(repository, sessionId, format);
        setShare({
          kind: 'done',
          outcome:
            outcome === 'shared'
              ? `${format.toUpperCase()} shared`
              : `${format.toUpperCase()} share dismissed`,
        });
      } catch (err) {
        setShare({
          kind: 'error',
          message:
            err instanceof Error && err.message
              ? err.message
              : `Could not share ${format.toUpperCase()}.`,
        });
      }
    },
    [],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable
          style={styles.backButton}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Export a walk</Text>
        <Text style={styles.subtitle}>
          Sessions leave the device as CSV or JSON through the share sheet
        </Text>
        <Text style={styles.bgLine}>
          {backgroundSummary(bgStatus, lastRunAt, lastOutcome)}
        </Text>

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

        {!loading && !error && sessions.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>No recorded walks yet</Text>
            <Text style={styles.emptyBody}>
              Walks appear here once measurements are recorded. Background
              passes accumulate under “Background sampling”.
            </Text>
          </View>
        ) : null}

        {sessions.map(entry => {
          const active = entry.session.id === selectedId;
          const name = entry.session.name ?? 'Unnamed walk';
          return (
            <Pressable
              key={entry.session.id}
              style={[styles.row, active && styles.rowActive]}
              onPress={() =>
                setSelectedId(current =>
                  current === entry.session.id ? null : entry.session.id,
                )
              }
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Select walk ${name}`}>
              <View style={styles.rowMain}>
                <Text style={styles.rowName}>{name}</Text>
                <Text style={styles.rowMeta}>
                  {formatTimestamp(entry.session.startedAt)} ·{' '}
                  {entry.samples.length}{' '}
                  {entry.samples.length === 1 ? 'sample' : 'samples'}
                </Text>
              </View>
              {active ? (
                <View style={styles.shareCol}>
                  <Pressable
                    style={styles.shareButton}
                    onPress={() => onShare(entry.session.id, 'csv')}
                    accessibilityRole="button"
                    accessibilityLabel={`Share walk ${name} as CSV`}>
                    <Text style={styles.shareText}>Share CSV</Text>
                  </Pressable>
                  <Pressable
                    style={styles.shareButton}
                    onPress={() => onShare(entry.session.id, 'json')}
                    accessibilityRole="button"
                    accessibilityLabel={`Share walk ${name} as JSON`}>
                    <Text style={styles.shareText}>Share JSON</Text>
                  </Pressable>
                </View>
              ) : null}
            </Pressable>
          );
        })}

        {share.kind === 'working' ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.signal} />
            <Text style={styles.centerText}>
              Preparing {share.format.toUpperCase()}…
            </Text>
          </View>
        ) : null}
        {share.kind === 'done' ? (
          <Text style={styles.doneText}>{share.outcome}</Text>
        ) : null}
        {share.kind === 'error' ? (
          <Text style={styles.errorText}>{share.message}</Text>
        ) : null}
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
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  backButton: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 44,
    paddingRight: 16,
  },
  backText: {
    color: COLORS.signal,
    fontSize: 16,
    fontWeight: '600',
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
  bgLine: {
    color: COLORS.muted,
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 8,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
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
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 44,
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
  row: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowActive: {
    borderColor: COLORS.signal,
  },
  rowMain: {
    flex: 1,
  },
  rowName: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  rowMeta: {
    color: COLORS.muted,
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 4,
  },
  shareCol: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  shareButton: {
    alignItems: 'center',
    backgroundColor: COLORS.signal,
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  shareText: {
    color: COLORS.abyss,
    fontSize: 14,
    fontWeight: '700',
  },
  doneText: {
    color: COLORS.signal,
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
});
