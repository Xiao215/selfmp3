import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { artistOr, formatLongDuration, plural, type AskCard } from '@selfmp3/shared'
import { space, type, useLibrary } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { Button } from '../../ui/components/Button'
import { useSongsById } from '../../ui/songsById'
import { songCount, SONGS_MORE, SONGS_SHOW } from './Review'
import { foundSource } from '../lists/lists.model'
import { parts, sortWords } from './smart.model'
import { useSmartServer } from './useSmartServer'
import { AnswerSongLine } from './AnswerSongLine'
import { ScrollView } from '../../ui/components/Scroll'
import { AnswerActions, AnswerHead, AnswerLine } from './AnswerParts'
import { Press } from '../../ui/components/Press'

/**
 * A question about what is in the library ("how many YOASOBI songs do I
 * have", "my longest song"), answered from it in code: how many and how long,
 * what chose them, then who they are by or the songs themselves, each one
 * press from playing.
 */
export function LibraryAnswer({
  answer,
  text,
  height,
  onDone,
}: {
  answer: Extract<AskCard, { kind: 'library' }>
  /** The words asked, which name what plays from it. */
  text: string
  height: number
  onDone: () => void
}): ReactNode {
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
    player.playFrom(ids, index, { source: foundSource(text) })
    onDone()
  }

  if (answer.count === 0) {
    return (
      <AnswerLine testID="ask-library-none">
        None of your songs {chosen.length > 0 ? `are ${chosen.join(' · ')}` : 'fit that'}.
        {answer.unknown.length > 0 ? ` Your library has no ${answer.unknown.join(', ')}.` : ''}
      </AnswerLine>
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
  // Judged from some of the songs only: the count is an estimate, and says so.
  const about = answer.judged !== null && answer.judged.songs < answer.judged.of ? 'about ' : ''
  return (
    <>
      <AnswerHead>
        {/* Fewer listed than counted (a size asked for, the most a list holds, or songs
            not on this device yet): said, so "Play these" is not mistaken for all of them. */}
        {libraryHead(answer, songs.length, about)}
      </AnswerHead>
      <Text style={styles.muted}>
        {chosen.length > 0 ? chosen.join(' · ') : 'Your whole library'}
        {answer.sortBy ? ` · ${sortWords(answer.sortBy, answer.order)}` : ''}
      </Text>
      {about ? (
        <Text style={styles.muted}>
          An estimate: judged {answer.judged!.songs.toLocaleString('en')} of the{' '}
          {answer.judged!.of.toLocaleString('en')} songs it could be.
        </Text>
      ) : null}
      {answer.unknown.length > 0 ? (
        <Text style={styles.muted}>Your library has no {answer.unknown.join(', ')}.</Text>
      ) : null}
      {list ? (
        <ScrollView style={{ maxHeight: height }} contentContainerStyle={styles.counts}>
          {list.map(each => (
            <View key={each.label} style={styles.countRow}>
              <Text style={styles.title} numberOfLines={1}>
                {each.label}
              </Text>
              <Text style={styles.muted}>{plural(each.count, 'song', 'songs')}</Text>
            </View>
          ))}
          {list.length < answer.distinct[listed(answer.show)] ? (
            <Text style={styles.muted}>
              and {(answer.distinct[listed(answer.show)] - list.length).toLocaleString('en')} more
            </Text>
          ) : null}
        </ScrollView>
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
            <AnswerSongLine
              key={song.id}
              song={song}
              onPlay={() => play(index)}
              testID="ask-library-song"
              artUri={artFor(song)}
              sub={artistOr(song.artist)}
            />
          ))}
          {shown.length < songs.length ? (
            <Press
              feedback="dim"
              onPress={() => setShows(shown.length + SONGS_MORE)}
              accessibilityRole="button"
              style={styles.more}
            >
              <Text style={styles.moreText}>
                Show {Math.min(SONGS_MORE, songs.length - shown.length)} more
              </Text>
            </Press>
          ) : null}
        </ScrollView>
      )}
      <AnswerActions>
        <Button
          label={songs.length === 1 ? 'Play it' : 'Play these'}
          variant="primary"
          disabled={songs.length === 0}
          onPress={() => play(0)}
          testID="ask-library-play"
        />
      </AnswerActions>
    </>
  )
}

type Library = Extract<AskCard, { kind: 'library' }>

/** Which of the counted lists a library answer shows. */
function listed(
  show: 'artists' | 'albums' | 'tags' | 'count' | 'songs',
): keyof Library['distinct'] {
  return show === 'albums' ? 'albums' : show === 'tags' ? 'tags' : 'artists'
}

/**
 * The answer's head: how many artists, albums or tags when that is what was
 * asked, else how many songs (and how many of them are listed, when fewer).
 */
function libraryHead(answer: Library, listedSongs: number, about: string): string {
  const songs = `${about}${songCount(answer.count)}`
  switch (answer.show) {
    case 'artists':
      return `${about}${plural(answer.distinct.artists, 'artist', 'artists')} · ${songs}`
    case 'albums':
      return `${about}${plural(answer.distinct.albums, 'album', 'albums')} · ${songs}`
    case 'tags':
      return `${about}${plural(answer.distinct.tags, 'tag', 'tags')} · ${songs}`
    case 'songs':
      if (listedSongs < answer.count) return `${listedSongs.toLocaleString('en')} of ${songs}`
      return `${songs} · ${formatLongDuration(answer.seconds)}`
    case 'count':
      return `${songs} · ${formatLongDuration(answer.seconds)}`
  }
}

const styles = StyleSheet.create(theme => ({
  muted: { color: theme.colors.textMuted, fontSize: type.small, fontWeight: '400' },
  counts: { gap: space.xs, paddingTop: space.xs },
  countRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  title: { flexShrink: 1, color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '500' },
  more: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: space.xs },
  moreText: { color: theme.colors.accent, fontSize: type.sub, fontWeight: '500' },
}))
