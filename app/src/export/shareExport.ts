/**
 * Share-sheet export for Stage 6 (RF-08).
 *
 * Device-only thin glue: reads one session through the injected
 * repository, renders it with the pure serializers, and hands the text to
 * React Native's built-in Share API — no new dependency. The repository is
 * a parameter (never imported here) so this module loads no native storage
 * code at import time.
 */

import { Share } from 'react-native';
import type { MeasurementRepository } from '../data/repository';
import {
  buildExportFilename,
  sessionWithSamplesToCsv,
  sessionWithSamplesToJson,
} from './serializers';

export type ExportFormat = 'csv' | 'json';
export type ShareExportOutcome = 'shared' | 'dismissed';

export async function shareSessionExport(
  repository: MeasurementRepository,
  sessionId: string,
  format: ExportFormat,
): Promise<ShareExportOutcome> {
  const data = await repository.getSessionWithSamples(sessionId);
  if (!data) {
    throw new Error(`session not found: ${sessionId}`);
  }
  const content =
    format === 'csv'
      ? sessionWithSamplesToCsv(data)
      : sessionWithSamplesToJson(data);
  const result = await Share.share({
    title: buildExportFilename(data.session, format),
    message: content,
  });
  return result.action === Share.sharedAction ? 'shared' : 'dismissed';
}
