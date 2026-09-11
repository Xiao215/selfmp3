import { useState } from 'react'
import type { Song } from '@selfmp3/shared'
import { mediaUrl } from '../lib/api.js'

/**
 * Album art, with a generated fallback.
 *
 * A lot of downloaded audio has no embedded art, and a grid of identical grey
 * placeholders is genuinely hard to scan. Deriving a stable gradient from the
 * song id means every track looks distinct and looks the same every time,
 * which is enough for the eye to use as a landmark.
 */
export function Cover({
  song,
  size = 40,
  className = '',
}: {
  song: Pick<Song, 'id' | 'title' | 'hasArt' | 'rev'>
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (song.hasArt && !failed) {
    return (
      <img
        className={`cover ${className}`}
        style={{ width: size, height: size }}
        src={mediaUrl.art(song.id, song.rev)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }

  // Golden-angle stepping spreads consecutive ids across the colour wheel
  // instead of clustering them.
  const hue = (song.id * 137.508) % 360
  const initial = (song.title.trim()[0] ?? '?').toUpperCase()

  return (
    <div
      className={`cover cover-placeholder ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.38),
        background: `linear-gradient(140deg,
          oklch(0.42 0.09 ${hue}),
          oklch(0.24 0.06 ${(hue + 45) % 360}))`,
      }}
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}
