/**
 * SVG line chart for Stage 5 (RF-06, ADR-8).
 *
 * Not unit-tested: react-native-svg has no Jest harness here. All path
 * math (scales, gaps, degenerate series) lives in charts/series.ts; this
 * file only renders the resulting path, grid ticks and the end dot.
 *
 * Never color-alone: the header names the latest value in text and the
 * grid carries numeric tick labels, so the line hue is redundant encoding.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, {
  Circle as SvgCircle,
  Line,
  Path,
  Text as SvgText,
} from 'react-native-svg';
import {
  buildLinePath,
  computeScale,
  downsample,
  lastPlottedPoint,
  linearTicks,
  valueToY,
} from './series';
import { COLORS } from '../theme';

interface LineChartProps {
  title: string;
  /** Latest-value readout rendered next to the title, e.g. "82 ms". */
  latestLabel: string;
  values: ReadonlyArray<number | null>;
  color: string;
  emptyMessage: string;
  height?: number;
}

const MAX_PLOTTED_POINTS = 120;
const SIDE_INSET = 32;

export default function LineChart({
  title,
  latestLabel,
  values,
  color,
  emptyMessage,
  height = 160,
}: LineChartProps) {
  const { width: windowWidth } = useWindowDimensions();
  const frame = useMemo(
    () => ({
      width: Math.max(200, windowWidth - SIDE_INSET * 2),
      height,
      padding: 22,
    }),
    [windowWidth, height],
  );

  const sampled = useMemo(
    () => downsample(values, MAX_PLOTTED_POINTS),
    [values],
  );
  const scale = useMemo(() => computeScale(sampled), [sampled]);
  const path = useMemo(
    () => buildLinePath(sampled, frame, scale),
    [sampled, frame, scale],
  );
  const ticks = useMemo(() => linearTicks(scale, 3), [scale]);
  const last = useMemo(
    () => lastPlottedPoint(sampled, frame, scale),
    [sampled, frame, scale],
  );

  if (path === '') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.empty}>{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.latest}>{latestLabel}</Text>
      </View>
      <Svg
        width={frame.width}
        height={frame.height}
        accessibilityRole="image"
        accessibilityLabel={`${title} chart, latest value ${latestLabel}`}>
        {ticks.map(tick => {
          const y = valueToY(tick, scale, frame.height, frame.padding);
          return (
            <React.Fragment key={tick}>
              <Line
                x1={frame.padding}
                y1={y}
                x2={frame.width - frame.padding}
                y2={y}
                stroke={COLORS.panelEdge}
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <SvgText
                x={frame.padding}
                y={y - 4}
                fontSize={9}
                fill={COLORS.muted}>
                {String(tick)}
              </SvgText>
            </React.Fragment>
          );
        })}
        <Path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {last ? (
          <SvgCircle
            cx={last.x}
            cy={last.y}
            r={4}
            fill={color}
            stroke={COLORS.abyss}
            strokeWidth={1.5}
          />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.panelEdge,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  header: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  latest: {
    color: COLORS.muted,
    fontFamily: 'monospace',
    fontSize: 13,
  },
  empty: {
    color: COLORS.muted,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: 4,
  },
});
