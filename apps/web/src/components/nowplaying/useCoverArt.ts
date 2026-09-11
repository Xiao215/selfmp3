import { useEffect, useState } from 'react'
import type { Song } from '@selfmp3/shared'
import { mediaUrl } from '../../lib/api.js'
import { paletteFromPixels, placeholderPalette, type Rgb } from '../../lib/visuals.js'

type Palette = readonly [Rgb, Rgb, Rgb]

interface CoverArt {
  /** The loaded artwork for canvas drawing, or null for a song without any. */
  readonly image: HTMLImageElement | null
  readonly palette: Palette
}

/* One read per cover, not one per mount: switching tabs should not re-sample it. */
const palettes = new Map<string, Palette>()

/**
 * A song's artwork, and the colours the page and the visuals take from it.
 *
 * The colours come from a 24-pixel thumbnail drawn in the browser — the art is
 * served by our own server, so the canvas can read it back. Until it loads, and
 * for a song with no art at all, the palette follows the hue the placeholder
 * cover already uses, so the page never flashes a colour it then drops.
 */
export function useCoverArt(song: Pick<Song, 'id' | 'hasArt' | 'rev'> | null): CoverArt {
  const key = song ? `${song.id}:${song.rev ?? ''}` : ''
  const fallback = song ? placeholderPalette(song.id) : placeholderPalette(0)
  const [art, setArt] = useState<CoverArt>({ image: null, palette: palettes.get(key) ?? fallback })

  useEffect(() => {
    if (!song) return
    const initial = palettes.get(key) ?? placeholderPalette(song.id)
    setArt({ image: null, palette: initial })
    if (!song.hasArt) return

    let cancelled = false
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (cancelled) return
      let palette = palettes.get(key)
      if (!palette) {
        palette = sample(image) ?? initial
        palettes.set(key, palette)
      }
      setArt({ image, palette })
    }
    image.src = mediaUrl.art(song.id, song.rev)
    return () => {
      cancelled = true
    }
    // `key` covers the id and the revision; the rest of the song is irrelevant.
  }, [key])

  return art
}

function sample(image: HTMLImageElement): Palette | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 24
    canvas.height = 24
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(image, 0, 0, 24, 24)
    return paletteFromPixels(ctx.getImageData(0, 0, 24, 24).data)
  } catch {
    // A cover the canvas may not read back (served from elsewhere): keep the fallback.
    return null
  }
}
