import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { activeLineIndex, type ParsedLyrics } from '@selfmp3/shared'
import { colors, radius } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { hexAlpha, LYRIC_ANCHOR, LYRIC_LEAD, MANUAL_SCROLL_MS } from './nowPlaying.model'

/**
 * The lyrics on a computer's Now Playing page: the web's `LyricsView`.
 *
 * The line being sung stays at the same height on screen and the list moves
 * under it. Lines are measured as they lay out, because a romanized line
 * under each one makes their heights differ. Click a line to jump to it.
 * Scrolling by hand holds off the centring for a few seconds, so reading
 * ahead is not fought.
 *
 * In Focus the type is larger and lines further from the sung one blur a
 * little.
 */
export function StageLyrics({
  parsed,
  roman,
  focus,
  fontSize,
}: {
  parsed: ParsedLyrics
  roman: readonly string[] | null
  focus: boolean
  fontSize: number
}): ReactNode {
  const player = usePlayer()
  const scrollRef = useRef<ScrollView>(null)
  const [boxHeight, setBoxHeight] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [layoutTick, setLayoutTick] = useState(0)
  const tops = useRef<number[]>([])
  const heights = useRef<number[]>([])
  const layoutPending = useRef(false)
  const lastManual = useRef(0)
  const autoUntil = useRef(0)

  const synced = parsed.synced ? parsed.lines : null
  const active = synced ? activeLineIndex(synced, player.position, LYRIC_LEAD) : -1
  const lines = parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines

  useEffect(() => {
    if (!synced || boxHeight === 0) return
    if (Date.now() - lastManual.current < MANUAL_SCROLL_MS) return
    const index = Math.max(0, active)
    const top = tops.current[index]
    const height = heights.current[index]
    if (top === undefined || height === undefined) return
    autoUntil.current = Date.now() + 700
    scrollRef.current?.scrollTo({
      y: Math.max(0, top + height / 2 - boxHeight * LYRIC_ANCHOR),
      animated: true,
    })
  }, [active, boxHeight, layoutTick, synced])

  /* Lines report their layout one by one; re-centre once they have all settled. */
  const measured = (index: number, top: number, height: number): void => {
    tops.current[index] = top
    heights.current[index] = height
    if (layoutPending.current) return
    layoutPending.current = true
    setTimeout(() => {
      layoutPending.current = false
      setLayoutTick(tick => tick + 1)
    }, 60)
  }

  return (
    <View style={styles.box}>
      <ScrollView
        ref={scrollRef}
        style={styles.box}
        contentContainerStyle={{
          paddingTop: boxHeight * (synced ? LYRIC_ANCHOR : 0.14),
          paddingBottom: boxHeight * 0.55,
          paddingHorizontal: 6,
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={64}
        onLayout={event => setBoxHeight(event.nativeEvent.layout.height)}
        onScroll={() => {
          if (Date.now() > autoUntil.current) lastManual.current = Date.now()
        }}
      >
        {lines.map((text, index) => {
          const time = synced?.[index]?.time
          const sub = roman?.[index]
          const color = !synced
            ? colors.textSecondary
            : index === active
              ? colors.textPrimary
              : hovered === index
                ? hexAlpha(colors.textPrimary, 0.72)
                : index < active
                  ? hexAlpha(colors.textPrimary, 0.25)
                  : hexAlpha(colors.textPrimary, 0.4)
          const distance = Math.min(3, Math.abs(index - active))
          const content = (
            <>
              <Text
                style={[
                  styles.words,
                  {
                    color,
                    fontSize,
                    lineHeight: fontSize * 1.25,
                    letterSpacing: text ? -0.01 * fontSize : 0.4 * fontSize,
                  },
                ]}
              >
                {text || '♪'}
              </Text>
              {sub ? (
                <Text
                  style={[
                    styles.roman,
                    {
                      color,
                      fontSize: fontSize * 0.7,
                      lineHeight: fontSize * 0.7 * 1.3,
                      marginTop: fontSize * 0.15,
                    },
                  ]}
                >
                  {sub}
                </Text>
              ) : null}
            </>
          )
          const lineStyle = [
            styles.line,
            { paddingVertical: fontSize * 0.28 },
            focus && synced && index !== active ? { filter: `blur(${distance * 0.7}px)` } : null,
          ]
          const onLayout = (event: {
            nativeEvent: { layout: { y: number; height: number } }
          }): void => measured(index, event.nativeEvent.layout.y, event.nativeEvent.layout.height)

          if (time === undefined) {
            return (
              <View key={index} style={lineStyle} onLayout={onLayout}>
                {content}
              </View>
            )
          }
          return (
            <Pressable
              key={`${time}-${index}`}
              style={lineStyle}
              onLayout={onLayout}
              onPress={() => {
                lastManual.current = 0
                player.seekTo(time)
              }}
              onHoverIn={() => setHovered(index)}
              onHoverOut={() => setHovered(current => (current === index ? null : current))}
              accessibilityRole="button"
              accessibilityLabel={text || 'Instrumental break'}
              accessibilityHint="Jump to this line"
            >
              {content}
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { flex: 1, minHeight: 0 },
  line: { borderRadius: radius.sm },
  words: { fontWeight: '700' },
  roman: { fontWeight: '500', fontStyle: 'italic', opacity: 0.8, letterSpacing: 0.2 },
})
