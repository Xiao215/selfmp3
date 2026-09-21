import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Playlist, Song } from '@selfmp3/shared'
import { radius, useLibrary, usePlaylistSongIds } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { Cover } from '../../ui/components/Cover'
import { ListMusic, Live } from '../../ui/components/Icons'
import { isLive } from './playlists.model'

/**
 * A playlist's cover: the covers of its first songs.
 *
 * Music is found by its artwork everywhere else in the app, so a playlist is
 * too — four covers in a square when four of its songs have art, the first
 * cover alone when fewer do, and the kind's icon when it has no songs yet.
 * Nothing to choose or keep up to date: it changes as the playlist does.
 *
 * `size` is a side in points; without it the cover fills the width it is
 * given, which is how a tile in the grid uses it.
 */
export function PlaylistCover({
  playlist,
  songIds: given,
  size,
}: {
  /** Without one, `songIds` must say what is on it: Forgotten gems is not a stored playlist. */
  playlist?: Playlist
  /** The playlist's songs, when the caller already has them; otherwise they are fetched. */
  songIds?: readonly number[]
  size?: number
}): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const { data } = usePlaylistSongIds(
    given || !playlist || playlist.songCount === 0 ? null : playlist.id,
  )

  const songIds = given ?? data?.songIds
  const covers = useMemo(() => {
    const byId = songsById(library?.songs ?? NO_SONGS)
    const songs = (songIds ?? []).slice(0, 24).flatMap(id => {
      const song = byId.get(id)
      return song ? [song] : []
    })
    const withArt = songs.filter(song => artFor(song) !== null)
    if (withArt.length >= 4) return withArt.slice(0, 4)
    return withArt.slice(0, 1).length > 0 ? withArt.slice(0, 1) : songs.slice(0, 1)
  }, [library?.songs, songIds, artFor])

  // Held, not rebuilt: a tag list or a playlist grid draws one of these per
  // row, and these numbers only depend on the size asked for.
  const frame = useMemo(
    () => [
      styles.frame,
      size === undefined ? styles.fill : { width: size, height: size },
      { borderRadius: coverRadius(size) },
    ],
    [size],
  )

  if (covers.length === 0) {
    const Glyph = playlist && isLive(playlist) ? Live : ListMusic
    return (
      <View style={[frame, styles.empty]}>
        {/* Its own full-width box: the frame it sits in is a wrapping row, which
            leaves a lone icon against the left edge. */}
        <View style={styles.emptyGlyph}>
          <Glyph size={size !== undefined && size < 48 ? 14 : 26} color={theme.colors.textMuted} />
        </View>
      </View>
    )
  }

  return (
    <View style={frame}>
      {covers.map(song => (
        <Tile key={song.id} song={song} uri={artFor(song)} half={covers.length === 4} />
      ))}
    </View>
  )
}

const NO_SONGS: readonly Song[] = []

/**
 * The corner for a cover this size (`S2`): a tile in the grid and the big
 * cover at the top of a playlist are cards, 18 round; a cover in a row is
 * 10, and a small one 8.
 */
function coverRadius(size: number | undefined): number {
  if (size === undefined || size >= 96) return radius.card
  return size >= 40 ? radius.cover : radius.coverSm
}

/**
 * The library by song id, built once per library and shared by every tile.
 * Per-tile, a grid of forty playlists would build forty copies of the whole
 * library every time any cover arrived.
 */
const byIdCache = new WeakMap<readonly Song[], ReadonlyMap<number, Song>>()

function songsById(songs: readonly Song[]): ReadonlyMap<number, Song> {
  let byId = byIdCache.get(songs)
  if (!byId) {
    byId = new Map(songs.map(song => [song.id, song]))
    byIdCache.set(songs, byId)
  }
  return byId
}

/**
 * One cell. A `Cover`, so art that fails to load (a server that is not running)
 * falls back to the song's own coloured letter rather than leaving a hole. A
 * cover draws at a fixed size, so the cell measures itself and hands it on.
 */
function Tile({ song, uri, half }: { song: Song; uri: string | null; half: boolean }): ReactNode {
  const [side, setSide] = useState(0)
  return (
    <View
      style={half ? styles.half : styles.whole}
      onLayout={event => setSide(Math.floor(event.nativeEvent.layout.width))}
    >
      {side > 0 ? (
        <Cover uri={uri} title={song.album || song.title} size={side} radius={0} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  frame: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  fill: { width: '100%', aspectRatio: 1 },
  emptyGlyph: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  empty: {
    // One icon, in the middle: a wrapping row would park it at the top.
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  half: { width: '50%', height: '50%' },
  whole: { width: '100%', height: '100%' },
}))
