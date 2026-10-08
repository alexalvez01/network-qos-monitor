import {
  clampZoom,
  MAX_ZOOM,
  metersPerPixel,
  MIN_ZOOM,
  project,
  TILE_SIZE,
  tileUrl,
  unproject,
  visibleTiles,
  zoomForRegion,
} from '../heat/tiles';

test('project maps the origin to the world center', () => {
  const point = project(0, 0, 1);
  expect(point.x).toBeCloseTo(TILE_SIZE);
  expect(point.y).toBeCloseTo(TILE_SIZE);
});

test('unproject inverts project', () => {
  const point = project(-32.484, -58.232, 15);
  const back = unproject(point, 15);
  expect(back.latitude).toBeCloseTo(-32.484, 6);
  expect(back.longitude).toBeCloseTo(-58.232, 6);
});

test('project clamps polar latitudes instead of returning Infinity', () => {
  expect(Number.isFinite(project(90, 0, 3).y)).toBe(true);
  expect(Number.isFinite(project(-90, 0, 3).y)).toBe(true);
});

test('clampZoom rounds and bounds the zoom level', () => {
  expect(clampZoom(30)).toBe(MAX_ZOOM);
  expect(clampZoom(0)).toBe(MIN_ZOOM);
  expect(clampZoom(12.6)).toBe(13);
  expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
});

test('metersPerPixel halves with each zoom step', () => {
  const a = metersPerPixel(0, 10);
  const b = metersPerPixel(0, 11);
  expect(a / b).toBeCloseTo(2);
  expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
});

test('zoomForRegion fits a small walk at street level and a country far out', () => {
  const walk = zoomForRegion(
    { latitude: -32.48, longitude: -58.23, latitudeDelta: 0.005, longitudeDelta: 0.005 },
    400,
    600,
  );
  const country = zoomForRegion(
    { latitude: -34, longitude: -64, latitudeDelta: 30, longitudeDelta: 20 },
    400,
    600,
  );
  expect(walk).toBeGreaterThanOrEqual(15);
  expect(country).toBeLessThanOrEqual(5);
  expect(zoomForRegion({ latitude: 0, longitude: 0, latitudeDelta: 1, longitudeDelta: 1 }, 0, 0)).toBe(MIN_ZOOM);
});

test('visibleTiles covers the viewport and positions tiles relative to it', () => {
  const center = project(-32.484, -58.232, 14);
  const tiles = visibleTiles(center, 14, 512, 512);
  expect(tiles.length).toBeGreaterThanOrEqual(4);
  expect(tiles.length).toBeLessThanOrEqual(9);
  for (const tile of tiles) {
    expect(tile.left).toBeGreaterThan(-TILE_SIZE);
    expect(tile.left).toBeLessThan(512);
    expect(tile.top).toBeGreaterThan(-TILE_SIZE);
    expect(tile.top).toBeLessThan(512);
  }
  expect(new Set(tiles.map(tile => tile.key)).size).toBe(tiles.length);
});

test('visibleTiles wraps x across the antimeridian and never emits rows off the world', () => {
  const tiles = visibleTiles({ x: 0, y: 0 }, 3, 512, 512);
  for (const tile of tiles) {
    expect(tile.x).toBeGreaterThanOrEqual(0);
    expect(tile.x).toBeLessThan(8);
    expect(tile.y).toBeGreaterThanOrEqual(0);
  }
});

test('tileUrl targets the OSM standard layer', () => {
  expect(tileUrl({ x: 1, y: 2, z: 3 })).toBe(
    'https://tile.openstreetmap.org/3/1/2.png',
  );
});
