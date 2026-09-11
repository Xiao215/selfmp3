import { useMemo } from 'react'
import type { SongFeatures } from '@selfmp3/shared'
import { energyWavePath } from '../lib/energyWave.js'

/**
 * Tempo and energy, quietly, after the artist.
 *
 * Tempo is written the way a score writes it — ♩ = 130 — rather than as a
 * bare number that could be a play count. Energy is a small waveform drawn
 * straight from the analysed value: taller and denser as a song gets more
 * intense. The key stays off the row; it is in Song details, and the queue
 * shows it while auto-mix is using it to order songs.
 *
 * Deliberately quiet: this sits on every song row, so it must read as a
 * detail you can find when you want it. Renders nothing at all for a song
 * that has not been analysed, rather than a row of dashes.
 */
export function FeatureBadges({
  features,
  size = 'small',
  showKey = false,
}: {
  features: SongFeatures | null
  size?: 'small' | 'large'
  /** The Camelot key, for the auto-mix queue — the one place it explains something. */
  showKey?: boolean
}) {
  if (!features) return null
  const { bpm, energy } = features
  const key = showKey ? features.camelot : null
  if (bpm == null && energy == null && key == null) return null

  return (
    <span className={`feature-badges is-${size}`} title={describeFeatures(features)}>
      {bpm != null && <span className="feature-tempo">{tempoMark(bpm)}</span>}
      {key != null && (
        <span
          className={`feature-badge feature-key ${key.endsWith('A') ? 'is-minor' : 'is-major'}`}
        >
          {key}
        </span>
      )}
      {energy != null && (
        <EnergyWave
          energy={energy}
          width={size === 'large' ? 34 : 22}
          height={size === 'large' ? 16 : 12}
        />
      )}
    </span>
  )
}

/**
 * No-break spaces: the marking never splits across a wrap. Full width rather
 * than thin, because the \u2669 often comes from a fallback font and a thin space
 * beside it all but disappears.
 */
const THIN = '\u00a0'

/** ♩ = 130, set like a metronome marking. */
export function tempoMark(bpm: number): string {
  return `♩${THIN}=${THIN}${Math.round(bpm)}`
}

/** The waveform on its own, for Song details and anywhere else energy is shown. */
export function EnergyWave({
  energy,
  width = 22,
  height = 12,
}: {
  energy: number
  width?: number
  height?: number
}) {
  const path = useMemo(() => energyWavePath(energy, width, height), [energy, width, height])
  return (
    <svg
      className="energy-wave"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`Energy ${Math.round(energy * 100)} of 100`}
    >
      <path d={path} />
    </svg>
  )
}

/** The same facts in words, for the hover text on a desktop. */
function describeFeatures(features: SongFeatures): string {
  const parts: string[] = []
  if (features.bpm != null) parts.push(`${Math.round(features.bpm)} beats a minute`)
  if (features.energy != null) parts.push(`energy ${Math.round(features.energy * 100)} of 100`)
  return parts.join(' · ')
}
