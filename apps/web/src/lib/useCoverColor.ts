import { useEffect, useState } from 'react'
import type { Song } from '@selfmp3/shared'
import { mediaUrl } from './api.js'
import { pickCoverColor, placeholderColor, type CoverColor } from './coverColor.js'

/**
 * The colour of a song's cover, for tinting what is playing.
 *
 * The cover is already cached (the list just showed it), so reading it back
 * is one small image decode and a 24×24 canvas: well under a millisecond of
 * arithmetic. Results are kept per song and cover revision for the session,
 * so going back to a song costs nothing.
 *
 * Only asked for the playing song — the one row, the player bar and the mini
 * player — never for a whole list.
 */

const SAMPLE = 24
const known = new Map<string, CoverColor | null>()

type CoverSong = Pick<Song, 'id' | 'hasArt' | 'rev'>

const keyOf = (song: CoverSong): string => `${song.id}:${song.rev ?? ''}`

async function readCoverColor(song: CoverSong): Promise<CoverColor | null> {
  const image = new Image()
  image.decoding = 'async'
  image.src = mediaUrl.art(song.id, song.rev)
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE
  canvas.height = SAMPLE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, SAMPLE, SAMPLE)
  return pickCoverColor(context.getImageData(0, 0, SAMPLE, SAMPLE).data)
}

/**
 * Null until the cover has been read, and for a cover with no real colour
 * in it — callers fall back to the app's accent in both cases.
 */
export function useCoverColor(song: CoverSong | null, enabled = true): CoverColor | null {
  const active = enabled && song !== null
  const key = song ? keyOf(song) : ''
  const [color, setColor] = useState<CoverColor | null>(() =>
    active && song ? (song.hasArt ? (known.get(key) ?? null) : placeholderColor(song.id)) : null,
  )

  useEffect(() => {
    if (!active || !song) {
      setColor(null)
      return
    }
    if (!song.hasArt) {
      setColor(placeholderColor(song.id))
      return
    }
    if (known.has(key)) {
      setColor(known.get(key) ?? null)
      return
    }

    let cancelled = false
    let retry: number | undefined
    setColor(null)

    const read = (attemptsLeft: number): void => {
      readCoverColor(song)
        .then(found => {
          known.set(key, found)
          if (!cancelled) setColor(found)
        })
        .catch(() => {
          // A request can die on its way (the page starting up, a service
          // worker being replaced): try again shortly, then settle for the
          // accent. A cover that truly will not load is not remembered, so the
          // next time the song plays it is tried afresh.
          if (!cancelled && attemptsLeft > 0)
            retry = window.setTimeout(() => read(attemptsLeft - 1), 2000)
        })
    }
    read(2)

    return () => {
      cancelled = true
      window.clearTimeout(retry)
    }
    // `key` stands for the song's id and cover revision: a new object for the
    // same song (every library refetch makes one) must not read it again.
  }, [active, key])

  return color
}

/** The CSS custom properties the tinted styles read. */
export function coverColorStyle(color: CoverColor | null): React.CSSProperties | undefined {
  if (!color) return undefined
  return { '--song-color': color.color, '--song-tint': color.tint } as React.CSSProperties
}
