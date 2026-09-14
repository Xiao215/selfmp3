import { useEffect, useState } from 'react'
import { placeholderPalette, tonePalette, type Palette } from '@selfmp3/client'
import type { Song } from '@selfmp3/shared'
import { sampleCoverPalette } from '../../ports/coverPalette'

/* One read per cover, not one per mount: switching tabs should not re-sample it. */
const palettes = new Map<string, Palette>()
/* And one read at a time: the bar warming a cover and the stage asking for it share the read. */
const reads = new Map<string, Promise<Palette | null>>()

const keyOf = (song: Song): string => `${song.id}:${song.rev ?? ''}`

/**
 * Read a cover's colours ahead of the page that will glow with them.
 *
 * The player bar calls this as a song starts, so by the time Now Playing opens
 * the palette is already known and the page comes up in its own light rather
 * than in a stand-in for the frames the read takes.
 */
export function warmCoverPalette(song: Song, uri: string | null): Promise<Palette | null> {
  const key = keyOf(song)
  const known = palettes.get(key)
  if (known) return Promise.resolve(known)
  if (!uri) return Promise.resolve(null)
  const pending = reads.get(key)
  if (pending) return pending
  const read = sampleCoverPalette(uri)
    .then(palette => {
      if (palette) palettes.set(key, palette)
      return palette
    })
    .finally(() => reads.delete(key))
  reads.set(key, read)
  return read
}

/**
 * The three colours a song's page glows with.
 *
 * Until the cover is read, the palette is built from the tone the server sent
 * with the song, so the first frame is already the cover's hue; a song with
 * no tone, no art, or on a platform that can't read it follows the hue its
 * letter tile already uses.
 */
export function useCoverPalette(song: Song, uri: string | null): Palette {
  const key = keyOf(song)
  const [, setRead] = useState(0)

  useEffect(() => {
    if (palettes.has(key)) return undefined
    let cancelled = false
    void warmCoverPalette(song, uri).then(palette => {
      if (palette && !cancelled) setRead(count => count + 1)
    })
    return () => {
      cancelled = true
    }
    // The song is identified by its key; a re-render with the same song is not a new read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, uri])

  return (
    palettes.get(key) ??
    (song.coverTone ? tonePalette(song.coverTone) : placeholderPalette(song.id))
  )
}
