import {
  aggregateHeatCells,
  DBM_BAD,
  DBM_GOOD,
  findCellAt,
  haversineMeters,
  heatBounds,
  LATENCY_BAD_MS,
  LATENCY_GOOD_MS,
  metricValue,
  qualityColor,
  sampleToHeatPoint,
  scoreHeatPoint,
  THROUGHPUT_BAD_MBPS,
  THROUGHPUT_GOOD_MBPS,
} from '../heat/heat';
import type { HeatPoint } from '../heat/heat';
import type { SampleRecord } from '../../data/types';

function point(overrides: Partial<HeatPoint> = {}): HeatPoint {
  return {
    latitude: -32.484,
    longitude: -58.232,
    latencyMs: 80,
    throughputMbps: 12,
    dbm: -85,
    ...overrides,
  };
}

function sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: null,
    sessionId: 's1',
    timestamp: 1000,
    latitude: -32.484,
    longitude: -58.232,
    accuracy: 8,
    networkType: 'lte',
    host: '1.1.1.1',
    port: 443,
    sent: 4,
    answered: 4,
    lossRatio: 0,
    rttMinMs: 70,
    rttMaxMs: 95,
    rttMeanMs: 80,
    rttP50Ms: 80,
    rttP90Ms: 90,
    rttP95Ms: 93,
    rttJitterMs: 5,
    downloadMbps: 12,
    uploadMbps: 5,
    ...overrides,
  };
}

describe('metricValue', () => {
  test('reads each metric in its own unit', () => {
    const p = point();
    expect(metricValue(p, 'latency')).toBe(80);
    expect(metricValue(p, 'throughput')).toBe(12);
    expect(metricValue(p, 'dbm')).toBe(-85);
  });

  test('missing readings are null, never zero', () => {
    const p = point({ latencyMs: null, throughputMbps: null, dbm: null });
    expect(metricValue(p, 'latency')).toBeNull();
    expect(metricValue(p, 'throughput')).toBeNull();
    expect(metricValue(p, 'dbm')).toBeNull();
  });

  test('negative latency/throughput is corrupt data, negative dBm is valid', () => {
    expect(metricValue(point({ latencyMs: -5 }), 'latency')).toBeNull();
    expect(metricValue(point({ throughputMbps: -1 }), 'throughput')).toBeNull();
    expect(metricValue(point({ dbm: -120 }), 'dbm')).toBe(-120);
  });
});

describe('scoreHeatPoint', () => {
  test('latency: good bound scores 1, bad bound scores 0, midpoint 0.5', () => {
    expect(scoreHeatPoint(point({ latencyMs: LATENCY_GOOD_MS }), 'latency')).toBe(1);
    expect(scoreHeatPoint(point({ latencyMs: LATENCY_BAD_MS }), 'latency')).toBe(0);
    expect(
      scoreHeatPoint(
        point({ latencyMs: (LATENCY_GOOD_MS + LATENCY_BAD_MS) / 2 }),
        'latency',
      ),
    ).toBeCloseTo(0.5, 10);
  });

  test('throughput and dBm orient higher-is-better', () => {
    expect(
      scoreHeatPoint(point({ throughputMbps: THROUGHPUT_GOOD_MBPS }), 'throughput'),
    ).toBe(1);
    expect(
      scoreHeatPoint(point({ throughputMbps: THROUGHPUT_BAD_MBPS }), 'throughput'),
    ).toBe(0);
    expect(scoreHeatPoint(point({ dbm: DBM_GOOD }), 'dbm')).toBe(1);
    expect(scoreHeatPoint(point({ dbm: DBM_BAD }), 'dbm')).toBe(0);
    expect(scoreHeatPoint(point({ dbm: (DBM_GOOD + DBM_BAD) / 2 }), 'dbm')).toBeCloseTo(
      0.5,
      10,
    );
  });

  test('out-of-range readings clamp instead of escaping [0, 1]', () => {
    expect(scoreHeatPoint(point({ latencyMs: 5 }), 'latency')).toBe(1);
    expect(scoreHeatPoint(point({ latencyMs: 5000 }), 'latency')).toBe(0);
    expect(scoreHeatPoint(point({ dbm: -40 }), 'dbm')).toBe(1);
  });

  test('a point without the reading scores null', () => {
    expect(scoreHeatPoint(point({ latencyMs: null }), 'latency')).toBeNull();
  });
});

