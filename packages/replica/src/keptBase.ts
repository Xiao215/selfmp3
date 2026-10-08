/**
 * A copy of the library a device kept before the snapshot's shape was settled,
 * brought up to it.
 *
 * Until 2f590638 (2026-10-07) a snapshot could leave out a song's `motion`,
 * `audioFeatures` and `coverTone` and the snapshot's `upTo`, `artists` and
 * `sound`, and the schema filled them in as it read. A device kept what it had
 * read, so its copy can lack any of them. The schema stopped filling them in,
 * and such a copy was then thrown away and fetched again from the bucket —
 * which, on a day the bucket refuses reads, left a phone with no library at
 * all while every song it had downloaded sat on its disk (Xiao, 2026-10-08).
 *
 * The copy is migrated instead, with the same answers the old schema gave:
 * a field left out is null (or empty), and a cover colour without a palette is
 * no colour. Data, not a second reading of the schema: once upgraded, the copy
 * is written back and reads as any other.
 */
export function upgradeKeptBase(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value['snapshot'])) return value
  const snapshot = value['snapshot']
  const kept: unknown = snapshot['songs']
  const songs: unknown = Array.isArray(kept)
    ? kept.map((song: unknown) => (isRecord(song) ? upgradeSong(song) : song))
    : kept
  return {
    ...value,
    snapshot: {
      ...snapshot,
      upTo: snapshot['upTo'] ?? {},
      artists: snapshot['artists'] ?? [],
      sound: snapshot['sound'] ?? null,
      songs,
    },
  }
}

function upgradeSong(song: Record<string, unknown>): Record<string, unknown> {
  const tone = song['coverTone']
  return {
    ...song,
    motion: song['motion'] ?? null,
    audioFeatures: song['audioFeatures'] ?? null,
    coverTone: isRecord(tone) && tone['palette'] !== undefined ? tone : null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
