import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { activeLineIndex, type ParsedLyrics } from '@selfmp3/shared'
import { radius, withAlpha } from '@selfmp3/client'
import { usePlayer, usePlayerProgress } from '../../player/PlayerProvider'
import { LYRIC_ANCHOR, LYRIC_LEAD, MANUAL_SCROLL_MS } from './nowPlaying.model'
import { glideToLine } from './lyricFollow.model'
import { blurReach, lineTone, lyricBlur, type LineTone } from './stageLyrics.model'
import { MOVE_MS } from './stageMove.model'

interface LyricsProps {
  parsed: ParsedLyrics
  roman: readonly string[] | null
  focus: boolean
  fontSize: number
}

/**
 * The lyrics on a computer's Now Playing page: the web's `LyricsView`.
 *
 * The line being sung stays at the same height on screen and the list moves
 * under it. Click a line to jump to it. Scrolling by hand holds off the
 * centring for a few seconds, so reading ahead is not fought.
 *
 * The sung line is measured when it is scrolled to, not remembered from when
 * it last laid out. A romanized line under each one makes their heights
 * differ, and on the web a line that moves without changing size — a ♪ break
 * below lines whose font arrived late — reports no new layout at all:
 * scrolling to where it used to be left the sung line off the screen after a
 * seek, until the song reached the next line.
 *
 * In Focus the type is larger and lines further from the sung one blur a
 * little.
 *
 * The position ticks several times a second but the sung line changes every
 * few seconds, so only this thin part reads the position. The list below it
 * is drawn again when the sung line changes, and each line only when its own
 * look does.
 */
export function StageLyrics(props: LyricsProps): ReactNode {
  const { position } = usePlayerProgress()
  const synced = props.parsed.synced ? props.parsed.lines : null
  const active = synced ? activeLineIndex(synced, position, LYRIC_LEAD) : -1
  return <LyricsList {...props} active={active} />
}

