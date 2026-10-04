import { z } from 'zod/v4'
import {
  TAG_NAME_MAX,
  type Song,
  type Tag,
  type TagSuggestion,
  type TagSuggestions,
} from '@selfmp3/shared'
import { mainArtist, tagCatalog } from './library.js'
import { Remembered, type Llm } from './llm.js'

/**
 * A7 · Suggest tags (docs/features/ai.md).
 *
 * Group, ask the library, then ask the model. Untagged songs are grouped by
 * who they are mostly by, so an artist is judged once rather than per song. A
 * song whose album or artist is already tagged one way takes that tag with no
 * model at all; the model is only asked about the groups the library cannot
 * answer for, and only ever offered your own tags, plus one new name when the
 * library's own pattern calls for it.
 */

/** Groups per model call: about 60 tokens each, so a call stays small and quick. */
const GROUPS_PER_CALL = 50
const VERSION = 1

const AnswerOut = z.object({
  groups: z
    .array(
      z.object({
        g: z.string(),
        tags: z.array(z.string()).max(2),
        newTag: z.string().nullable(),
        sure: z.enum(['high', 'medium', 'low']),
        why: z.string().max(140),
      }),
    )
    .max(GROUPS_PER_CALL),
})

const SYSTEM = `You suggest tags for songs in someone's own music library that have no tag yet.

You are given their tags, each with what it already holds (who it is mostly by, which albums), and groups of untagged songs, each group by one artist with its albums and a few titles. Their tags are their own vocabulary: a tag means what it holds, not what the word usually means.

For every group, reply with:
- g: the group's id, exactly as given.
- tags: at most two tag names from their list, copied exactly, that these songs belong in by the same logic as the songs already there (language and scene, game or show, period, genre). Empty if none fits.
- newTag: a new tag name only when their own tags clearly follow a pattern that this group extends but no tag covers yet (for example, they tag each region of a game separately and this album is a region without a tag). Otherwise null. Never suggest a new tag merely because no existing tag fits.
- sure: high when you know this artist and the fit is plain, medium when it is likely, low when you are guessing.
- why: at most twelve plain words for the person, about the songs (for example "Mandarin pop, like the songs already in 中文流行").

Reply with JSON only, one entry per group.`

interface SuggestTagsDeps {
  readonly llm: Llm
  readonly songs: () => Song[]
  readonly tags: () => Tag[]
  readonly remembered?: Remembered
}

interface Group {
  readonly ref: string
  readonly artist: string
  readonly songs: Song[]
}

const lower = (value: string): string => value.toLowerCase()

function tally(values: Iterable<string>): [string, number][] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** "周杰倫 76, 薛之谦 12, +8 more". */
export function whoOf(songs: readonly Song[]): string {
  const counts = tally(songs.map(song => mainArtist(song.artist)))
  const shown = counts.slice(0, 3).map(([name, n]) => (songs.length === 1 ? name : `${name} ${n}`))
  const rest = counts.length - 3
  return rest > 0 ? `${shown.join(', ')}, +${rest} more` : shown.join(', ')
}

/**
 * The tag the library itself gives a song: the one every tagged song on its
 * album shares, or else the one at least four in five of its artist's tagged
 * songs share (with two at the least, so one stray song decides nothing).
 */
export function fromLibrary(
  song: Song,
  tagged: readonly Song[],
  tags: readonly Tag[],
): { tag: Tag; why: string } | null {
  const byId = new Map(tags.map(tag => [tag.id, tag]))
  const shared = (others: readonly Song[], share: number, least: number): Tag | null => {
    if (others.length < least) return null
    const counts = tally(others.flatMap(other => other.tagIds.map(String)))
    const [id, n] = counts[0] ?? []
    if (id === undefined || n === undefined || n / others.length < share) return null
    return byId.get(Number(id)) ?? null
  }

  if (song.album) {
    const onAlbum = tagged.filter(other => lower(other.album) === lower(song.album))
    const tag = shared(onAlbum, 1, 1)
    if (tag) return { tag, why: `The rest of ${song.album} is in ${tag.name}` }
  }
  const artist = lower(mainArtist(song.artist))
  const byArtist = tagged.filter(other => lower(mainArtist(other.artist)) === artist)
  const tag = shared(byArtist, 0.8, 2)
  if (tag) return { tag, why: `${mainArtist(song.artist)}’s other songs are in ${tag.name}` }
  return null
}

