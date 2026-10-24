import { coverPackMembers, type CloudCoverPack } from '@selfmp3/shared'

/**
 * Which of the bucket's packs of covers (`CloudCoverPackSchema`) are worth
 * fetching whole: pure, so the rule can be tested without a bucket.
 *
 * A pack is one read for many covers, where fetching them alone is a read
 * each, and every read is one of the bucket's day. So a device with none of a
 * pack's covers fetches the pack. One missing only a few — a song or two added
 * since it last filled — fetches those alone instead: a few reads rather than
 * one, but not megabytes of covers it already has, on what may be mobile data.
 */

/** A pack is fetched for this many covers it is missing, however small they are. */
const MANY_MISSING = 8

/** …or for fewer, when they are at least this share of its bytes. */
const MISSING_SHARE = 0.25

/** One picture to cut out of a pack: the name it is kept under, and where it is in the file. */
export interface PackSlice {
  /** `<sha256>.<ext>`, as a bucket picture is kept on a device. */
  readonly name: string
  readonly at: number
  readonly size: number
}

interface PackFetch {
  readonly pack: CloudCoverPack
  /** The pictures to keep from it: those wanted and not here. */
  readonly slices: readonly PackSlice[]
  /** Their keys, so a pack that could not be had says which pictures it was to bring. */
  readonly keys: readonly string[]
}

/** `4f1c….jpg` from `covers/4f1c….jpg`: the hash is already the name. */
export function nameFromKey(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

/**
 * The packs to fetch for the pictures `wanted` (by key), given which this
 * device already has (by name). A picture in two packs is fetched with the
 * first; what no pack is worth fetching for is left to be fetched alone.
 */
export function packsToFetch(
  packs: readonly CloudCoverPack[],
  wanted: ReadonlySet<string>,
  have: (name: string) => boolean,
): PackFetch[] {
  const claimed = new Set<string>()
  const fetches: PackFetch[] = []
  for (const pack of packs) {
    const missing = coverPackMembers(pack).filter(
      member =>
        wanted.has(member.key) && !claimed.has(member.key) && !have(nameFromKey(member.key)),
    )
    if (missing.length < 2) continue
    const bytes = missing.reduce((sum, member) => sum + member.size, 0)
    if (missing.length < MANY_MISSING && bytes < pack.size * MISSING_SHARE) continue
    for (const member of missing) claimed.add(member.key)
    fetches.push({
      pack,
      slices: missing.map(member => ({
        name: nameFromKey(member.key),
        at: member.at,
        size: member.size,
      })),
      keys: missing.map(member => member.key),
    })
  }
  return fetches
}

/** Whether `name` (`<sha256>.<ext>`) is the name of bytes whose SHA-256 is `digest`. */
export function namesDigest(name: string, digest: ArrayBuffer): boolean {
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return name.startsWith(`${hex}.`)
}
