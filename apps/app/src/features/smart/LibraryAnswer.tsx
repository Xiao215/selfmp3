import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { artistOr, formatLongDuration, plural, type AskAnswer } from '@selfmp3/shared'
import { space, useLibrary } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { Button } from '../../ui/components/Button'
import { Play } from '../../ui/components/Icons'
import { useSongsById } from '../../ui/songsById'
import { songCount, SONGS_MORE, SONGS_SHOW } from './Review'
import { parts, sortWords } from './smart.model'
import { useSmartServer } from './useSmartServer'
import { SongLine } from '../../ui/components/SongLine'

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
  const player = usePlayerCommands()
  const { data: library } = useLibrary()
  const artFor = useArt(ROW_COVER_SIZE)
  const [shows, setShows] = useState(SONGS_SHOW)
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
            <SongLine
              key={song.id}
              onPress={() => play(index)}
              accessibilityLabel={`Play ${song.title}`}
              testID="ask-library-song"
              artUri={artFor(song)}
              coverTitle={song.album || song.title}
              title={song.title}
              sub={artistOr(song.artist)}
              trailing={<Play size={14} color={theme.colors.textSecondary} />}
            />
          ))}
          {shown.length < songs.length ? (
            <Pressable
              onPress={() => setShows(shown.length + SONGS_MORE)}
              accessibilityRole="button"
              style={styles.more}
            >
              <Text style={styles.moreText}>
                Show {Math.min(SONGS_MORE, songs.length - shown.length)} more
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
  title: { flexShrink: 1, color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  more: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: space.xs },
  moreText: { color: theme.colors.accent, fontSize: 12.5, fontWeight: '500' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  pressed: { opacity: 0.6 },
}))
