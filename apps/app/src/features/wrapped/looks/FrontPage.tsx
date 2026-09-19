import type { ReactNode } from 'react'
import { Image, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { fonts, lightPalette, withAlpha } from '@selfmp3/client'
import { Cover } from '../../../ui/components/Cover'
import { frontPageLook, lookInk } from '../looks.model'
import { DayDot, mono, type LookProps } from './parts'

/** `C16`'s sheet, as wide as a computer's page leaves it. */
export const FRONT_SIZE = { width: 960, height: 620 } as const

const PAD_X = 30
const COLUMN_GAP = 28
/** The columns share the width 1.5 : 1 : 1, as `C16` sets them. */
const SHARES = [1.5, 1, 1] as const
const INNER = FRONT_SIZE.width - PAD_X * 2 - COLUMN_GAP * 2
const COLUMN = (share: number) => (INNER * share) / (SHARES[0] + SHARES[1] + SHARES[2])

/**
 * The front page (`C16`): the period as a newspaper, a computer's default look.
 * A masthead, a headline with its deck, the number one as the lead photo, the
 * charts, the days as a grid of dots, and the traits as the forecast.
 *
 * The two heavy bars around the masthead are the paper's own print, drawn in
 * its ink. Nothing else is ruled: the columns are set apart by their gutters,
 * the headings by their type, and the forecast is a box of tone rather than a
 * bordered one (`S2`: no hairlines).
 */
export function FrontPageLook({ input, hue, art }: LookProps): ReactNode {
  const look = frontPageLook(input)
  const ink = lookInk('front', hue)
  const quiet = lightPalette(hue).surface3
  const top = input.wrapped.topSongs[0]
  const photo = look.photo ? art(look.photo.songId) : null
  const gridWidth = COLUMN(SHARES[2])
  const cell = gridWidth / look.grid.columns
  const text = { color: ink.ink }

  return (
    <View style={[styles.sheet, { backgroundColor: ink.ground }]}>
      <View style={styles.strap}>
        {look.strap.map((item, i) => (
          <Text key={i} style={[styles.strapText, { color: ink.second }]}>
            {item}
          </Text>
        ))}
      </View>
      <View>
        <View style={[styles.ruleHeavy, { backgroundColor: ink.ink }]} />
        <Text style={[styles.masthead, text]} accessibilityRole="header">
          {look.masthead}
        </Text>
        <View style={[styles.ruleHeavy, { backgroundColor: ink.ink }]} />
      </View>

      <View style={styles.columns}>
        <View style={[styles.column, { width: COLUMN(SHARES[0]) }]}>
          <Text style={[styles.headline, text]} numberOfLines={3}>
            {look.headline}
          </Text>
          <Text style={[styles.deck, { color: ink.second }]} numberOfLines={4}>
            {look.deck}
          </Text>
          {look.photo && top ? (
            <View style={[styles.photo, { backgroundColor: ink.tone }]}>
              {photo ? (
                <Image source={{ uri: photo }} style={styles.photoImage} resizeMode="cover" />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Cover uri={null} title={top.title} size={COLUMN(SHARES[0])} radius={0} />
                </View>
              )}
              <Text
                style={[styles.caption, text, { backgroundColor: withAlpha(ink.ground, 0.92) }]}
                numberOfLines={2}
              >
                {look.photo.caption}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.column, { width: COLUMN(SHARES[1]) }]}>
          {look.charts.map(chart => (
            <View key={chart.title} style={styles.chart}>
              <SectionHead title={chart.title} ink={ink.ink} />
              {chart.rows.map((row, i) => (
                <View key={i} style={styles.chartRow}>
                  <Text style={[styles.chartName, text]} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={[styles.chartValue, text]}>{row.value}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View style={[styles.column, { width: gridWidth }]}>
          <SectionHead title={look.gridTitle} ink={ink.ink} />
          <View style={styles.grid} accessibilityElementsHidden importantForAccessibility="no">
            {look.grid.cells.map((day, i) => (
              <View key={day?.key ?? `blank-${i}`} style={{ width: cell, height: cell }}>
                {day ? (
                  <DayDot
                    share={day.share}
                    cell={cell}
                    dot={ink.ink}
                    empty={quiet}
                    smallest={4}
                    largest={cell * 0.62}
                    fade={false}
                    cover={null}
                  />
                ) : null}
              </View>
            ))}
          </View>
          <View style={[styles.forecast, { backgroundColor: ink.tone }]}>
            <Text style={[styles.sectionTitle, text]}>Forecast</Text>
            <Text style={[styles.forecastTitle, text]} numberOfLines={3}>
              {look.forecast.title}
            </Text>
            {look.forecast.line ? (
              <Text style={[styles.forecastLine, { color: ink.second }]}>{look.forecast.line}</Text>
            ) : null}
          </View>
          <Text style={[styles.strapText, styles.imprint, { color: ink.second }]}>self.mp3</Text>
        </View>
      </View>
    </View>
  )
}

/** A column's heading: the paper's small capitals, set apart by type rather than a rule. */
function SectionHead({ title, ink }: { title: string; ink: string }): ReactNode {
  return <Text style={[styles.sectionTitle, styles.sectionHead, { color: ink }]}>{title}</Text>
}

const styles = StyleSheet.create({
  sheet: {
    width: FRONT_SIZE.width,
    height: FRONT_SIZE.height,
    paddingTop: 22,
    paddingHorizontal: PAD_X,
    paddingBottom: 20,
    gap: 12,
  },
  strap: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  strapText: { fontFamily: mono, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
  ruleHeavy: { height: 3 },
  masthead: {
    fontFamily: fonts.serif,
    fontSize: 58,
    lineHeight: 62,
    letterSpacing: -1,
    textAlign: 'center',
    paddingTop: 4,
    paddingBottom: 6,
  },
  columns: { flex: 1, minHeight: 0, flexDirection: 'row', gap: COLUMN_GAP },
  column: { gap: 10, minHeight: 0 },
  headline: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 42, letterSpacing: -0.6 },
  deck: { fontSize: 13, lineHeight: 20 },
  photo: { flex: 1, minHeight: 0, overflow: 'hidden', justifyContent: 'flex-end' },
  photoImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  photoPlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: { paddingVertical: 6, paddingHorizontal: 10, fontSize: 11, fontStyle: 'italic' },
  chart: { gap: 2, marginBottom: 6 },
  sectionHead: { fontWeight: '600', marginBottom: 4 },
  sectionTitle: { fontFamily: mono, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
  chartRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  chartName: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 22 },
  chartValue: { fontFamily: mono, fontSize: 12, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  forecast: { gap: 2, paddingVertical: 10, paddingHorizontal: 12, marginTop: 4 },
  forecastTitle: { fontFamily: fonts.serif, fontSize: 26, lineHeight: 28 },
  forecastLine: { fontSize: 12 },
  imprint: { marginTop: 'auto', textAlign: 'right' },
})