describe('qualityColor', () => {
  test('ramp endpoints match the instrument palette', () => {
    expect(qualityColor(0)).toBe('rgba(255, 92, 92, 0.4)');
    expect(qualityColor(0.5)).toBe('rgba(255, 178, 36, 0.4)');
    expect(qualityColor(1)).toBe('rgba(65, 230, 164, 0.4)');
  });

  test('interpolates within a segment and honours alpha', () => {
    expect(qualityColor(0.25, 0.8)).toBe('rgba(255, 135, 64, 0.8)');
    expect(qualityColor(-3)).toBe(qualityColor(0));
    expect(qualityColor(42)).toBe(qualityColor(1));
  });
});

describe('sampleToHeatPoint', () => {
  test('maps persisted fields; signal stays null (no dBm column)', () => {
    const p = sampleToHeatPoint(sample());
    expect(p.latitude).toBe(-32.484);
    expect(p.latencyMs).toBe(80);
    expect(p.throughputMbps).toBe(12);
    expect(p.dbm).toBeNull();
  });
});

describe('aggregateHeatCells', () => {
  test('empty input yields no cells', () => {
    expect(aggregateHeatCells([])).toEqual([]);
    expect(aggregateHeatCells([], { metric: 'throughput' })).toEqual([]);
  });

  test('points in one cell merge: mean value, mean score, wider radius', () => {
    const cells = aggregateHeatCells(
      [point({ latencyMs: 100 }), point({ latencyMs: 200 })],
      { cellSizeDeg: 0.01, baseRadiusMeters: 60, radiusPerPointMeters: 20 },
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]?.count).toBe(2);
    expect(cells[0]?.value).toBe(150);
    expect(cells[0]?.radiusMeters).toBe(80);
    expect(cells[0]?.key.startsWith('latency:')).toBe(true);
  });

  test('distant points form separate cells and the radius caps', () => {
    const cluster = Array.from({ length: 20 }, () => point({ latencyMs: 400 }));
    const cells = aggregateHeatCells(
      [...cluster, point({ latitude: -32.0, latencyMs: 60 })],
      { cellSizeDeg: 0.01, maxRadiusMeters: 300 },
    );
    expect(cells).toHaveLength(2);
    // The 20-point cluster sorts first (most-sampled) and hits the cap.
    expect(cells[0]?.count).toBe(20);
    expect(cells[0]?.radiusMeters).toBe(300);
    expect(cells[1]?.score).toBeGreaterThan(cells[0]?.score ?? 1);
  });

  test('points missing the metric and bad coordinates are skipped', () => {
    const cells = aggregateHeatCells([
      point({ latencyMs: null }),
      point({ latitude: NaN }),
      point({ latencyMs: 90 }),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.value).toBe(90);
  });

  test('non-positive cell size yields no cells instead of dividing by zero', () => {
    expect(aggregateHeatCells([point()], { cellSizeDeg: 0 })).toEqual([]);
  });
});

describe('heatBounds', () => {
  test('null when there is nothing to frame (never Null Island)', () => {
    expect(heatBounds([])).toBeNull();
    expect(heatBounds([point({ latitude: NaN })])).toBeNull();
  });

  test('centers on the points with a minimum span for single fixes', () => {
    const region = heatBounds([point()]);
    expect(region?.latitude).toBeCloseTo(-32.484, 10);
    expect(region?.longitude).toBeCloseTo(-58.232, 10);
    expect(region?.latitudeDelta).toBeGreaterThan(0);
  });

  test('spans the walk with padding', () => {
    const region = heatBounds([
      point({ latitude: -32.48, longitude: -58.23 }),
      point({ latitude: -32.49, longitude: -58.24 }),
    ]);
    expect(region?.latitude).toBeCloseTo(-32.485, 10);
    expect(region?.latitudeDelta).toBeCloseTo(0.014, 10);
  });
});

describe('haversineMeters and findCellAt', () => {
  test('zero distance for identical coordinates', () => {
    expect(haversineMeters(-32.484, -58.232, -32.484, -58.232)).toBe(0);
  });

  test('0.001 degrees of latitude is about 111 meters', () => {
    const d = haversineMeters(-32.484, -58.232, -32.483, -58.232);
    expect(Math.abs(d - 111.19)).toBeLessThan(1);
  });

  test('tap inside a disc selects it, tap on empty map clears', () => {
    const cells = aggregateHeatCells([point(), point()], { cellSizeDeg: 0.01 });
    expect(cells).toHaveLength(1);
    const cell = cells[0];
    expect(cell).toBeDefined();
    if (!cell) {
      return;
    }
    expect(findCellAt(cells, cell.latitude, cell.longitude)).toBe(cell);
    expect(findCellAt(cells, 0, 0)).toBeNull();
  });
});
