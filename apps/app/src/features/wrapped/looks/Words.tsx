import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { darkPalette, fonts, withAlpha } from '@selfmp3/client'
import { Cover } from '../../../ui/components/Cover'
import { lookInk, wordsLook } from '../looks.model'
import { PrintedTag, type LookProps } from './parts'

/** `P37`'s page. */
export const WORDS_SIZE = { width: 480, height: 720 } as const

/**
 * Words (`P37`): the period said in one sentence on the accent's deep tile,
 * the numbers in it set in the italic and the accent's light ink, and the
 * number one's cover tilted in the corner like a photo tucked into a letter.
 */
export function WordsLook({ input, hue, art, tagHue }: LookProps): ReactNode {
  const look = wordsLook(input)
  const ink = lookInk('words', hue)
  const top = input.wrapped.topSongs[0]
  return (
    <View style={[styles.page, { backgroundColor: ink.ground }]}>
      <Text style={[styles.head, { color: ink.accent }]}>{look.head}</Text>
      <Text
        style={[
          styles.sentence,
          { color: ink.ink, fontSize: look.size, lineHeight: Math.round(look.size * 1.04) },
        ]}
      >
        {look.segments.map((segment, i) =>
          segment.em ? (
            <Text key={i} style={[styles.em, { color: ink.accent }]}>
              {segment.text}
            </Text>
          ) : (
            segment.text
          ),
        )}
      </Text>

      <View style={styles.foot}>
        <View style={styles.facts}>
          <Text style={[styles.factLine, { color: ink.second }]}>{look.foot}</Text>
          {look.tags.length > 0 ? (
            <View style={styles.tags}>
              {look.tags.map(tag => (
                <PrintedTag
                  key={tag}
                  name={tag}
                  hue={tagHue(tag)}
                  scheme="dark"
                  fill={withAlpha(ink.ink, 0.14)}
                  ink={ink.ink}
                  size={12}
                />
              ))}
            </View>
          ) : null}
        </View>
        {look.songId !== null && top ? (
          <View
            style={[styles.photo, { boxShadow: `0 16px 34px ${darkPalette(hue).floatShadow}` }]}
          >
            <Cover uri={art(look.songId)} title={top.title} size={112} radius={16} />
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    width: WORDS_SIZE.width,
    height: WORDS_SIZE.height,
    paddingVertical: 40,
    paddingHorizontal: 36,
    gap: 22,
    overflow: 'hidden',
  },
  head: { fontSize: 11, fontWeight: '600', letterSpacing: 1.6, textTransform: 'uppercase' },
  sentence: { fontFamily: fonts.serif, letterSpacing: -1 },
  em: { fontFamily: fonts.serifItalic },
  foot: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
  },
  facts: { flexShrink: 1, gap: 4 },
  factLine: { fontSize: 14 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
  // Tilted, and lifted off the page: the one shadow here is a photo's.
  photo: {
    transform: [{ rotate: '6deg' }],
    borderRadius: 16,
  },
})
