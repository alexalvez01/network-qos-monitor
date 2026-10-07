/**
 * Degradation detection for Stage 6 (RF-07).
 *
 * Pure TypeScript: no React, no React Native, no native imports — safe to
 * run under Jest. Thresholds apply to the worst-case host aggregate of one
 * measurement pass (a single bad host is enough to page the user). The
 * headless background task turns a non-null reason into a local
 * notification through the notifee wrapper; an empty pass (no hosts at
 * all) is "nothing measured", not degradation, and yields null.
 */

import type { MeasurementSet } from '../measurement/types';

export interface DegradationThresholds {
  /** Worst host mean RTT above this (ms) counts as degraded. */
  rttMeanMs: number;
  /** Worst host jitter above this (ms) counts as degraded. */
  jitterMs: number;
  /** Worst host loss ratio above this, as a fraction in [0, 1]. */
  lossRatio: number;
}

/**
 * Totally-unanswered probes already surface as lossRatio 1, so an outage
 * notifies through the loss threshold without a special case.
 */
export const DEFAULT_DEGRADATION_THRESHOLDS: DegradationThresholds = {
  rttMeanMs: 300,
  jitterMs: 100,
  lossRatio: 0.1,
};

function formatLoss(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Worst-case reason over one pass, or null when every host is within
 * thresholds. Multiple breaches join with '; ' so the notification body
 * names each one: `Network degradation: 1.1.1.1 mean RTT 452ms > 300ms`.
 */
export function detectDegradation(
  set: MeasurementSet,
  thresholds: DegradationThresholds = DEFAULT_DEGRADATION_THRESHOLDS,
): string | null {
  const parts: string[] = [];
  for (const host of set.hosts) {
    const mean = host.rtt.meanMs;
    if (mean !== null && mean > thresholds.rttMeanMs) {
      parts.push(
        `${host.host} mean RTT ${Math.round(mean)}ms above ${thresholds.rttMeanMs}ms`,
      );
    }
    const jitter = host.rtt.jitterMs;
    if (jitter !== null && jitter > thresholds.jitterMs) {
      parts.push(
        `${host.host} jitter ${Math.round(jitter)}ms above ${thresholds.jitterMs}ms`,
      );
    }
    const loss = host.lossRatio;
    if (loss !== null && loss > thresholds.lossRatio) {
      parts.push(
        `${host.host} loss ${formatLoss(loss)} above ${formatLoss(thresholds.lossRatio)}`,
      );
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return `Network degradation: ${parts.join('; ')}`;
}
