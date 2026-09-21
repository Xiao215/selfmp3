import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { fonts, lightPalette, radius } from '@selfmp3/client'
import { Cover } from '../../../ui/components/Cover'
import { calendarLook, lookInk } from '../looks.model'
import { DayDot, mono, type LookProps } from './parts'

/** `P36`'s page. */
export const CALENDAR_SIZE = { width: 480, height: 720 } as const

const PAD_X = 34
const GAP = 4

/**
 * Calendar (`P36`): the window as a month on the wall — a dot a day in the
 * accent, bigger for a longer day, and the cover of the song that owned the
 * biggest day in that day's square. Longer windows fold into weeks or months
 * (`calendarGrid`), so it stays one page.
 */
export function CalendarLook({ input, hue, art }: LookProps): ReactNode {
  const look = calendarLook(input)
  const ink = lookInk('calendar', hue)
  const quiet = lightPalette(hue).surface3
  const { grid } = look
  const cell = (CALENDAR_SIZE.width - PAD_X * 2 - GAP * (grid.columns - 1)) / grid.columns
  const record = input.wrapped.mostInOneDay
  return (
    <View style={[styles.page, { backgroundColor: ink.ground }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: ink.accent }]} numberOfLines={1}>
          {look.title}
        </Text>
        <Text style={[styles.label, { color: ink.quiet }]}>self.mp3</Text>
      </View>

      <View>
        {grid.headers.length > 0 ? (
          <View style={styles.row}>
            {grid.headers.map((header, i) => (
              <Text key={i} style={[styles.weekday, { width: cell, color: ink.quiet }]}>
                {header}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={[styles.row, styles.grid]}>
          {grid.cells.map((day, i) => (
            <View key={day?.key ?? `blank-${i}`} style={{ width: cell, height: cell }}>
              {day ? (
                <>
                  <DayDot
                    share={day.share}
                    cell={cell}
                    dot={ink.accent}
                    empty={quiet}
                    smallest={8}
                    largest={Math.min(30, cell * 0.55)}
                    fade
                    cover={
                      day.songId !== null && record ? (
                        <Cover
                          uri={art(day.songId)}
                          title={record.title}
                          size={cell}
                          radius={radius.cover}
                        />
                      ) : null
                    }
                  />
                  <Text style={[styles.date, { color: ink.quiet }]}>{day.label}</Text>
                </>
              ) : null}
            </View>
          ))}
        </View>
      </View>

      <Text style={[styles.caption, { color: ink.second }]}>{look.caption}</Text>

      <View style={styles.foot}>
        <View style={styles.footFigure}>
          <Text style={[styles.figure, { color: ink.ink }]} numberOfLines={1}>
            {look.figure}
          </Text>
          <Text style={[styles.figureLine, { color: ink.second }]} numberOfLines={1}>
            {look.figureLine}
          </Text>
        </View>
        <Text style={[styles.traits, { color: ink.second }]}>{look.traits.join('\n')}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    width: CALENDAR_SIZE.width,
    height: CALENDAR_SIZE.height,
    paddingVertical: 36,
    paddingHorizontal: PAD_X,
    gap: 18,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  title: { flexShrink: 1, fontFamily: fonts.serifItalic, fontSize: 54, lineHeight: 62 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  row: { flexDirection: 'row', gap: GAP },
  grid: { flexWrap: 'wrap', rowGap: GAP, marginTop: GAP },
  weekday: {
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
  },
  date: { position: 'absolute', left: 2, top: 0, fontSize: 9, fontFamily: mono },
  caption: { fontSize: 12, lineHeight: 17 },
  foot: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  footFigure: { flexShrink: 1 },
  figure: { fontFamily: fonts.serif, fontSize: 88, lineHeight: 101, letterSpacing: -3 },
  figureLine: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 26 },
  traits: { fontFamily: fonts.serifItalic, fontSize: 18, lineHeight: 22, textAlign: 'right' },
})
