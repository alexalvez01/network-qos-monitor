import {
  buildLinePath,
  computeScale,
  downsample,
  indexToX,
  lastPlottedPoint,
  linearTicks,
  toPlottedPoints,
  valueToY,
} from '../charts/series';

const FRAME = { width: 100, height: 100, padding: 10 };

describe('computeScale', () => {
  test('empty and all-null series fall back to a neutral 0..1 scale', () => {
    expect(computeScale([])).toEqual({ min: 0, max: 1 });
    expect(computeScale([null, null])).toEqual({ min: 0, max: 1 });
  });

  test('flat series expand symmetrically instead of dividing by zero', () => {
    // Flat step is max(1, 10% of |value|): 50 -> ±5, 0 -> ±1.
    expect(computeScale([50, 50, 50])).toEqual({ min: 45, max: 55 });
    expect(computeScale([0])).toEqual({ min: -1, max: 1 });
  });

  test('normal span is padded 10% per side', () => {
    // Span 20 -> pad 2 -> 8..32.
    expect(computeScale([10, 20, 30])).toEqual({ min: 8, max: 32 });
  });

  test('a huge outlier is absorbed, not rejected', () => {
    const scale = computeScale([40, 42, 41, 5000]);
    expect(scale.min).toBeLessThan(40);
    expect(scale.max).toBeGreaterThan(5000);
    expect(Number.isFinite(scale.min) && Number.isFinite(scale.max)).toBe(true);
  });
});

describe('valueToY and indexToX', () => {
  test('scale maximum sits at the top padding edge', () => {
    expect(valueToY(100, { min: 0, max: 100 }, 100, 10)).toBe(10);
    expect(valueToY(0, { min: 0, max: 100 }, 100, 10)).toBe(90);
    expect(valueToY(50, { min: 0, max: 100 }, 100, 10)).toBe(50);
  });

  test('out-of-range values clamp to the frame', () => {
    expect(valueToY(1000, { min: 0, max: 100 }, 100, 10)).toBe(10);
    expect(valueToY(-1000, { min: 0, max: 100 }, 100, 10)).toBe(90);
  });

  test('a lone index centers instead of hugging the edge', () => {
    expect(indexToX(0, 1, 100, 10)).toBe(50);
    expect(indexToX(0, 3, 100, 10)).toBe(10);
    expect(indexToX(1, 3, 100, 10)).toBe(50);
    expect(indexToX(2, 3, 100, 10)).toBe(90);
  });
});

describe('buildLinePath', () => {
  test('empty and all-null series produce no path', () => {
    expect(buildLinePath([], FRAME)).toBe('');
    expect(buildLinePath([null, null], FRAME)).toBe('');
  });

  test('two points produce one move plus one line', () => {
    expect(buildLinePath([0, 100], FRAME, { min: 0, max: 100 })).toBe(
      'M 10 90 L 90 10',
    );
  });

  test('gaps break the line instead of bridging missing samples', () => {
    expect(buildLinePath([0, null, 100], FRAME, { min: 0, max: 100 })).toBe(
      'M 10 90 M 90 10',
    );
  });

  test('a lone point is a bare move; the component draws the dot', () => {
    expect(buildLinePath([50], FRAME, { min: 0, max: 100 })).toBe('M 50 50');
  });

  test('default scale keeps the path finite for adversarial input', () => {
    const path = buildLinePath([40, 42, 5000, 41], FRAME);
    expect(path.startsWith('M')).toBe(true);
    expect(path).not.toMatch(/NaN|Infinity/);
  });
});

describe('toPlottedPoints and lastPlottedPoint', () => {
  test('nulls stay null positionally', () => {
    const plotted = toPlottedPoints([10, null, 30], FRAME, { min: 0, max: 40 });
    expect(plotted).toHaveLength(3);
    expect(plotted[1]).toBeNull();
    expect(plotted[0]).not.toBeNull();
  });

  test('last plotted point skips trailing gaps', () => {
    const last = lastPlottedPoint([10, 20, null], FRAME, { min: 0, max: 20 });
    expect(last).not.toBeNull();
    expect(lastPlottedPoint([null], FRAME)).toBeNull();
  });
});

describe('linearTicks', () => {
  test('evenly spaced and rounded', () => {
    expect(linearTicks({ min: 0, max: 100 }, 4)).toEqual([0, 33.33, 66.67, 100]);
  });

  test('flat scale yields a single tick', () => {
    expect(linearTicks({ min: 42, max: 42 })).toEqual([42]);
  });
});

describe('downsample', () => {
  test('short series pass through untouched', () => {
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  test('buckets average their plottable values', () => {
    expect(downsample([1, 2, 3, 4], 2)).toEqual([1.5, 3.5]);
  });

  test('all-null buckets stay null so gaps survive decimation', () => {
    expect(downsample([1, null, 3, 4], 2)).toEqual([1, 3.5]);
    expect(downsample([null, null, 1, 2], 2)).toEqual([null, 1.5]);
  });

  test('degenerate caps yield no points instead of throwing', () => {
    expect(downsample([1, 2, 3], 0)).toEqual([]);
  });
});
