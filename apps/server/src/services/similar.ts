import { songDistance, type Song } from '@selfmp3/shared'

/**
 * Nearest neighbours for "similar songs".
 *
 * A brute-force pass over the library: with a few thousand songs and a
 * distance that is a handful of subtractions, this is microseconds, and an
 * index would be more code than the feature. Missing files are left out —
 * a recommendation you cannot play is worse than none.
 */
export function similarSongs(seed: Song, library: readonly Song[], limit: number): Song[] {
  const scored: Array<{ song: Song; distance: number }> = []

  for (const candidate of library) {
    if (candidate.id === seed.id || candidate.missing) continue
    scored.push({ song: candidate, distance: songDistance(seed, candidate) })
  }

  scored.sort((a, b) => a.distance - b.distance || a.song.id - b.song.id)
  return scored.slice(0, Math.max(0, limit)).map(entry => entry.song)
}
