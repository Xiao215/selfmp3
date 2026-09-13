import { formatLongDuration, type Song, type Tag } from '@selfmp3/shared'

/**
 * The tag inbox, without the screen: the web's `TagInboxView` rules.
 *
 * Tags are how this library is browsed, so a song without one is a song only
 * ever found by searching, and every import adds more. The inbox counts them;
 * tagging goes through them one at a time, the song playing while its tags are
 * picked.
 */

/** Where this device keeps whether tagging plays each song as it comes up. */
export const PLAY_ALONG_KEY = 'triage-play-along'

export function isUntagged(song: Pick<Song, 'tagIds' | 'missing'>): boolean {
  return song.tagIds.length === 0 && !song.missing
}

/** Newest first: what was just imported is what most needs a tag. */
export function untaggedSongs<T extends Pick<Song, 'id' | 'tagIds' | 'missing' | 'addedAt'>>(
  songs: readonly T[],
): T[] {
  return songs.filter(isUntagged).sort((a, b) => b.addedAt.localeCompare(a.addedAt) || b.id - a.id)
}

/** "3 songs without a tag · 11 min · newest first". */
export function inboxSubtitle(
  loading: boolean,
  untagged: readonly Pick<Song, 'duration'>[],
): string {
  if (loading) return 'Loading…'
  if (untagged.length === 0) return 'Every song has a tag'
  const seconds = untagged.reduce((sum, song) => sum + song.duration, 0)
  return `${untagged.length} ${untagged.length === 1 ? 'song' : 'songs'} without a tag · ${formatLongDuration(seconds)} · newest first`
}

/**
 * The order tags keep for a whole session, most used first: the number for
 * "chill" is the same on the fortieth song as on the first.
 */
export function tagOrder(tags: readonly Pick<Tag, 'id' | 'name' | 'songCount'>[]): number[] {
  return [...tags]
    .sort((a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name))
    .map(tag => tag.id)
}

/** The tags in the session's order, with any made since at the end. */
export function orderedTags<T extends Pick<Tag, 'id'>>(
  order: readonly number[],
  tags: readonly T[],
): T[] {
  const byId = new Map(tags.map(tag => [tag.id, tag]))
  const known = order.flatMap(id => {
    const tag = byId.get(id)
    return tag ? [tag] : []
  })
  return [...known, ...tags.filter(tag => !order.includes(tag.id))]
}

/** 1–9 pick the first nine tags. */
export function tagForKey<T>(key: string, ordered: readonly T[]): T | undefined {
  return /^[1-9]$/.test(key) ? ordered[Number(key) - 1] : undefined
}

export function toggled(current: ReadonlySet<number>, tagId: number): ReadonlySet<number> {
  const next = new Set(current)
  if (next.has(tagId)) next.delete(tagId)
  else next.add(tagId)
  return next
}

/** A typed name that already exists is that tag, whatever its case. */
export function existingTag<T extends Pick<Tag, 'name'>>(
  tags: readonly T[],
  name: string,
): T | undefined {
  const wanted = name.trim().toLowerCase()
  return wanted ? tags.find(tag => tag.name.toLowerCase() === wanted) : undefined
}

/** What moving on is called: the last song finishes; a song left untagged is skipped. */
export function nextLabel(
  index: number,
  total: number,
  tagCount: number,
): 'Finish' | 'Next' | 'Skip' {
  if (index >= total - 1) return 'Finish'
  return tagCount === 0 ? 'Skip' : 'Next'
}

/** The end of a session: how many were tagged, and what is left for next time. */
export function sessionSummary(
  queue: readonly Pick<Song, 'id' | 'tagIds'>[],
  applied: ReadonlyMap<number, ReadonlySet<number>>,
): { title: string; hint: string } {
  if (queue.length === 0)
    return { title: 'Nothing left to tag', hint: 'Every song you went through has a tag now.' }
  const tagged = queue.filter(song => (applied.get(song.id)?.size ?? song.tagIds.length) > 0).length
  const left = queue.length - tagged
  return {
    title: `Tagged ${tagged} of ${queue.length}`,
    hint:
      left > 0
        ? `${left} still untagged — they stay in the list for next time.`
        : 'Every song you went through has a tag now.',
  }
}