const LyricsList = memo(function LyricsList({
  parsed,
  roman,
  focus,
  fontSize,
  active,
}: LyricsProps & { active: number }): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const scrollRef = useRef<ScrollView>(null)
  const contentRef = useRef<View>(null)
  const lineRefs = useRef<(View | null)[]>([])
  const [boxHeight, setBoxHeight] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [layoutTick, setLayoutTick] = useState(0)
  /** The content's last size, so only a real change of it counts as re-laid. */
  const contentSize = useRef({ width: -1, height: -1 })
  const lastManual = useRef(0)
  /** The layout the words were last centred for: a new one is a jump, not a glide. */
  const centredFor = useRef(-1)
  /** The line the words were last scrolled to, so a seek can be told from the song moving on. */
  const shownLine = useRef(-1)
  const seekTo = useRef(player.seekTo)
  useEffect(() => {
    seekTo.current = player.seekTo
  })

  // Reading ahead by hand, in a browser: the wheel, a trackpad, a finger.
  // Only these hold off the centring — a scroll event alone is also what the
  // page's own scrolling and a change of layout send, and treating those as a
  // hand stopped the words following for four seconds after lyrics-only opened.
  useEffect(() => {
    const node = (
      scrollRef.current as unknown as { getScrollableNode?: () => unknown } | null
    )?.getScrollableNode?.() as
      | {
          addEventListener?: (type: string, listener: () => void, options?: object) => void
          removeEventListener?: (type: string, listener: () => void) => void
        }
      | undefined
    if (!node?.addEventListener || !node.removeEventListener) return undefined
    const byHand = (): void => {
      lastManual.current = Date.now()
    }
    node.addEventListener('wheel', byHand, { passive: true })
    node.addEventListener('touchmove', byHand, { passive: true })
    return () => {
      node.removeEventListener?.('wheel', byHand)
      node.removeEventListener?.('touchmove', byHand)
    }
  }, [])

  // The blur comes on once the words have finished moving into Focus, not in
  // the same frame as the new size and the glide, where every blurred line
  // was one more thing for that frame to draw. Leaving Focus takes it off at
  // once — `blurring` below asks for Focus as well — which only makes the
  // move lighter; `settled` itself is put back after, ready for next time.
  const [settled, setSettled] = useState(focus)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(focus), focus ? MOVE_MS : 0)
    return () => clearTimeout(timer)
  }, [focus])

  const synced = parsed.synced ? parsed.lines : null
  const lines = parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines

  useEffect(() => {
    if (!synced || boxHeight === 0) return
    const index = Math.max(0, active)
    const glide = glideToLine(shownLine.current, index)
    // Reading ahead by hand holds off the song moving on, but not a seek: that
    // is asking to see where the song now is.
    if (glide && Date.now() - lastManual.current < MANUAL_SCROLL_MS) {
      shownLine.current = index
      return
    }
    const line = lineRefs.current[index]
    const content = contentRef.current
    if (!line || !content) return
    // The words changed size — lyrics-only's larger type, romanization, a
    // font arriving — so every line moved: jump to the sung one rather than
    // glide the whole distance.
    const relaid = centredFor.current !== layoutTick
    centredFor.current = layoutTick
    shownLine.current = index
    lastManual.current = 0
    line.measureLayout(
      content,
      (_x, y, _width, height) => {
        // The content's top padding is the anchor's own height, so centring
        // the line on the anchor is scrolling to the line's middle.
        scrollRef.current?.scrollTo({ y: Math.max(0, y + height / 2), animated: glide && !relaid })
      },
      () => undefined,
    )
  }, [active, boxHeight, layoutTick, synced])

  // Handed to every line, so they are the same functions from one drawing to
  // the next and a line whose look did not change is not drawn again.
  const register = useCallback((index: number, node: View | null) => {
    lineRefs.current[index] = node
  }, [])
  const seek = useCallback((time: number) => {
    lastManual.current = 0
    seekTo.current(time)
  }, [])
  const hoverIn = useCallback((index: number) => setHovered(index), [])
  const hoverOut = useCallback(
    (index: number) => setHovered(current => (current === index ? null : current)),
    [],
  )

  const tones: Record<LineTone, string> = {
    plain: theme.colors.textSecondary,
    active: theme.colors.textPrimary,
    hovered: withAlpha(theme.colors.textPrimary, 0.72),
    past: withAlpha(theme.colors.textPrimary, 0.25),
    future: withAlpha(theme.colors.textPrimary, 0.4),
  }
  const blurring = focus && settled && synced !== null
  const reach = blurReach(boxHeight, fontSize)

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
        // A drag on a phone. A browser's wheel and touch are listened for below:
        // a scroll event alone is also what a re-layout or our own scroll sends.
        onScrollBeginDrag={() => {
          lastManual.current = Date.now()
        }}
      >
        {/* What the lines are measured against. Its size changing — a font
            arriving, romanization turning on — re-centres the sung line. A
            layout that leaves its size as it was is not a change: counting
            those re-centred the words over and over while nothing had moved. */}
        <View
          ref={contentRef}
          onLayout={event => {
            const { width, height } = event.nativeEvent.layout
            const last = contentSize.current
            if (width === last.width && height === last.height) return
            contentSize.current = { width, height }
            setLayoutTick(tick => tick + 1)
          }}
        >
          {lines.map((text, index) => {
            const time = synced?.[index]?.time
            return (
              <LyricLine
                key={time === undefined ? index : `${time}-${index}`}
                index={index}
                text={text}
                sub={roman?.[index]}
                time={time}
                color={tones[lineTone(index, active, hovered, synced !== null)]}
                fontSize={fontSize}
                blur={blurring ? lyricBlur(index, active, reach) : 0}
                register={register}
                onSeek={seek}
                onHoverIn={hoverIn}
                onHoverOut={hoverOut}
              />
            )
          })}
        </View>
      </ScrollView>
    </View>
  )
})

/** One line of the words, drawn again only when its own text, colour, size or blur changes. */
const LyricLine = memo(function LyricLine({
  index,
  text,
  sub,
  time,
  color,
  fontSize,
  blur,
  register,
  onSeek,
  onHoverIn,
  onHoverOut,
}: {
  index: number
  text: string
  sub: string | undefined
  time: number | undefined
  color: string
  fontSize: number
  blur: number
  register: (index: number, node: View | null) => void
  onSeek: (time: number) => void
  onHoverIn: (index: number) => void
  onHoverOut: (index: number) => void
}): ReactNode {
  const keep = useCallback((node: View | null) => register(index, node), [register, index])
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
    blur > 0 ? { filter: `blur(${blur}px)` } : null,
  ]

  if (time === undefined) {
    return (
      <View ref={keep} style={lineStyle}>
        {content}
      </View>
    )
  }
  return (
    <Pressable
      ref={keep}
      style={lineStyle}
      onPress={() => onSeek(time)}
      onHoverIn={() => onHoverIn(index)}
      onHoverOut={() => onHoverOut(index)}
      accessibilityRole="button"
      accessibilityLabel={text || 'Music break'}
      accessibilityHint="Jump to this line"
    >
      {content}
    </Pressable>
  )
})

const styles = StyleSheet.create({
  box: { flex: 1, minHeight: 0 },
  line: { borderRadius: radius.sm },
  words: { fontWeight: '700' },
  roman: { fontWeight: '500', fontStyle: 'italic', opacity: 0.8, letterSpacing: 0.2 },
})
