/**
 * Slippy-map math for the OSM heat layer (RF-05, ADR-7).
 *
 * Pure TypeScript, no React: Web Mercator projection between lat/lng and
 * "world pixels" at a zoom level, the tile set covering a viewport, and the
 * zoom that fits a region. The map component only lays out what these
 * functions return, so every coordinate decision is unit-tested.
 */

import type { MapRegion } from './heat';

export const TILE_SIZE = 256;
export const MIN_ZOOM = 3;
/** OSM tile usage policy: street level adds nothing to a coverage map. */
export const MAX_ZOOM = 18;
const MAX_MERCATOR_LAT = 85.05112878;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

export interface WorldPoint {
  x: number;
  y: number;
}

export interface TileRef {
  key: string;
  /** Tile column/row at `z`; x already wrapped into [0, 2^z). */
  x: number;
  y: number;
  z: number;
  /** Top-left corner of the tile in viewport pixels. */
  left: number;
  top: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return MIN_ZOOM;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** Lat/lng → absolute pixel position in the Mercator world at `zoom`. */
export function project(
  latitude: number,
  longitude: number,
  zoom: number,
): WorldPoint {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latitude));
  const size = worldSize(zoom);
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** Inverse of `project`. */
export function unproject(
  point: WorldPoint,
  zoom: number,
): { latitude: number; longitude: number } {
  const size = worldSize(zoom);
  const longitude = (point.x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / size;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { latitude, longitude };
}

/** Ground resolution at a latitude, used to turn meter radii into pixels. */
export function metersPerPixel(latitude: number, zoom: number): number {
  return (
    (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) /
    worldSize(zoom)
  );
}

/** Largest zoom at which the region's span fits inside the viewport. */
export function zoomForRegion(
  region: MapRegion,
  width: number,
  height: number,
): number {
  if (width <= 0 || height <= 0) {
    return MIN_ZOOM;
  }
  const latSpan = Math.max(region.latitudeDelta, 1e-5);
  const lngSpan = Math.max(region.longitudeDelta, 1e-5);
  for (let zoom = MAX_ZOOM; zoom > MIN_ZOOM; zoom--) {
    const a = project(region.latitude + latSpan / 2, region.longitude - lngSpan / 2, zoom);
    const b = project(region.latitude - latSpan / 2, region.longitude + lngSpan / 2, zoom);
    if (Math.abs(b.x - a.x) <= width && Math.abs(b.y - a.y) <= height) {
      return zoom;
    }
  }
  return MIN_ZOOM;
}

/** Tiles covering a `width`×`height` viewport centered on `center`. */
export function visibleTiles(
  center: WorldPoint,
  zoom: number,
  width: number,
  height: number,
): TileRef[] {
  const count = 2 ** zoom;
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;
  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + width) / TILE_SIZE);
  const firstY = Math.max(0, Math.floor(originY / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((originY + height) / TILE_SIZE));
  const tiles: TileRef[] = [];
  for (let ty = firstY; ty <= lastY; ty++) {
    for (let tx = firstX; tx <= lastX; tx++) {
      const wrapped = ((tx % count) + count) % count;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        x: wrapped,
        y: ty,
        z: zoom,
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}

/** OSM standard tile URL for a tile reference. */
export function tileUrl(tile: Pick<TileRef, 'x' | 'y' | 'z'>): string {
  return `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
}
