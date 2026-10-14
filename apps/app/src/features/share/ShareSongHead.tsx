import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { artistOr, type RoomSong } from '@selfmp3/shared'
import { coverSize, radius, space, type } from '@selfmp3/client'
import { canRomanize, RomanizeButton } from '../nowPlaying/LyricsTools'
import { StageLyrics } from '../nowPlaying/StageLyrics'
import type { SongLyrics } from '../nowPlaying/useSongWords'
import { usePresence } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { artShadow, heroTitle, rowTitle, textColumn } from '../../ui/surfaces'
import { Cover } from '../../ui/components/Cover'
import { Press } from '../../ui/components/Press'

/** The words' row's cover: Now Playing's beside its words. */
const ROW_COVER = coverSize.rowDense

/**
 * A one-song link's head (F1, F2): its big cover with the title under it,
 * and, while it plays and has words, the cover shrunk into a row over its
 * words scrolling in time — Now Playing's words, from what the link lends.
 *
 * The words lie over the cover's place rather than taking one of their own,
 * so the page under them stays where it was when they arrive. The cover
 * shrinks into the row's corner as the title fades and the words come up; a
 * tap on the row puts the cover back, and one on the cover the words.
 */
export function ShareSongHead({
  song,
  cover,
  size,
  wide,
  ended,
  lyrics,
  showWords,
  onShowWords,
}: {
  song: RoomSong
  cover: string | null
  size: number
  wide: boolean
  ended: boolean
  lyrics: SongLyrics
  /** The words in the cover's place: asked for, and there to show. */
  showWords: boolean
  /** Null while there are no words to turn to. */
  onShowWords: ((on: boolean) => void) | null
}): ReactNode {
  const swap = usePresence(showWords, MOVE_MS.shareWords, MOVE_MS.shareWords)
  const words = lyrics.words
  const moves = useMemo(() => {
    const p = swap.progress
    const clamp = 'clamp' as const
    // Scaled about its middle, then moved so its corner lands on the row's cover.
    const travel = -(size - ROW_COVER) / 2
    return {
      cover: {
        opacity: p.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) },
          { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) },
          { scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, ROW_COVER / size] }) },
        ],
      },
      names: {
        opacity: p.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: clamp }),
      },
      words: {
        opacity: p.interpolate({ inputRange: [0.5, 1], outputRange: [0, 1], extrapolate: clamp }),
        transform: [
          {
            translateY: p.interpolate({
              inputRange: [0.5, 1],
              outputRange: [space.sm, 0],
              extrapolate: clamp,
            }),
          },
        ],
      },
    }
  }, [swap.progress, size])

  const byline = [artistOr(song.artist), song.album].filter(Boolean).join(' · ')
  return (
    <View style={styles.head}>
      <View
        pointerEvents={showWords ? 'none' : 'auto'}
        aria-hidden={showWords}
        style={styles.cover}
      >
        <Animated.View style={[styles.art, { width: size, height: size }, moves.cover]}>
          <Press
            disabled={!onShowWords}
            onPress={() => onShowWords?.(true)}
            accessibilityLabel={onShowWords ? 'Show the words' : undefined}
            style={ended ? styles.faded : undefined}
          >
            <Cover uri={cover} title={song.title} size={size} />
          </Press>
        </Animated.View>
        <Animated.View style={[styles.names, moves.names]}>
          <Text
            style={wide ? styles.titleWide : styles.title}
            accessibilityRole="header"
            numberOfLines={3}
          >
            {song.title}
          </Text>
          {byline ? (
            <Text style={styles.byline} numberOfLines={2}>
              {byline}
            </Text>
          ) : null}
        </Animated.View>
      </View>

      {swap.mounted && words.status === 'lyrics' ? (
        <Animated.View
          pointerEvents={showWords ? 'auto' : 'none'}
          style={[styles.wordsLayer, moves.words]}
          testID="share-words"
        >
          <View style={styles.row}>
            <Press
              feedback="dim"
              onPress={() => onShowWords?.(false)}
              accessibilityLabel="Show the cover"
              style={styles.rowPress}
            >
              <Cover uri={cover} title={song.title} size={ROW_COVER} />
              <View style={textColumn}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {song.title}
                </Text>
                <Text style={styles.rowArtist} numberOfLines={1}>
                  {artistOr(song.artist)}
                </Text>
              </View>
            </Press>
            {canRomanize(lyrics) ? <RomanizeButton lyrics={lyrics} /> : null}
          </View>
          <View style={styles.words}>
            <StageLyrics
              parsed={words.parsed}
              roman={words.roman}
              focus={false}
              fontSize={wide ? 28 : 24}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  head: { position: 'relative' },
  cover: { gap: space.lg },
  art: { borderRadius: radius.card, ...artShadow(theme.colors) },
  faded: { opacity: 0.45 },
  names: { gap: space.xs },
  title: heroTitle(theme.colors, 'page'),
  titleWide: heroTitle(theme.colors),
  byline: { color: theme.colors.textSecondary, fontSize: type.body },
  wordsLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowPress: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowTitle: rowTitle(theme.colors),
  rowArtist: { color: theme.colors.textSecondary, fontSize: type.small },
  // A little past the page's sides, so a line's press wash has room.
  words: { flex: 1, minHeight: 0, marginTop: space.md, marginHorizontal: -space.tight },
}))
