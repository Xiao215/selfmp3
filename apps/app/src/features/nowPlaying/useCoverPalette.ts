import { useEffect, useState } from 'react'
import { placeholderPalette, type Palette } from '@selfmp3/client'
import type { Song } from '@selfmp3/shared'
import { sampleCoverPalette } from '../../ports/coverPalette'

/* One read per cover, not one per mount: switching tabs should not re-sample it. */
const palettes = new Map<string, Palette>()

/**
 * The three colours a song's page glows with.
 *
 * Until the cover is read, and for a song with no art or on a platform that
 * can't read it, the palette follows the hue the letter tile already uses.
 */
export function useCoverPalette(song: Song, uri: string | null): Palette {
  const key = `${song.id}:${song.rev ?? ''}`
  const [, setRead] = useState(0)

  useEffect(() => {
    if (!uri || palettes.has(key)) return undefined
    let cancelled = false
    void sampleCoverPalette(uri).then(palette => {
      if (!palette || cancelled) return
      palettes.set(key, palette)
      setRead(count => count + 1)
    })
    return () => {
      cancelled = true
    }
  }, [key, uri])

  return palettes.get(key) ?? placeholderPalette(song.id)
}
