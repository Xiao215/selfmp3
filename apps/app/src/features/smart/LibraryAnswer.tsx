import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { formatLongDuration, plural, type AskAnswer } from '@selfmp3/shared'
import { radius, space, useLibrary } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Play } from '../../ui/components/Icons'
import { useSongsById } from '../../ui/songsById'
import { songCount } from './Review'
import { parts, sortWords } from './smart.model'
import { useSmartServer } from './useSmartServer'

/** How many songs show first, and how many more each "Show more" adds. */
const SHOWS = 8
const MORE = 50

/**
 * A question about what is in the library ("how many YOASOBI songs do I
 * have", "my longest song"), answered from it in code: how many and how long,
 * what chose them, then who they are by or the songs themselves, each one
 * press from playing.
 */
export function LibraryAnswer({
  answer,
  height,
  onDone,
}: {
  answer: Extract<AskAnswer, { kind: 'library' }>
  height: number
  onDone: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const server = useSmartServer()
  const player = usePlayer()
  const { data: library } = useLibrary()
  const artFor = useArt(ROW_COVER_SIZE)
  const [shows, setShows] = useState(SHOWS)
  const songsById = useSongsById()
  const songs = answer.songIds.flatMap(id => {
    const here = server.onDevice(id)
    const song = here === undefined ? undefined : songsById.get(here)
    return song ? [song] : []
  })
  const chosen = parts(answer.understanding, library?.tags ?? []).map(part => part.label)
  const ids = songs.map(song => song.id)
  const play = (index: number): void => {
    player.playFrom(ids, index, { source: { kind: 'songs', origin: 'found', name: 'Search' } })
    onDone()
  }

  if (answer.count === 0) {
    return (
      <Text style={styles.line} testID="ask-library-none">
        None of your songs {chosen.length > 0 ? `are ${chosen.join(' · ')}` : 'fit that'}.
        {answer.unknown.length > 0 ? ` Your library has no ${answer.unknown.join(', ')}.` : ''}
      </Text>
    )
  }

  const list =
    answer.show === 'artists'
      ? answer.artists
      : answer.show === 'albums'
        ? answer.albums
        : answer.show === 'tags'
          ? answer.tags
          : null
  const shown = songs.slice(0, shows)
  return (
    <>
      <Text style={styles.head}>
        {answer.understanding.size !== null && answer.understanding.size < answer.count
          ? `${songs.length.toLocaleString('en')} of ${songCount(answer.count)}`
          : `${songCount(answer.count)} · ${formatLongDuration(answer.seconds)}`}
      </Text>
      <Text style={styles.muted}>
        {chosen.length > 0 ? chosen.join(' · ') : 'Your whole library'}
        {answer.sortBy ? ` · ${sortWords(answer.sortBy, answer.order)}` : ''}
      </Text>
      {answer.unknown.length > 0 ? (
        <Text style={styles.muted}>Your library has no {answer.unknown.join(', ')}.</Text>
      ) : null}
      {list ? (
        <View style={styles.counts}>
          {list.map(each => (
            <View key={each.label} style={styles.countRow}>
              <Text style={styles.title} numberOfLines={1}>
                {each.label}
              </Text>
              <Text style={styles.muted}>{plural(each.count, 'song', 'songs')}</Text>
            </View>
          ))}
        </View>
      ) : answer.show === 'count' ? (
        <Text style={styles.muted}>
          By{' '}
          {answer.artists
            .slice(0, 3)
            .map(each => `${each.label} ${each.count}`)
            .join(', ')}
          {answer.artists.length > 3 ? ', and more' : ''}
        </Text>
      ) : (
        <ScrollView style={{ maxHeight: height }}>
          {shown.map((song, index) => (
            <Pressable
              key={song.id}
              onPress={() => play(index)}
              accessibilityRole="button"
              accessibilityLabel={`Play ${song.title}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID="ask-library-song"
            >
              <Cover uri={artFor(song)} title={song.album || song.title} size={36} />
              <Text style={[styles.title, styles.grow]} numberOfLines={1}>
                {song.title}
                <Text style={styles.muted}> · {song.artist || 'Unknown artist'}</Text>
              </Text>
              <Play size={14} color={theme.colors.textSecondary} />
            </Pressable>
          ))}
          {shown.length < songs.length ? (
            <Pressable
              onPress={() => setShows(shown.length + MORE)}
              accessibilityRole="button"
              style={styles.more}
            >
              <Text style={styles.moreText}>
                Show {Math.min(MORE, songs.length - shown.length)} more
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
      <View style={styles.actions}>
        <Button
          label={songs.length === 1 ? 'Play it' : 'Play these'}
          variant="primary"
          disabled={songs.length === 0}
          onPress={() => play(0)}
          testID="ask-library-play"
        />
      </View>
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  head: { color: theme.colors.textPrimary, fontSize: 15.5, fontWeight: '600' },
  line: { color: theme.colors.textSecondary, fontSize: 13.5, lineHeight: 19 },
  muted: { color: theme.colors.textMuted, fontSize: 12.5, fontWeight: '400' },
  counts: { gap: 4, paddingTop: space.xs },
  countRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  grow: { flex: 1, minWidth: 0 },
  title: { flexShrink: 1, color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  more: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: space.xs },
  moreText: { color: theme.colors.accent, fontSize: 12.5, fontWeight: '500' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  pressed: { opacity: 0.6 },
}))
