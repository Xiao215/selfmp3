import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { activeLineIndex, parseLyrics } from '@selfmp3/shared'
import { useAccent } from '../accent'
import { colors, space, type } from '@selfmp3/client'

/**
 * Lyrics, synced when the file has timestamps.
 *
 * The parsing and the "which line is now" search are the shared `lrc.ts`
 * helpers — the same code the web app uses, so a file that highlights
 * correctly on the Mac highlights identically here.
 *
 * Lines are a fixed height so the active one can be scrolled to without
 * measuring anything: `onLayout` per line would be dozens of measurements a
 * second on a long song.
 */

const LINE_HEIGHT = 34

export function Lyrics({
  text,
  position,
  loading,
  error,
}: {
  text: string | null
  position: number
  loading: boolean
  error: boolean
}): ReactNode {
  const accent = useAccent()
  const scrollRef = useRef<ScrollView>(null)
  const parsed = useMemo(() => (text === null ? null : parseLyrics(text)), [text])

  const active = parsed?.synced === true ? activeLineIndex(parsed.lines, position) : -1

  const lastScrolled = useRef(-1)
  useEffect(() => {
    if (active < 0 || active === lastScrolled.current) return
    lastScrolled.current = active
    // Keep the active line a third of the way down rather than at the top:
    // reading the *next* line is the point.
    scrollRef.current?.scrollTo({ y: Math.max(0, active * LINE_HEIGHT - 110), animated: true })
  }, [active])

  if (loading) return <Message text="Looking for lyrics…" />
  if (error || parsed === null) return <Message text="No lyrics for this one." />

  if (!parsed.synced) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        {parsed.lines.map((line, index) => (
          <Text key={`${index}-${line}`} style={styles.plainLine}>
            {line || ' '}
          </Text>
        ))}
      </ScrollView>
    )
  }

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
      {parsed.lines.map((line, index) => (
        <View key={`${index}-${line.time}`} style={styles.lineBox}>
          <Text
            style={[
              styles.line,
              index === active && [styles.activeLine, { color: accent.accent }],
              index < active && styles.pastLine,
            ]}
            numberOfLines={2}
          >
            {line.text || '♪'}
          </Text>
        </View>
      ))}
    </ScrollView>
  )
}

function Message({ text }: { text: string }): ReactNode {
  return (
    <View style={styles.message}>
      <Text style={styles.messageText}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
  },
  lineBox: {
    height: LINE_HEIGHT,
    justifyContent: 'center',
  },
  line: {
    color: colors.textMuted,
    fontSize: type.title,
    fontWeight: '500',
  },
  activeLine: {
    fontWeight: '700',
  },
  pastLine: {
    color: colors.textSecondary,
  },
  plainLine: {
    color: colors.textSecondary,
    fontSize: type.body,
    lineHeight: 22,
  },
  message: {
    padding: space.xl,
    alignItems: 'center',
  },
  messageText: {
    color: colors.textMuted,
    fontSize: type.body,
  },
})
