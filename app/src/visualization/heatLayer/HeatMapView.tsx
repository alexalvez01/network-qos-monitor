/**
 * Native heat layer for Stage 5 (RF-05, ADR-7).
 *
 * A self-contained slippy map: OpenStreetMap raster tiles laid out as
 * plain Images, with the pre-aggregated HeatCells drawn on top through
 * react-native-svg. It replaces react-native-maps, whose Google provider
 * aborts the process without an API key and, with a placeholder key,
 * draws nothing at all — not even UrlTile overlays. This renderer needs
 * no account or token and behaves the same on Android and iOS.
 *
 * Not unit-tested: all coordinate math (projection, tile set, zoom fit,
 * hit-testing) lives in heat/tiles.ts and heat/heat.ts and is tested there.
 * Interaction: drag to pan, tap a circle to select it, +/- to zoom,
 * the target button re-fits the recorded data.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { findCellAt, qualityColor } from '../heat/heat';
import type { HeatCell, MapRegion } from '../heat/heat';
import {
  clampZoom,
  metersPerPixel,
  project,
  tileUrl,
  unproject,
  visibleTiles,
  zoomForRegion,
} from '../heat/tiles';
import type { WorldPoint } from '../heat/tiles';
import { COLORS } from '../theme';

/** City fallback so the map never centers on Null Island (0, 0). */
export const DEFAULT_REGION: MapRegion = {
  latitude: -32.484,
  longitude: -58.232,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

/**
 * OSM tile policy asks clients to identify themselves; Image sources on
 * Android forward these headers to the tile server.
 */
const TILE_HEADERS = {
  'User-Agent': 'NetworkQoSMonitor/1.0 (FCyT university project)',
};

/** Movement below this many pixels counts as a tap, not a drag. */
const TAP_SLOP_PX = 8;
const MIN_CIRCLE_PX = 7;

interface HeatMapViewProps {
  cells: readonly HeatCell[];
  selectedKey: string | null;
  onSelectCell: (cell: HeatCell | null) => void;
  region: MapRegion | null;
}

interface Camera {
  zoom: number;
  center: WorldPoint;
}

function fitCamera(region: MapRegion, width: number, height: number): Camera {
  // Leave a margin so edge circles are not clipped.
  const zoom = clampZoom(zoomForRegion(region, width * 0.8, height * 0.8));
  return { zoom, center: project(region.latitude, region.longitude, zoom) };
}

export default function HeatMapView({
  cells,
  selectedKey,
  onSelectCell,
  region,
}: HeatMapViewProps) {
  const target = region ?? DEFAULT_REGION;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });

  // Refit whenever the data extent (or the viewport) changes.
  const regionKey = `${target.latitude}|${target.longitude}|${target.latitudeDelta}|${target.longitudeDelta}`;
  useEffect(() => {
    if (size.width > 0 && size.height > 0) {
      setCamera(fitCamera(target, size.width, size.height));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey, size.width, size.height]);

  // PanResponder is created once; it reads the live values through refs.
  const live = useRef({ camera, size, cells, onSelectCell });
  live.current = { camera, size, cells, onSelectCell };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_event, gesture) => {
          setDrag({ dx: gesture.dx, dy: gesture.dy });
        },
        onPanResponderRelease: (event, gesture) => {
          const current = live.current;
          setDrag({ dx: 0, dy: 0 });
          if (!current.camera) {
            return;
          }
          const { zoom, center } = current.camera;
          if (
            Math.abs(gesture.dx) < TAP_SLOP_PX &&
            Math.abs(gesture.dy) < TAP_SLOP_PX
          ) {
            const { locationX, locationY } = event.nativeEvent;
            const hit = unproject(
              {
                x: center.x + locationX - current.size.width / 2,
                y: center.y + locationY - current.size.height / 2,
              },
              zoom,
            );
            current.onSelectCell(
              findCellAt(current.cells, hit.latitude, hit.longitude) ??
                nearestByPixels(current.cells, hit, zoom),
            );
            return;
          }
          setCamera({
            zoom,
            center: { x: center.x - gesture.dx, y: center.y - gesture.dy },
          });
        },
        onPanResponderTerminate: () => setDrag({ dx: 0, dy: 0 }),
      }),
    [],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  const zoomBy = (delta: number) => {
    setCamera(previous => {
      if (!previous) {
        return previous;
      }
      const zoom = clampZoom(previous.zoom + delta);
      const factor = 2 ** (zoom - previous.zoom);
      return {
        zoom,
        center: { x: previous.center.x * factor, y: previous.center.y * factor },
      };
    });
  };

  const center: WorldPoint | null = camera
    ? { x: camera.center.x - drag.dx, y: camera.center.y - drag.dy }
    : null;

  const tiles =
    camera && center
      ? visibleTiles(center, camera.zoom, size.width, size.height)
      : [];

  const circles =
    camera && center
      ? cells.map(cell => {
          const point = project(cell.latitude, cell.longitude, camera.zoom);
          const radius = Math.max(
            MIN_CIRCLE_PX,
            cell.radiusMeters / metersPerPixel(cell.latitude, camera.zoom),
          );
          return {
            cell,
            cx: point.x - center.x + size.width / 2,
            cy: point.y - center.y + size.height / 2,
            radius,
          };
        })
      : [];

  return (
    <View
      style={styles.container}
      onLayout={onLayout}
      accessibilityLabel="Coverage map with quality heat layer">
      <View style={StyleSheet.absoluteFill} {...responder.panHandlers}>
        {tiles.map(tile => (
          <Image
            key={tile.key}
            source={{ uri: tileUrl(tile), headers: TILE_HEADERS }}
            style={[styles.tile, { left: tile.left, top: tile.top }]}
            fadeDuration={0}
          />
        ))}
        <Svg
          style={StyleSheet.absoluteFill}
          width={size.width}
          height={size.height}
          pointerEvents="none">
          {circles.map(({ cell, cx, cy, radius }) => {
            const selected = cell.key === selectedKey;
            return (
              <Circle
                key={cell.key}
                cx={cx}
                cy={cy}
                r={radius}
                fill={qualityColor(cell.score, 0.45)}
                stroke={selected ? COLORS.ink : qualityColor(cell.score, 0.95)}
                strokeWidth={selected ? 3 : 1.5}
              />
            );
          })}
        </Svg>
      </View>

      <View style={styles.controls}>
        <MapButton label="+" onPress={() => zoomBy(1)} a11y="Zoom in" />
        <MapButton label="−" onPress={() => zoomBy(-1)} a11y="Zoom out" />
        <MapButton
          label="◎"
          onPress={() =>
            size.width > 0 && setCamera(fitCamera(target, size.width, size.height))
          }
          a11y="Fit recorded data"
        />
      </View>
      <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
    </View>
  );
}

