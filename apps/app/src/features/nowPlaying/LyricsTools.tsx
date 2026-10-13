import type { ReactNode } from 'react'
import { Pressable, Text } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { radius, type, withAlpha } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { Refresh, Romanize } from '../../ui/components/Icons'
import { tip } from '../../ui/tip'
import { romanName } from './nowPlaying.model'
import type { SongLyrics } from './useSongWords'

/*
 * The two small pills beside the words on Now Playing, on a phone and a
 * computer alike: the romaji or pinyin switch for words that have them, and
 * Find lyrics for a song that has none. Each layout puts them where it has
 * room; what they look like, say and do is here, once. The phone's had no
 * pressed state and no hint, and drew its ink a shade louder than the stage's.
 */

/** Whether these words come with romaji or pinyin to switch on. */
export function canRomanize(lyrics: SongLyrics): boolean {
  return lyrics.words.status === 'lyrics' && lyrics.language !== 'none'
}

/** "Romaji" or "Pinyin", lit while it is drawn under each line. */
export function RomanizeButton({ lyrics }: { lyrics: SongLyrics }): ReactNode {
  const { theme } = useUnistyles()
  const dense = useLayoutValue(layout => layout.dense)
  const on = lyrics.romanizationOn
  const name = romanName(lyrics.language)
  return (
    <Pressable
      role="button"
      aria-pressed={on}
      onPress={() => lyrics.setRomanization(!on)}
      accessibilityHint={`${on ? 'Hide' : 'Show'} ${name.toLowerCase()} under each line`}
      style={({ pressed }) => [
        styles.tool,
        dense && styles.toolDense,
        pressed && styles.toolPressed,
        on && styles.toolOn,
      ]}
    >
      <Romanize size={14} color={on ? theme.colors.onPrimary : theme.colors.textSecondary} />
      <Text style={[styles.toolText, on && styles.toolTextOn]}>{name}</Text>
    </Pressable>
  )
}

/**
 * "Find lyrics": the lookup asked afresh, clearing the answer it saved that
 * the song has none (`useSongWords`'s `lookAgain`).
 */
export function FindLyricsButton({ onPress }: { onPress: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const dense = useLayoutValue(layout => layout.dense)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Look for lyrics again"
      {...tip('Look for lyrics again')}
      style={({ pressed }) => [
        styles.tool,
        dense && styles.toolDense,
        pressed && styles.toolPressed,
      ]}
    >
      <Refresh size={13} color={theme.colors.textSecondary} />
      <Text style={styles.toolText}>Find lyrics</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  // A finger's height on a phone; with a mouse, only as tall as its words.
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.1),
  },
  toolDense: { minHeight: 0, paddingVertical: 5, paddingHorizontal: 11 },
  toolPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.16) },
  toolOn: { backgroundColor: theme.colors.textPrimary },
  toolText: { color: theme.colors.textSecondary, fontSize: type.small, fontWeight: '600' },
  toolTextOn: { color: theme.colors.onPrimary },
}))
