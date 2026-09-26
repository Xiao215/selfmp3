import type { Song, Tag } from '@selfmp3/shared'
import { tagColors } from '@selfmp3/client'

/**
 * The home-screen widget's data (docs/ui-mock `P28`), without the widget.
 *
 * The widget is SwiftUI in its own process: it cannot ask the app anything,
 * so the app hands it a snapshot through the shared App Group
 * (`ports/widget`), and the widget draws what the snapshot says until the next
 * one arrives. Two widgets read it: four tag tiles that play on tap, and what
 * is playing. A tap is a link back into the app, which does the playing.
 *
 * Everything here is plain data the Swift side decodes: colours as hex, times
 * as seconds since 1970, links as strings.
 */

/** The key the snapshot is kept under; the widget reads the same one. */
export const WIDGET_KEY = 'widget.snapshot'

/** How many tiles the tags widget has: two by two. */
const WIDGET_TILES = 4

interface WidgetTile {
  readonly name: string
  readonly fill: string
  readonly ink: string
  readonly songs: number
  /** Opens the tag and plays it. */
  readonly link: string
  /** A small cover, base64, or '' when there is none small enough to hand over. */
  readonly cover: string
}

interface WidgetNowPlaying {
  readonly title: string
  readonly artist: string
  readonly playing: boolean
  /**
   * While playing, when the song ends (seconds since 1970), so the widget can
   * count down by itself; paused, 0.
   */
  readonly endsAt: number
  /** Paused, the seconds left; while playing, 0. */
  readonly remaining: number
  readonly cover: string
  readonly link: string
}

export interface WidgetSnapshot {
  readonly tiles: readonly WidgetTile[]
  readonly nowPlaying: WidgetNowPlaying | null
  /** When it was made, so the widget can tell a stale one. */
  readonly madeAt: number
}

/** `selfmp3://tag/<name>?play=1`: the app opens the tag and starts it. */
export function tagPlayLink(name: string): string {
  return `selfmp3://tag/${encodeURIComponent(name)}?play=1`
}

const NOW_PLAYING_LINK = 'selfmp3://now-playing'

/**
 * The snapshot for this moment. `tiles` are the tags Home shows first
 * (`homeTiles`), in the dark theme's tile colours: a widget sits on a
 * wallpaper, not on the app's own ground, and the dark tile reads on both.
 */
export function widgetSnapshot(input: {
  tiles: readonly { tag: Tag; songs: number; cover: Song | null }[]
  current: Song | null
  playing: boolean
  position: number
  duration: number
  now: number
  coverOf: (song: Song) => string
}): WidgetSnapshot {
  const tiles = input.tiles.slice(0, WIDGET_TILES).map(({ tag, songs, cover }) => {
    const colours = tagColors(tag.hue, 'dark')
    return {
      name: tag.name,
      fill: colours.tile,
      ink: colours.tileInk,
      songs,
      link: tagPlayLink(tag.name),
      cover: cover ? input.coverOf(cover) : '',
    }
  })
  const song = input.current
  const left = Math.max(0, Math.round((input.duration || song?.duration || 0) - input.position))
  const nowPlaying = song
    ? {
        title: song.title,
        artist: song.artist || 'Unknown artist',
        playing: input.playing,
        endsAt: input.playing ? Math.round(input.now / 1000) + left : 0,
        remaining: input.playing ? 0 : left,
        cover: input.coverOf(song),
        link: NOW_PLAYING_LINK,
      }
    : null
  return { tiles, nowPlaying, madeAt: Math.round(input.now / 1000) }
}

/**
 * Whether a new snapshot is worth sending: the widget is redrawn by the
 * system on each, and a budget of reloads a day is all an app gets. Position
 * alone moving is not news — the widget counts down by itself — but a new
 * song, play or pause, or a seek that moves the end by more than a few
 * seconds is.
 */
export function snapshotChanged(before: WidgetSnapshot | null, after: WidgetSnapshot): boolean {
  if (!before) return true
  const tilesOf = (snapshot: WidgetSnapshot): string =>
    JSON.stringify(
      snapshot.tiles.map(tile => [tile.name, tile.fill, tile.songs, tile.cover.length]),
    )
  if (tilesOf(before) !== tilesOf(after)) return true
  const playingBefore = before.nowPlaying
  const playingAfter = after.nowPlaying
  if (!playingBefore || !playingAfter) return playingBefore !== playingAfter
  if (
    playingBefore.title !== playingAfter.title ||
    playingBefore.artist !== playingAfter.artist ||
    playingBefore.playing !== playingAfter.playing
  )
    return true
  if (playingAfter.playing) return Math.abs(playingBefore.endsAt - playingAfter.endsAt) > 5
  return Math.abs(playingBefore.remaining - playingAfter.remaining) > 5
}