function groupLine(group: Group): string {
  const albums = tally(group.songs.map(song => song.album).filter(Boolean))
  const titles = group.songs.slice(0, 5).map(song => song.title)
  return [
    group.ref,
    group.artist,
    `${group.songs.length} song${group.songs.length === 1 ? '' : 's'}`,
    albums.length
      ? `albums: ${albums
          .slice(0, 6)
          .map(([name, n]) => `${name} ${n}`)
          .join(', ')}`
      : 'no album',
    `e.g. ${titles.join(' / ')}`,
  ].join(' | ')
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function suggestTags(deps: SuggestTagsDeps): Promise<TagSuggestions> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const tags = deps.tags()
  const untagged = songs.filter(song => song.tagIds.length === 0)
  const tagged = songs.filter(song => song.tagIds.length > 0)

  /**
   * Suggestions as they gather, one per tag however many groups and sources
   * lead to it: a tag is one decision. It is the library's suggestion only
   * when the library alone made it.
   */
  const gathered = new Map<
    string,
    {
      tag: string
      isNew: boolean
      from: 'library' | 'model'
      songs: Song[]
      whys: Map<string, number>
    }
  >()
  const add = (
    tag: string,
    isNew: boolean,
    from: 'library' | 'model',
    group: readonly Song[],
    why: string,
  ): void => {
    const key = lower(tag)
    const entry = gathered.get(key) ?? {
      tag,
      isNew,
      from,
      songs: [],
      whys: new Map<string, number>(),
    }
    if (from === 'model') entry.from = 'model'
    for (const song of group) if (!entry.songs.includes(song)) entry.songs.push(song)
    entry.whys.set(why, (entry.whys.get(why) ?? 0) + group.length)
    gathered.set(key, entry)
  }

  // 1 · The library answers for what it can.
  const left: Song[] = []
  for (const song of untagged) {
    const found = fromLibrary(song, tagged, tags)
    if (found) add(found.tag.name, false, 'library', [song], found.why)
    else left.push(song)
  }

  // 2 · The rest, by who they are mostly by.
  const byArtist = new Map<string, Song[]>()
  for (const song of left) {
    const key = lower(mainArtist(song.artist))
    byArtist.set(key, [...(byArtist.get(key) ?? []), song])
  }
  const groups: Group[] = [...byArtist.values()]
    .sort((a, b) => b.length - a.length)
    .map((group, index) => ({
      ref: `g${index + 1}`,
      artist: mainArtist(group[0]!.artist),
      songs: group,
    }))

  const unsure: TagSuggestions['unsure'] = []
  if (groups.length > 0) {
    const catalog = tagCatalog(songs, tags)
    const answers = await Promise.all(
      chunks(groups, GROUPS_PER_CALL).map(chunk => {
        const prompt = `Their tags:\n${catalog}\n\nUntagged groups (id | artist | songs | albums | titles):\n${chunk.map(groupLine).join('\n')}`
        return remembered.get(
          Remembered.key('suggest-tags', VERSION, prompt),
          async () =>
            (
              await deps.llm.generate({
                task: 'suggest-tags',
                tier: 'smart',
                system: SYSTEM,
                prompt,
                schema: AnswerOut,
              })
            ).value,
        )
      }),
    )

    // 3 · The check: groups it was shown, tags that exist, one new name at most.
    const byRef = new Map(groups.map(group => [group.ref, group]))
    const answered = new Set<string>()
    for (const answer of answers.flatMap(each => each.groups)) {
      const group = byRef.get(answer.g)
      if (!group || answered.has(group.ref)) continue
      answered.add(group.ref)
      const existing = answer.tags
        .map(name => tags.find(tag => lower(tag.name) === lower(name)))
        .filter((tag): tag is Tag => tag !== undefined)
      const newName = answer.newTag?.trim().replace(/\s+/g, ' ') ?? ''
      const newMatch = newName ? tags.find(tag => lower(tag.name) === lower(newName)) : undefined
      const suggestions: { name: string; isNew: boolean }[] = existing.map(tag => ({
        name: tag.name,
        isNew: false,
      }))
      if (newMatch && !existing.includes(newMatch))
        suggestions.push({ name: newMatch.name, isNew: false })
      else if (newName && !newMatch && newName.length <= TAG_NAME_MAX)
        suggestions.push({ name: newName, isNew: true })

      if (answer.sure === 'low' || suggestions.length === 0) {
        unsure.push({
          songIds: group.songs.map(song => song.id),
          who: whoOf(group.songs),
          why: answer.why,
        })
        continue
      }
      for (const suggestion of suggestions)
        add(suggestion.name, suggestion.isNew, 'model', group.songs, answer.why)
    }
    for (const group of groups) {
      if (!answered.has(group.ref)) {
        unsure.push({
          songIds: group.songs.map(song => song.id),
          who: whoOf(group.songs),
          why: 'Not answered',
        })
      }
    }
  }

  const suggestions: TagSuggestion[] = [...gathered.values()]
    .map(entry => ({
      tag: entry.tag,
      isNew: entry.isNew,
      songIds: entry.songs.map(song => song.id),
      who: whoOf(entry.songs),
      // The reason that covers the most songs speaks for the row.
      why: [...entry.whys].sort((a, b) => b[1] - a[1])[0]![0],
      from: entry.from,
    }))
    .sort((a, b) => b.songIds.length - a.songIds.length || a.tag.localeCompare(b.tag))

  return { untagged: untagged.length, suggestions, unsure }
}
