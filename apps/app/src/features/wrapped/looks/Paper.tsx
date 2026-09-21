import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { fonts, lightPalette } from '@selfmp3/client'
import { Cover } from '../../../ui/components/Cover'
import { lookInk, paperLook } from '../looks.model'
import { PrintedTag, type LookProps } from './parts'

/** `P33`'s card, 350 wide on the phone it was drawn for. */
export const PAPER_SIZE = { width: 350, height: 600 } as const

/**
 * Paper (`P33`): the period on a sheet of Paper's cream — the minutes large in
 * the serif, the song on repeat with its cover, three figures, the top tags,
 * and the traits signed off at the foot.
 */
export function PaperLook({ input, hue, art, tagHue }: LookProps): ReactNode {
  const look = paperLook(input)
  const ink = lookInk('paper', hue)
  const paper = lightPalette(hue)
  return (
    <View style={[styles.page, { backgroundColor: ink.ground }]}>
      <View style={styles.head}>
        <Text style={[styles.label, { color: ink.quiet }]} numberOfLines={1}>
          {look.head}
        </Text>
      </View>

      <View style={styles.figureBlock}>
        <Text style={[styles.figure, { color: ink.ink }]} numberOfLines={1}>
          {look.figure}
        </Text>
        <Text style={[styles.figureLine, { color: ink.second }]} numberOfLines={2}>
          {look.figureLine}
        </Text>
      </View>

      {look.onRepeat ? (
        <View style={styles.repeat}>
          <Cover
            uri={art(look.onRepeat.songId)}
            title={look.onRepeat.title}
            size={96}
            radius={14}
          />
          <View style={styles.repeatText}>
            <Text style={[styles.label, { color: ink.quiet }]}>On repeat</Text>
            <Text style={[styles.repeatTitle, { color: ink.ink }]} numberOfLines={2}>
              {look.onRepeat.title}
            </Text>
            <Text style={[styles.repeatLine, { color: ink.second }]} numberOfLines={2}>
              {look.onRepeat.line}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.figures}>
        {look.figures.map(item => (
          <View key={item.label} style={styles.figureCell}>
            <Text style={[styles.smallFigure, { color: ink.ink }]} numberOfLines={1}>
              {item.value}
            </Text>
            <Text style={[styles.smallLabel, { color: ink.second }]}>{item.label}</Text>
          </View>
        ))}
      </View>

      {look.tags.length > 0 ? (
        <View style={styles.tagsBlock}>
          <Text style={[styles.label, { color: ink.quiet }]}>Top tags</Text>
          <View style={styles.tags}>
            {look.tags.map(tag => (
              <PrintedTag
                key={tag}
                name={tag}
                hue={tagHue(tag)}
                scheme="light"
                fill={paper.surface1}
                ink={ink.ink}
                shadow={paper.floatShadow}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Text style={[styles.traits, { color: ink.second }]} numberOfLines={2}>
        {look.traits}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    width: PAPER_SIZE.width,
    height: PAPER_SIZE.height,
    paddingVertical: 26,
    paddingHorizontal: 24,
    gap: 18,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  figureBlock: { gap: 2 },
  // The serif's figures stand taller than their own type: at a line of 90 the
  // top of "23" was cut off by the text's own box.
  figure: { fontFamily: fonts.serif, fontSize: 92, lineHeight: 106, letterSpacing: -3 },
  figureLine: { fontFamily: fonts.serifItalic, fontSize: 26, lineHeight: 30 },
  repeat: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  repeatText: { flex: 1, minWidth: 0, gap: 3 },
  repeatTitle: { fontFamily: fonts.serif, fontSize: 24, lineHeight: 26 },
  repeatLine: { fontSize: 13, lineHeight: 17 },
  figures: { flexDirection: 'row', gap: 10 },
  figureCell: { flex: 1, minWidth: 0, gap: 1 },
  smallFigure: { fontFamily: fonts.serif, fontSize: 28, lineHeight: 33 },
  smallLabel: { fontSize: 11 },
  tagsBlock: { gap: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  traits: { marginTop: 'auto', fontFamily: fonts.serifItalic, fontSize: 18, lineHeight: 22 },
})
