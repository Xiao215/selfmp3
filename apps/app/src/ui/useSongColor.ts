import { useEffect, useState } from 'react'
import { songColors, tileTone, type SongColors } from '@selfmp3/client'
import { hueFromString, pickCoverTone, type CoverTone, type Song } from '@selfmp3/shared'
import { readCoverPixels } from '../ports/coverPixels'
import { useAccent } from './accent'

/* Covers read on this device, one read per cover revision for the session. */
const tones = new Map<string, CoverTone | null>()

/**
 * The colours to draw a playing song in: from its cover where it has one, from
 * its letter tile where it has not.
 *
 * The server picks a cover's colour once and sends it with the song, so this
 * is usually just arithmetic. A song the server has not read yet is read here
 * where the platform can (a canvas, in a browser). Until then, and for a cover
 * with no colour in it, the accent stands in.
 *
 * Only asked for the song that is playing — its row, the player bar, the mini
 * player — never for a whole list.
 */
export function useSongColor(song: Song | null, uri: string | null): SongColors {
  const accent = useAccent()
  const key = song ? `${song.id}:${song.rev}` : ''
  const [, setRead] = useState(0)
  const sent = song?.coverTone ?? null
  const unread = song !== null && song.hasArt && sent === null && uri !== null && !tones.has(key)

  useEffect(() => {
    if (!unread || !uri) return undefined
    let cancelled = false
    void readCoverPixels(uri).then(pixels => {
      // Not remembered when nothing could be read: a cover that failed to load
      // is tried afresh the next time the song plays.
      if (!pixels) return
      tones.set(key, pickCoverTone(pixels))
      if (!cancelled) setRead(count => count + 1)
    })
    return () => {
      cancelled = true
    }
  }, [unread, key, uri])

  if (song && !song.hasArt) return songColors(tileTone(hueFromString(song.album || song.title)))
  const tone = sent ?? (song ? tones.get(key) : null)
  return tone ? songColors(tone) : { color: accent.accent, tint: accent.accent }
}
