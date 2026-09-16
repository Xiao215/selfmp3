import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View, type GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Svg, { Line, Path } from 'react-native-svg'
import { radius } from '@selfmp3/client'
import {
  formatNumber,
  labelEvery as defaultLabelEvery,
  niceCeiling,
  type ColumnDatum,
} from '../../features/stats/stats.model'

/**
 * Hand-drawn charts: one series, no library.
 *
 *  - One colour and no legend; the heading says what it is.
 *  - Thin marks capped at 24px, a rounded data-end and a square baseline.
 *  - Hairline, solid, recessive gridlines at round numbers.
 *  - Text wears text colours, never the series colour.
 *
 * The column chart measures its plot and draws in real pixels, so a rounded cap
 * stays round and the width cap means something.
 */

const MAX_BAR = 24
const MIN_BAR = 2
const TOP_PAD = 10

/** A bar with a rounded data-end and a square baseline, as a path. */
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height)
  if (height <= r) return `M${x} ${y + height}h${width}v${-height}h${-width}z`
  return `M${x} ${y + height}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${width - r * 2}a${r} ${r} 0 0 1 ${r} ${r}V${y + height}z`
}

/**
 * Columns over time. Pointing at or touching a column dims the rest and shows
 * its value; the whole column is the target, not the sliver of a one-play day.
 */
export function ColumnChart({
  data,
  height = 160,
  emptyMessage = 'No activity yet',
  labelEvery,
  caption,
}: {
  data: readonly ColumnDatum[]
  height?: number
  emptyMessage?: string
  labelEvery?: number
  caption: string
}): ReactNode {
  const { theme } = useUnistyles()
  const [width, setWidth] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)

  if (data.length === 0) return <Text style={styles.empty}>{emptyMessage}</Text>

  const max = Math.max(...data.map(datum => datum.value), 1)
  const niceMax = niceCeiling(max)
  const plotHeight = height - TOP_PAD
  const step = width / data.length
  const barWidth = Math.max(MIN_BAR, Math.min(step * 0.62, MAX_BAR))
  const every = labelEvery ?? defaultLabelEvery(data.length)
  const peak = data.reduce((best, datum) => (datum.value > best.value ? datum : best), data[0]!)

  const pick = (x: number): void => {
    if (step <= 0) return
    setHovered(Math.max(0, Math.min(data.length - 1, Math.floor(x / step))))
  }
  const fromEvent = (event: GestureResponderEvent): void => pick(event.nativeEvent.locationX)
  const shown = hovered === null ? undefined : data[hovered]
  const left = hovered === null || width === 0 ? 0 : ((hovered + 0.5) * step * 100) / width

  return (
    <View>
      <View style={styles.body}>
        <View style={[styles.yAxis, { height }]} aria-hidden>
          <Text style={[styles.axisText, styles.yTop]}>{formatNumber(niceMax)}</Text>
          <Text style={styles.axisText}>{formatNumber(niceMax / 2)}</Text>
          <Text style={[styles.axisText, styles.yBottom]}>0</Text>
        </View>

        <View
          style={[styles.plot, { height }]}
          onLayout={event => setWidth(Math.round(event.nativeEvent.layout.width))}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${caption}. Highest: ${formatNumber(peak.value)}, ${peak.detail ?? peak.label}.`}
          onStartShouldSetResponder={() => true}
          onResponderGrant={fromEvent}
          onResponderMove={fromEvent}
          onResponderRelease={() => setHovered(null)}
          onPointerMove={event => pick(event.nativeEvent.offsetX)}
          onPointerLeave={() => setHovered(null)}
        >
          {width > 0 ? (
            <Svg width={width} height={height} pointerEvents="none">
              {[0, 0.5, 1].map(fraction => (
                <Line
                  key={fraction}
                  x1={0}
                  x2={width}
                  y1={height - fraction * plotHeight}
                  y2={height - fraction * plotHeight}
                  stroke={theme.colors.chartGrid}
                  strokeWidth={1}
                />
              ))}
              {data.map((datum, index) => {
                const barHeight =
                  niceMax > 0
                    ? Math.max(datum.value > 0 ? 2 : 0, (datum.value / niceMax) * plotHeight)
                    : 0
                if (barHeight <= 0) return null
                const x = index * step + (step - barWidth) / 2
                return (
                  <Path
                    key={index}
                    d={barPath(x, height - barHeight, barWidth, barHeight)}
                    fill={theme.colors.chartSeries}
                    opacity={hovered === null || hovered === index ? 1 : 0.4}
                  />
                )
              })}
            </Svg>
          ) : null}

          {shown ? (
            <View
              pointerEvents="none"
              style={[
                styles.tooltip,
                left < 18
                  ? { left: `${left}%` }
                  : left > 82
                    ? { right: `${100 - left}%` }
                    : { left: `${left}%`, transform: [{ translateX: '-50%' }] },
              ]}
            >
              <Text style={styles.tooltipValue}>{formatNumber(shown.value)}</Text>
              <Text style={styles.tooltipDetail}>{shown.detail ?? shown.label}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.xAxis} aria-hidden>
        {data.map((datum, index) =>
          index % every === 0 && datum.label ? (
            <Text
              key={index}
              style={[
                styles.axisText,
                styles.xLabel,
                { left: `${((index + 0.5) / data.length) * 100}%` },
              ]}
              numberOfLines={1}
            >
              {datum.label}
            </Text>
          ) : null,
        )}
      </View>
    </View>
  )
}

/** A single headline number: when the story is one value, a tile beats a plot. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}): ReactNode {
  return (
    <View
      style={styles.tile}
      accessible
      accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}
    >
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  empty: { color: theme.colors.textMuted, fontSize: 13, paddingVertical: 20, textAlign: 'center' },
  body: { flexDirection: 'row', gap: 8 },
  yAxis: { minWidth: 22, justifyContent: 'space-between', alignItems: 'flex-end' },
  yTop: { marginTop: -6 + TOP_PAD },
  yBottom: { marginBottom: -2 },
  axisText: { color: theme.colors.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
  plot: { flex: 1, minWidth: 0 },
  tooltip: {
    position: 'absolute',
    top: 0,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 1,
    backgroundColor: theme.colors.surface3,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.sm,
  },
  tooltipValue: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '700' },
  tooltipDetail: { color: theme.colors.textMuted, fontSize: 11 },
  xAxis: { height: 18, marginTop: 6, marginLeft: 30, position: 'relative' },
  xLabel: { position: 'absolute', transform: [{ translateX: '-50%' }] },
  tile: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  tileLabel: { color: theme.colors.textMuted, fontSize: 12, marginBottom: 6 },
  tileValue: {
    color: theme.colors.textPrimary,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  tileHint: { color: theme.colors.textMuted, fontSize: 11, marginTop: 3 },
}))
