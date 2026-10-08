/**
 * Heat-layer math for Stage 5 (RF-05, ADR-7).
 *
 * Pure TypeScript: no React, no React Native, no native imports — every
 * function below runs under Jest on Windows. The native side
 * (heatLayer/HeatMapView) only turns HeatCells into MapView Circles.
 *
 * Quality model: each point carries up to three raw readings. Per ADR-2 and
 * ADR-6 the persisted schema has no signal column, so latency/throughput is
 * the default metric and dBm is supported for live points once the Stage 2
 * native module delivers it (Android only; iOS never exposes dBm).
 */

import type { SampleRecord } from '../../data/types';

/** Quality dimension a heat layer is keyed on. */
export type QualityMetric = 'latency' | 'throughput' | 'dbm';

export interface HeatPoint {
  latitude: number;
  longitude: number;
  /** Mean RTT in ms; null when the pass produced no answered probe. */
  latencyMs: number | null;
  /** Download throughput in Mbps; null when the transfer failed. */
  throughputMbps: number | null;
  /** Signal strength in dBm; null on persisted rows and on iOS always. */
  dbm: number | null;
}

export interface HeatCell {
  key: string;
  latitude: number;
  longitude: number;
  /** How many points fell into this cell — drives the circle radius. */
  count: number;
  /** Mean raw metric value across member points, in the metric's unit. */
  value: number;
  /** Mean quality score across member points, 0 (worst) to 1 (best). */
  score: number;
  /** Circle radius in meters. */
  radiusMeters: number;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface AggregateOptions {
  /** Grid cell size in degrees (~0.001 deg ≈ 110 m latitude). */
  cellSizeDeg?: number;
  metric?: QualityMetric;
  /** Radius of a lone point, in meters. */
  baseRadiusMeters?: number;
  /** Extra meters per additional point in the cell. */
  radiusPerPointMeters?: number;
  /** Hard cap so a long dwell does not swallow the map. */
  maxRadiusMeters?: number;
}

// Score bounds: at or beyond "good" scores 1, at or beyond "bad" scores 0,
// linearly interpolated between. Bounds are exported so the legend and the
// defense slides can quote the exact numbers behind the colors.
export const LATENCY_GOOD_MS = 50;
export const LATENCY_BAD_MS = 500;
export const THROUGHPUT_GOOD_MBPS = 20;
export const THROUGHPUT_BAD_MBPS = 1;
export const DBM_GOOD = -70;
export const DBM_BAD = -110;

export const DEFAULT_CELL_SIZE_DEG = 0.001;
export const DEFAULT_BASE_RADIUS_METERS = 60;
export const DEFAULT_RADIUS_PER_POINT_METERS = 20;
export const DEFAULT_MAX_RADIUS_METERS = 300;

export const METRIC_LABELS: Record<QualityMetric, string> = {
  latency: 'Latency',
  throughput: 'Throughput',
  dbm: 'Signal',
};

export const METRIC_UNITS: Record<QualityMetric, string> = {
  latency: 'ms',
  throughput: 'Mbps',
  dbm: 'dBm',
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function isPlottableCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Raw metric reading in its own unit; null when the point lacks it. */
export function metricValue(
  point: HeatPoint,
  metric: QualityMetric,
): number | null {
  const raw =
    metric === 'latency'
      ? point.latencyMs
      : metric === 'throughput'
        ? point.throughputMbps
        : point.dbm;
  if (!isPlottableCoord(raw)) {
    return null;
  }
  // Latency and throughput are physical magnitudes; a negative reading is
  // a corrupt sample, not a great one. dBm is legitimately negative.
  if (metric !== 'dbm' && raw < 0) {
    return null;
  }
  return raw;
}

/**
 * Quality score in [0, 1]: 1 is best, 0 is worst. Null when the point has
 * no reading for the metric — absence of data is not bad data.
 */
export function scoreHeatPoint(
  point: HeatPoint,
  metric: QualityMetric,
): number | null {
  const value = metricValue(point, metric);
  if (value === null) {
    return null;
  }
  switch (metric) {
    case 'latency':
      // Lower RTT is better: good bound scores 1, bad bound scores 0.
      return clamp01(
        (LATENCY_BAD_MS - value) / (LATENCY_BAD_MS - LATENCY_GOOD_MS),
      );
    case 'throughput':
      return clamp01(
        (value - THROUGHPUT_BAD_MBPS) /
          (THROUGHPUT_GOOD_MBPS - THROUGHPUT_BAD_MBPS),
      );
    case 'dbm':
      // dBm is negative; closer to zero (louder) is better.
      return clamp01((value - DBM_BAD) / (DBM_GOOD - DBM_BAD));
  }
}

type Rgb = [number, number, number];

// Red (poor) -> amber (fair) -> green (good), matching the StatusScreen
// instrument palette so the map reads as the same product.
const SCORE_RAMP: Array<{ stop: number; color: Rgb }> = [
  { stop: 0, color: [255, 92, 92] },
  { stop: 0.5, color: [255, 178, 36] },
  { stop: 1, color: [65, 230, 164] },
];

/**
 * Deterministic score -> translucent fill/stroke color. Alpha is a
 * parameter (not baked in) because fills and strokes need different
 * opacities over the same hue.
 */
export function qualityColor(score: number, alpha = 0.4): string {
  const t = clamp01(score);
  let lower = SCORE_RAMP[0];
  let upper = SCORE_RAMP[SCORE_RAMP.length - 1];
  for (let i = 1; i < SCORE_RAMP.length; i++) {
    const candidate = SCORE_RAMP[i];
    if (candidate && t <= candidate.stop) {
      const prev = SCORE_RAMP[i - 1];
      if (prev) {
        lower = prev;
      }
      upper = candidate;
      break;
    }
  }
  const span = upper.stop - lower.stop || 1;
  const f = (t - lower.stop) / span;
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * f);
  const r = mix(lower.color[0] ?? 0, upper.color[0] ?? 0);
  const g = mix(lower.color[1] ?? 0, upper.color[1] ?? 0);
  const b = mix(lower.color[2] ?? 0, upper.color[2] ?? 0);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * A persisted sample becomes a heat point. dBm is captured on Android only
 * (ADR-2); iOS rows and pre-migration rows carry null.
 */
export function sampleToHeatPoint(sample: SampleRecord): HeatPoint {
  return {
    latitude: sample.latitude,
    longitude: sample.longitude,
    latencyMs: sample.rttMeanMs,
    throughputMbps: sample.downloadMbps,
    dbm: sample.signalDbm,
  };
}

/**
 * Grid aggregation (ADR-7): points sharing a cell merge into one circle.
 * The circle's color comes from the mean quality score, its radius from
 * the point count — denser dwell reads as a larger disc.
 */
export function aggregateHeatCells(
  points: readonly HeatPoint[],
  options: AggregateOptions = {},
): HeatCell[] {
  const cellSize = options.cellSizeDeg ?? DEFAULT_CELL_SIZE_DEG;
  const metric = options.metric ?? 'latency';
  const baseRadius = options.baseRadiusMeters ?? DEFAULT_BASE_RADIUS_METERS;
  const perPoint = options.radiusPerPointMeters ?? DEFAULT_RADIUS_PER_POINT_METERS;
  const maxRadius = options.maxRadiusMeters ?? DEFAULT_MAX_RADIUS_METERS;
  if (!(cellSize > 0)) {
    return [];
  }

  interface Bucket {
    latSum: number;
    lngSum: number;
    valueSum: number;
    scoreSum: number;
    count: number;
  }
  const buckets = new Map<string, Bucket>();
  for (const point of points) {
    if (!isPlottableCoord(point.latitude) || !isPlottableCoord(point.longitude)) {
      continue;
    }
    const value = metricValue(point, metric);
    const score = scoreHeatPoint(point, metric);
    if (value === null || score === null) {
      continue;
    }
    const key = `${Math.floor(point.latitude / cellSize)}:${Math.floor(
      point.longitude / cellSize,
    )}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.latSum += point.latitude;
      bucket.lngSum += point.longitude;
      bucket.valueSum += value;
      bucket.scoreSum += score;
      bucket.count += 1;
    } else {
      buckets.set(key, {
        latSum: point.latitude,
        lngSum: point.longitude,
        valueSum: value,
        scoreSum: score,
        count: 1,
      });
    }
  }

  const cells: HeatCell[] = [];
  for (const [key, bucket] of buckets) {
    cells.push({
      key: `${metric}:${key}`,
      latitude: bucket.latSum / bucket.count,
      longitude: bucket.lngSum / bucket.count,
      count: bucket.count,
      value: bucket.valueSum / bucket.count,
      score: bucket.scoreSum / bucket.count,
      radiusMeters: Math.min(
        maxRadius,
        baseRadius + (bucket.count - 1) * perPoint,
      ),
    });
  }
  // Stable order: most-sampled cells first, so the worst/best areas render
  // in a deterministic sequence and tests can assert on position zero.
  cells.sort((a, b) => b.count - a.count || b.score - a.score);
  return cells;
}

/**
 * Bounding region around the points for the map's initial region. Null
 * when there is nothing to frame — the screen then falls back to the city
 * default instead of centering on (0, 0), the classic "Null Island" bug.
 */
export function heatBounds(
  points: readonly HeatPoint[],
): MapRegion | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let seen = 0;
  for (const point of points) {
    if (!isPlottableCoord(point.latitude) || !isPlottableCoord(point.longitude)) {
      continue;
    }
    seen += 1;
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  }
  if (seen === 0) {
    return null;
  }
  const MIN_DELTA = 0.01;
  const latDelta = Math.max((maxLat - minLat) * 1.4, MIN_DELTA);
  const lngDelta = Math.max((maxLng - minLng) * 1.4, MIN_DELTA);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in meters; the tap-hit test needs real meters. */
export function haversineMeters(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
): number {
  const R = 6371000;
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(latA)) *
      Math.cos(toRadians(latB)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Tap-for-detail hit test: the nearest cell whose disc contains the tap.
 * Null when the tap lands on empty map — the detail card then clears.
 */
export function findCellAt(
  cells: readonly HeatCell[],
  latitude: number,
  longitude: number,
): HeatCell | null {
  let best: HeatCell | null = null;
  let bestDistance = Infinity;
  for (const cell of cells) {
    const distance = haversineMeters(
      latitude,
      longitude,
      cell.latitude,
      cell.longitude,
    );
    if (distance <= cell.radiusMeters && distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}
