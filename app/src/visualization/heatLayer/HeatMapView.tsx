/**
 * Native heat layer for Stage 5 (RF-05, ADR-7).
 *
 * Not unit-tested: react-native-maps has no Jest harness here. All math
 * (aggregation, colors, tap hit-testing) lives in heat/heat.ts; this file
 * only turns HeatCells into MapView Circles over OSM raster tiles.
 *
 * Map provider note (PLAN section 2): Android renders a grey base layer
 * without a Google API key, so OpenStreetMap tiles are composited on top
 * through UrlTile — no account, no token. The container carries a neutral
 * background so the first paint is not an error grey while tiles load.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, UrlTile } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { findCellAt, qualityColor } from '../heat/heat';
import type { HeatCell, MapRegion } from '../heat/heat';
import { COLORS } from '../theme';

/** OSM standard tile layer; {x}/{y}/{z} are substituted at runtime. */
export const OSM_TILE_URL_TEMPLATE =
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** City fallback so the map never centers on Null Island (0, 0). */
export const DEFAULT_REGION: Region = {
  latitude: -32.484,
  longitude: -58.232,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

interface HeatMapViewProps {
  cells: readonly HeatCell[];
  selectedKey: string | null;
  onSelectCell: (cell: HeatCell | null) => void;
  region: MapRegion | null;
}

export default function HeatMapView({
  cells,
  selectedKey,
  onSelectCell,
  region,
}: HeatMapViewProps) {
  const initialRegion: Region = useMemo(
    () =>
      region
        ? {
            latitude: region.latitude,
            longitude: region.longitude,
            latitudeDelta: region.latitudeDelta,
            longitudeDelta: region.longitudeDelta,
          }
        : DEFAULT_REGION,
    [region],
  );

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={initialRegion}
        accessibilityLabel="Coverage map with quality heat layer"
        onPress={event =>
          onSelectCell(
            findCellAt(
              cells,
              event.nativeEvent.coordinate.latitude,
              event.nativeEvent.coordinate.longitude,
            ),
          )
        }>
        <UrlTile
          urlTemplate={OSM_TILE_URL_TEMPLATE}
          maximumZ={19}
          tileSize={256}
        />
        {cells.map(cell => {
          const selected = cell.key === selectedKey;
          return (
            <Circle
              key={cell.key}
              center={{ latitude: cell.latitude, longitude: cell.longitude }}
              radius={cell.radiusMeters}
              fillColor={qualityColor(cell.score, 0.35)}
              strokeColor={qualityColor(cell.score, 0.9)}
              strokeWidth={selected ? 3 : 1}
              zIndex={1}
            />
          );
        })}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.abyss,
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
