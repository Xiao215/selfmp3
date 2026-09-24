import { useEffect, useState } from 'react'
import { neutralWash, songColors, tileTone, type SongColors } from '@selfmp3/client'
import { hasColour, hueFromString, pickCoverTone, type CoverTone, type Song } from '@selfmp3/shared'
import { readCoverPixels } from '../ports/coverPixels'
import { useAccent } from './accent'

/* Covers read on this device: one read per key for the session. */
const tones = new Map<string, CoverTone | null>()

/**
 * The colour read from a cover on this device, or null until it has been —
 * and null for good where the platform cannot read pixels.
 *
 * `key` is what the answer is remembered by: a song's id and revision. `read`
 * false leaves the cover alone — the server has already said what colour it
 * is. A cover that failed to load is not remembered, so it is tried afresh the
 * next time it is asked for.
 */
function useCoverTone(key: string | null, uri: string | null, read: boolean): CoverTone | null {
  const [, setRead] = useState(0)
  const unread = read && key !== null && uri !== null && !tones.has(key)

  useEffect(() => {
    if (!unread || !key || !uri) return undefined
    let cancelled = false
    void readCoverPixels(uri).then(pixels => {
      if (!pixels) return
      tones.set(key, pickCoverTone(pixels))
      if (!cancelled) setRead(count => count + 1)
    })
    return () => {
      cancelled = true
    }
  }, [unread, key, uri])

  return key ? (tones.get(key) ?? null) : null
}

/**
 * The colours to draw a playing song in: from its cover where it has one, from
 * its letter tile where it has not.
 *
 * The server picks a cover's colour once and sends it with the song, so this
 * is usually just arithmetic. A song the server has not read yet is read here
 * where the platform can (a canvas, in a browser). Until then the accent
 * stands in. A cover with no colour in it washes the row in its own grey and
 * keeps the accent for the text, so it still reads as playing, not selected.
 *
 * Only asked for the song that is playing — its row, the player bar, the mini
 * player — never for a whole list.
 */
export function useSongColor(song: Song | null, uri: string | null): SongColors {
  const accent = useAccent()
  const sent = song?.coverTone ?? null
  const read = useCoverTone(
    song ? `${song.id}:${song.rev}` : null,
    uri,
    song !== null && song.hasArt && sent === null,
  )

  if (song && !song.hasArt) return songColors(tileTone(hueFromString(song.album || song.title)))
  return colorsOf(sent ?? read, accent.accent)
}

function colorsOf(tone: CoverTone | null, accent: string): SongColors {
  if (!tone) return { color: accent, tint: accent }
  return hasColour(tone) ? songColors(tone) : { color: neutralWash(tone), tint: accent }
}

/**
 * The colours to draw in for a colour already read: a song on the import
 * review, whose cover the server reads when it plays (ImportListen.tsx). The
 * accent until there is one, or where the cover has no colour of its own.
 */
export function useToneColors(tone: CoverTone | null): SongColors {
  return colorsOf(tone, useAccent().accent)
}
