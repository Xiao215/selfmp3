import { formatFeatures, type SongFeatures } from '@selfmp3/shared'

/**
 * BPM · key · energy, as small muted badges.
 *
 * Deliberately quiet: this sits on every song row, so it must read as a
 * detail you can find when you want it, not as a third line of metadata
 * shouting at you. Renders nothing at all for a song that has not been
 * analysed, rather than a row of dashes.
 */
export function FeatureBadges({
  features,
  size = 'small',
}: {
  features: SongFeatures | null
  size?: 'small' | 'large'
}) {
  if (!features) return null
  const hasAnything = features.bpm != null || features.camelot != null || features.energy != null
  if (!hasAnything) return null

  return (
    <span className={`feature-badges is-${size}`} title={formatFeatures(features)}>
      {features.bpm != null && (
        <span className="feature-badge feature-bpm">{Math.round(features.bpm)}</span>
      )}
      {features.camelot != null && (
        <span
          className={`feature-badge feature-key ${features.camelot.endsWith('A') ? 'is-minor' : 'is-major'}`}
        >
          {features.camelot}
        </span>
      )}
      {features.energy != null && (
        <span
          className="feature-badge feature-energy"
          aria-label={`Energy ${Math.round(features.energy * 100)}%`}
        >
          <span style={{ width: `${Math.round(features.energy * 100)}%` }} />
        </span>
      )}
    </span>
  )
}
