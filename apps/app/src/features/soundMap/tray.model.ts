import type { Song } from '@selfmp3/shared'
import type { MapTake } from './sky.model'

/** One stroke's part of the tray: a section of its own, headed in its colour. */
export interface TraySection {
  readonly take: MapTake
  /** Its songs in the order they will play, less any an earlier stroke took and any left out. */
  readonly songs: readonly Song[]
  /** The place the first of them plays at, from 1: the list is numbered across sections. */
  readonly first: number
  /** Its songs left out, which "Bring back" returns. */
  readonly left: readonly number[]
}

/**
 * The tray as sections, one a stroke in the order drawn (B1,
 * docs/features/sound-map.md). A song two strokes took is in the first one's
 * section only, as it plays once; a song no longer in the library is dropped.
 */
export function traySections(
  takes: readonly MapTake[],
  left: ReadonlySet<number>,
  songs: ReadonlyMap<number, Song>,
): TraySection[] {
  const seen = new Set<number>()
  const sections: TraySection[] = []
  let first = 1
  for (const take of takes) {
    const kept: Song[] = []
    const out: number[] = []
    for (const id of take.ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const song = songs.get(id)
      if (!song) continue
      if (left.has(id)) out.push(id)
      else kept.push(song)
    }
    sections.push({ take, songs: kept, first, left: out })
    first += kept.length
  }
  return sections
}

/** Every song the tray holds, in the order it will play. */
export function trayOrder(sections: readonly TraySection[]): number[] {
  return sections.flatMap(section => section.songs.map(song => song.id))
}