/** Fallback hit-test in screen space, for circles inflated to MIN_CIRCLE_PX. */
function nearestByPixels(
  cells: readonly HeatCell[],
  hit: { latitude: number; longitude: number },
  zoom: number,
): HeatCell | null {
  const tap = project(hit.latitude, hit.longitude, zoom);
  let best: HeatCell | null = null;
  let bestDistance = Infinity;
  for (const cell of cells) {
    const point = project(cell.latitude, cell.longitude, zoom);
    const distance = Math.hypot(point.x - tap.x, point.y - tap.y);
    const radius = Math.max(
      MIN_CIRCLE_PX,
      cell.radiusMeters / metersPerPixel(cell.latitude, zoom),
    );
    if (distance <= radius + 4 && distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}

function MapButton({
  label,
  onPress,
  a11y,
}: {
  label: string;
  onPress: () => void;
  a11y: string;
}) {
  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#DDE3E8',
    flex: 1,
    overflow: 'hidden',
  },
  tile: {
    height: 256,
    position: 'absolute',
    width: 256,
  },
  controls: {
    gap: 8,
    position: 'absolute',
    right: 10,
    top: 10,
  },
  button: {
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  buttonText: {
    color: COLORS.ink,
    fontSize: 22,
    fontWeight: '700',
  },
  attribution: {
    backgroundColor: 'rgba(255,255,255,0.75)',
    bottom: 0,
    color: '#333',
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
    right: 0,
  },
});
