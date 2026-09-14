import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Image, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Playlist, Song } from '@selfmp3/shared'
import { radius, useLibrary, usePlaylistSongIds } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { useAccent } from '../../ui/accent'
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
  const accent = useAccent()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const { data } = usePlaylistSongIds(
    given || !playlist || playlist.songCount === 0 ? null : playlist.id,
  )

  const songIds = given ?? data?.songIds
  const covers = useMemo(() => {
    const byId = new Map((library?.songs ?? []).map(song => [song.id, song]))
    const songs = (songIds ?? []).slice(0, 24).flatMap(id => {
      const song = byId.get(id)
      return song ? [song] : []
    })
    const withArt = songs.filter(song => artFor(song) !== null)
    if (withArt.length >= 4) return withArt.slice(0, 4)
    return withArt.slice(0, 1).length > 0 ? withArt.slice(0, 1) : songs.slice(0, 1)
  }, [library?.songs, songIds, artFor])

  const frame = [
    styles.frame,
    size === undefined ? styles.fill : { width: size, height: size },
    { borderRadius: size !== undefined && size < 48 ? radius.sm : radius.md },
  ]

  if (covers.length === 0) {
    const Glyph = playlist && isLive(playlist) ? Live : ListMusic
    return (
      <View style={[frame, styles.empty]}>
        <Glyph size={size !== undefined && size < 48 ? 14 : 26} color={theme.colors.textMuted} />
      </View>
    )
  }

  return (
    <View style={frame}>
      {covers.map(song => (
        <Tile key={song.id} song={song} uri={artFor(song)} half={covers.length === 4} tint={accent.hue} />
      ))}
    </View>
  )
}

function Tile({
  song,
  uri,
  half,
  tint,
}: {
  song: Song
  uri: string | null
  half: boolean
  tint: number
}): ReactNode {
  const cell = half ? styles.half : styles.whole
  if (uri) return <Image source={{ uri }} style={cell} resizeMode="cover" />
  // A song without art, alone on the cover: a quiet block rather than a hole.
  return <View style={[cell, { backgroundColor: `hsl(${(tint + song.id * 37) % 360}, 22%, 24%)` }]} />
}

const styles = StyleSheet.create(theme => ({
  frame: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  fill: { width: '100%', aspectRatio: 1 },
  empty: {
    // One icon, in the middle: a wrapping row would park it at the top.
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
    backgroundColor: 'transparent',
  },
  half: { width: '50%', height: '50%' },
  whole: { width: '100%', height: '100%' },
}))
