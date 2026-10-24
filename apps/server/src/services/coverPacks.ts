import type { CloudCoverPack } from '@selfmp3/shared'

/**
 * Which covers go in which pack (`CloudCoverPackSchema`): pure, so the rules
 * can be tested without a bucket or a disk.
 *
 * Every read from the bucket is one of the day's allowance, and a device with
 * no covers yet used to read every one of them alone — over half the day's
 * reads for a library of 1,500 songs, again for every new device and every
 * friend let in. A pack is a few megabytes of covers end to end, so the same
 * device reads a file per pack instead; each cover is still in the bucket on
 * its own, for the one that is wanted alone.
 *
 * A pack is never changed, only replaced — it is named by its hash — and
 * devices keep what they unpack by each cover's own key, never by the pack,
 * so making packs again costs a device that has the covers nothing. The rules:
 *
 *  - a pack of at least `PACK_TARGET_BYTES` is full, and stays as it is while
 *    at least half its bytes are covers the library still names. Below that it
 *    is made again, its live covers packed with the rest;
 *  - the covers in no full pack go in packs of their own, `PACK_TARGET_BYTES`
 *    at a time, in key order, the last of them short: the tail — unless it
 *    would be one cover, which a device fetches alone anyway. Made from the
 *    same covers, a tail comes out the same file, under the same key, so an
 *    unchanged library is not packed again — and while nothing new has come
 *    and nothing in it has gone, the tail is kept without being made again;
 *  - only covers whose bytes this server has can be packed. A pack holding one
 *    it does not have (taken on from the bucket, say) is kept as it is, since
 *    it could not be made again.
 */

/**
 * How big a pack is made. Big enough that a library of 1,500 covers at about
 * 100 KB each is some twenty reads, small enough that a phone on mobile data
 * fetching one it barely needs has not wasted much, and that each is a single
 * quick download rather than one a dropped connection is likely to cut.
 */
const PACK_TARGET_BYTES = 8 * 1024 * 1024

/** A full pack whose live covers are less than this share of its bytes is made again. */
const LIVE_SHARE_KEPT = 0.5

interface CoverPackPlan {
  /** Packs kept as they are. */
  readonly kept: readonly CloudCoverPack[]
  /** Covers to pack anew: each group one new pack, in order. */
  readonly groups: readonly (readonly { readonly key: string; readonly size: number }[])[]
}

/**
 * What to pack, given every picture the library names (`live`, key → size),
 * the packs the bucket has, and which pictures this server could read.
 */
export function planCoverPacks(
  live: ReadonlyMap<string, number>,
  packs: readonly CloudCoverPack[],
  readable: (key: string) => boolean,
  target: number = PACK_TARGET_BYTES,
): CoverPackPlan {
  const kept: CloudCoverPack[] = []
  const packed = new Set<string>()
  const tails: { pack: CloudCoverPack; live: string[]; whole: boolean }[] = []

  const keep = (pack: CloudCoverPack, members: readonly string[]): void => {
    kept.push(pack)
    for (const key of members) packed.add(key)
  }

  for (const pack of packs) {
    // A cover in two packs counts in the first.
    const members = pack.covers.filter(([key]) => live.has(key) && !packed.has(key))
    if (members.length === 0) continue
    const keys = members.map(([key]) => key)
    if (!keys.every(readable)) {
      keep(pack, keys)
      continue
    }
    if (pack.size >= target) {
      const liveBytes = members.reduce((sum, [, size]) => sum + size, 0)
      if (liveBytes >= pack.size * LIVE_SHARE_KEPT) keep(pack, keys)
      continue
    }
    tails.push({ pack, live: keys, whole: members.length === pack.covers.length })
  }

  // Nothing new and nothing gone: the tails stay as they are, without being
  // read and made again only to come out the same.
  const inTails = new Set(tails.flatMap(tail => tail.live))
  const fresh = [...live.keys()].some(key => !packed.has(key) && !inTails.has(key) && readable(key))
  if (!fresh && tails.every(tail => tail.whole)) {
    for (const tail of tails) keep(tail.pack, tail.live)
  }

  const pool = [...live.keys()].filter(key => !packed.has(key) && readable(key)).sort()
  const groups: { key: string; size: number }[][] = []
  let group: { key: string; size: number }[] = []
  let bytes = 0
  for (const key of pool) {
    const size = live.get(key) ?? 0
    group.push({ key, size })
    bytes += size
    if (bytes >= target) {
      groups.push(group)
      group = []
      bytes = 0
    }
  }
  if (group.length > 1) groups.push(group)
  return { kept, groups }
}
