/**
 * Chart path math for Stage 5 (RF-06, ADR-8).
 *
 * Pure TypeScript: data series in, SVG `d` path strings out. The native
 * side (charts/LineChart) only hands the path to react-native-svg — every
 * scaling decision, degenerate case and null-gap is decided here, under
 * Jest, where it can be asserted exactly.
 *
 * Coordinate frame: origin top-left, y grows downward (SVG convention),
 * so the scale maximum sits at the top padding edge.
 */

export interface ChartFrame {
  width: number;
  height: number;
  /** Inset on all four sides; defaults to CHART_PADDING. */
  padding?: number;
}

export interface ChartScale {
  min: number;
  max: number;
}

export interface PlottedPoint {
  x: number;
  y: number;
}

export const DEFAULT_CHART_WIDTH = 320;
export const DEFAULT_CHART_HEIGHT = 160;
export const CHART_PADDING = 12;

/** Round to 2dp so path strings are stable and snapshot-friendly. */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function paddingOf(frame: ChartFrame): number {
  const padding = frame.padding ?? CHART_PADDING;
  return Number.isFinite(padding) && padding >= 0 ? padding : CHART_PADDING;
}

function plottableValues(values: readonly (number | null)[]): number[] {
  return values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
}

/**
 * Axis scale over the plottable values. Total: empty or all-null input
 * yields a neutral 0..1 scale (the chart renders its empty state anyway);
 * a flat series is expanded symmetrically so it draws as a midline instead
 * of dividing by zero; otherwise the span is padded 10% per side so the
 * line never kisses the frame edge.
 */
export function computeScale(
  values: readonly (number | null)[],
): ChartScale {
  const finite = plottableValues(values);
  if (finite.length === 0) {
    return { min: 0, max: 1 };
  }
  let min = finite[0] ?? 0;
  let max = finite[0] ?? 0;
  for (const value of finite) {
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }
  if (min === max) {
    const step = Math.max(1, Math.abs(min) * 0.1);
    return { min: min - step, max: max + step };
  }
  const pad = (max - min) * 0.1;
  return { min: min - pad, max: max + pad };
}

/** Map a data value to a y pixel; clamps out-of-range values to the frame. */
export function valueToY(
  value: number,
  scale: ChartScale,
  height: number,
  padding?: number,
): number {
  const pad = padding ?? CHART_PADDING;
  const span = scale.max - scale.min || 1;
  const usable = Math.max(0, height - pad * 2);
  const ratio = (scale.max - value) / span;
  return pad + usable * Math.min(1, Math.max(0, ratio));
}

/**
 * Map a series index to an x pixel. A single point centers itself instead
 * of hugging the left edge.
 */
export function indexToX(
  index: number,
  count: number,
  width: number,
  padding?: number,
): number {
  const pad = padding ?? CHART_PADDING;
  const usable = Math.max(0, width - pad * 2);
  if (count <= 1) {
    return pad + usable / 2;
  }
  return pad + (usable * index) / (count - 1);
}

/**
 * Series -> plottable pixels, positionally aligned with the input: nulls
 * (missing samples) stay null so the path can break the line at gaps
 * instead of fabricating a segment across them.
 */
export function toPlottedPoints(
  values: readonly (number | null)[],
  frame: ChartFrame,
  scale?: ChartScale,
): Array<PlottedPoint | null> {
  const resolved = scale ?? computeScale(values);
  const pad = paddingOf(frame);
  return values.map((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    return {
      x: indexToX(index, values.length, frame.width, pad),
      y: valueToY(value, resolved, frame.height, pad),
    };
  });
}

/**
 * Series -> SVG `d` string. Gaps (nulls) start a new `M` subpath so the
 * line visibly breaks at missing samples. Returns '' when nothing is
 * plottable — the chart then renders its empty state, never an empty box.
 * A lone point yields a bare `M x y`; the component draws the dot.
 */
export function buildLinePath(
  values: readonly (number | null)[],
  frame: ChartFrame,
  scale?: ChartScale,
): string {
  const plotted = toPlottedPoints(values, frame, scale);
  const parts: string[] = [];
  let penDown = false;
  for (const point of plotted) {
    if (!point) {
      penDown = false;
      continue;
    }
    parts.push(`${penDown ? 'L' : 'M'} ${fmt(point.x)} ${fmt(point.y)}`);
    penDown = true;
  }
  return parts.join(' ');
}

/** Last plottable pixel, for the end-of-line dot; null when empty. */
export function lastPlottedPoint(
  values: readonly (number | null)[],
  frame: ChartFrame,
  scale?: ChartScale,
): PlottedPoint | null {
  const plotted = toPlottedPoints(values, frame, scale);
  for (let i = plotted.length - 1; i >= 0; i--) {
    const point = plotted[i];
    if (point) {
      return point;
    }
  }
  return null;
}

/**
 * Evenly spaced axis ticks across the scale, rounded to 2dp. `count` is
 * the desired tick total (minimum 2); a flat scale yields a single tick.
 */
export function linearTicks(scale: ChartScale, count = 4): number[] {
  const total = Math.max(2, Math.floor(count));
  if (scale.min === scale.max) {
    return [Math.round(scale.min * 100) / 100];
  }
  const step = (scale.max - scale.min) / (total - 1);
  const ticks: number[] = [];
  for (let i = 0; i < total; i++) {
    ticks.push(Math.round((scale.min + step * i) * 100) / 100);
  }
  return ticks;
}

/**
 * Bucket-average decimation for long walks: each bucket collapses to the
 * mean of its plottable values, or null when the bucket has none (the gap
 * survives decimation instead of being averaged away).
 */
export function downsample(
  values: readonly (number | null)[],
  maxPoints: number,
): Array<number | null> {
  const cap = Math.floor(maxPoints);
  if (!(cap >= 1)) {
    return [];
  }
  if (values.length <= cap) {
    return [...values];
  }
  const bucketSize = values.length / cap;
  const out: Array<number | null> = [];
  for (let i = 0; i < cap; i++) {
    const from = Math.floor(i * bucketSize);
    const to = Math.floor((i + 1) * bucketSize);
    let sum = 0;
    let seen = 0;
    for (let j = from; j < to; j++) {
      const value = values[j];
      if (typeof value === 'number' && Number.isFinite(value)) {
        sum += value;
        seen += 1;
      }
    }
    out.push(seen > 0 ? sum / seen : null);
  }
  return out;
}
