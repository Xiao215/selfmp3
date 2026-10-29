/**
 * A copy of the library a device kept before the snapshot's shape was settled,
 * brought up to it.
 *
 * A snapshot once could leave out a song's `motion`, `audioFeatures` and
 * `coverTone`, the snapshot's `upTo`, `artists`, `sound`, `artistNames`,
 * `spellings` and `coverPacks`, and its server's `id`, and a device
 * kept what it had read, so its copy can lack any of them. Thrown away and
 * fetched again instead, such a copy left a phone on a day the bucket refused
 * reads with no library at all, while every song it had downloaded sat on its
 * disk.
 *
 * The copy is migrated instead, with the same answers the old schema gave:
 * a field left out is null (or empty), a cover colour without a palette is
 * no colour, and a server that did not name itself is no server — the next
 * snapshot names it. Data, not a second reading of the schema: once upgraded, the copy
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
      artistNames: snapshot['artistNames'] ?? [],
      spellings: snapshot['spellings'] ?? {},
      coverPacks: snapshot['coverPacks'] ?? [],
      server: named(snapshot['server']),
      songs,
    },
  }
}

function named(server: unknown): unknown {
  return isRecord(server) && server['id'] === undefined ? undefined : server
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
