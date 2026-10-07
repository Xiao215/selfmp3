import { z } from 'zod/v4'
import {
  CJK,
  TAG_NAME_MAX,
  type Song,
  type Tag,
  type TagChange,
  type TagReview,
} from '@selfmp3/shared'
import { mainArtist, tagCatalog } from './library.js'
import { LlmError, llmFailureWords, Remembered, type Llm } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'
import { bare, chunks, tally } from './text.js'

/**
 * Tags (docs/features/ai.md): your tags put right, as changes to approve —
 * songs given a tag or taken out of one, a tag renamed, merged into another,
 * or deleted. What it looks at comes from what you asked ("tag the songs that
 * should be 中文流行", "merge chinese pop into 中文流行", "tidy my tags"), or,
 * from Tags' untagged card, the songs without a tag. Nothing here writes.
 *
 * The library first, with no model: a song whose album or artist is tagged one
 * way already, two tags spelled as one. Then the model, twice at most: once
 * over the tags alone (what to rename, merge or delete, and which songs the
 * request is about), and once over those songs in groups — by who they are
 * by, what they carry, and the script of their titles, so 林俊傑's English
 * songs are judged apart from his Mandarin ones and 周杰倫 is judged once, not
 * 76 times. Every name it returns is checked against the library.
 */

const VERSION = 1

/** Groups per model call: about 60 tokens each, so a call stays small and quick. */
const GROUPS_PER_CALL = 50
/** The most groups looked at in one pass; past that, the biggest. */
const MAX_GROUPS = 400

const PlanOut = z.object({
  /** "Tidy my tags": nothing in particular, so the whole of them is checked. */
  checkup: z.boolean(),
  ops: z
    .array(
      z.object({
        op: z.enum(['rename', 'merge', 'delete']),
        tag: z.string(),
        to: z.string().nullable(),
        why: z.string().max(140),
      }),
    )
    .max(20),
  /** The tags whose songs are in question; empty means every tag. */
  focus: z.array(z.string()).max(8),
  /** A tag the request wants made, when none of theirs is it. */
  newTag: z.string().nullable(),
  /** Which songs to look at, against the focus tags. */
  songs: z.enum(['without', 'with', 'all', 'untagged', 'none']),
  /** Only these artists' songs, when the request names them. */
  artists: z.array(z.string()).max(12),
})

const GroupsOut = z.object({
  groups: z
    .array(
      z.object({
        g: z.string(),
        add: z.array(z.string()).max(2),
        remove: z.array(z.string()).max(2),
        newTag: z.string().nullable(),
        sure: z.enum(['high', 'medium', 'low']),
        why: z.string().max(140),
      }),
    )
    .max(GROUPS_PER_CALL),
})

const PLAN_SYSTEM = `You look after the tags in someone's own music library. You are given their tags, each with what it already holds, the artists in the library, and their request. Their tags are their own vocabulary: a tag means what it holds, not what the word usually means.

Reply with JSON only:
- checkup: true when they ask to check, tidy or clean up their tags in general without saying what; false when they say what they want.
- ops: changes to tags themselves, each with why: at most twelve plain words written to them ("Both hold Japanese pop"; "As you asked" when they asked for exactly this). rename (to is the new name), merge (tag goes into to, an existing tag; its songs move there and it is deleted), delete (to is null). Only what the request asks for, or for a checkup: two tags that mean the same thing (merge the smaller into the bigger), a tag spelled in a way that clashes with the rest. Never delete a tag that holds songs unless asked. Copy tag names exactly from their list.
- focus: the tags whose songs are in question, copied exactly (for a new tag, its name). Empty for a checkup, or when the request is only about renaming, merging or deleting.
- newTag: the name of a tag the request wants that they do not have yet, else null.
- songs: which songs to look at against the focus tags. without: songs that do not carry them yet ("songs that should be X", "tag … as X"). with: songs that carry them ("take X off …", "which X songs are wrong"). all: both. untagged: only songs with no tag. none: no songs, only ops. For a checkup, all.
- artists: when the request names artists ("tag every 周杰倫 song …"), those names as the library spells them; else empty.`

const GROUPS_SYSTEM = `You look after the tags in someone's own music library. You are given their request, their tags with what each already holds, the tags in question, and groups of their songs. Each group is songs by one artist that carry the same tags and whose titles are in one script. Their tags are their own vocabulary: a song belongs in a tag by the same logic as the songs already there (language and scene, game or show, period, genre), not by what the word usually means.

For each group that should change, reply with:
- g: the group's id, exactly as given.
- add: tags from the ones in question, copied exactly, that these songs should carry and do not. At most two.
- remove: tags these songs carry, from the ones in question, that they should not. At most two.
- newTag: a new tag's name only when told one may be made; else null.
- sure: high when you know this artist and the fit is plain, medium when it is likely, low when you are guessing.
- why: at most twelve plain words for the person about the kind of songs, without the artist's name, since one reason may speak for several artists ("Mandarin pop, like the rest of 中文流行").

Leave out a group that is right as it is. Reply with JSON only.`

interface TagReviewDeps {
  readonly llm: Llm
  readonly songs: () => Song[]
  readonly tags: () => Tag[]
  readonly remembered?: Remembered
}

interface TagReviewInput {
  /** What was asked for, or null for the songs without a tag. */
  readonly text: string | null
}

/** Songs by one artist that carry the same tags, with titles in one script. */
interface Group {
  readonly ref: string
  readonly artist: string
  readonly tagIds: readonly number[]
  readonly script: Script
  readonly songs: Song[]
}

type Script = 'Chinese' | 'Japanese' | 'Korean' | 'Latin' | 'other'

/** "周杰倫 76, 薛之谦 12, +8 more". */
export function whoOf(songs: readonly Song[]): string {
  const counts = tally(songs.map(song => mainArtist(song.artist)))
  const shown = counts.slice(0, 3).map(([name, n]) => (songs.length === 1 ? name : `${name} ${n}`))
  const rest = counts.length - 3
  return rest > 0 ? `${shown.join(', ')}, +${rest} more` : shown.join(', ')
}

/** The script a title is written in, which is most of what tells a song's language here. */
export function scriptOf(title: string): Script {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title)) return 'Japanese'
  if (/\p{Script=Hangul}/u.test(title)) return 'Korean'
  if (CJK.test(title)) return 'Chinese'
  if (/\p{Script=Latin}/u.test(title)) return 'Latin'
  return 'other'
}

/**
 * The tag the library itself gives an untagged song: the one every tagged
 * song on its album shares, or else the one at least four in five of its
 * artist's tagged songs share (with two at the least, so one stray song
 * decides nothing).
 *
 * Made once over the tagged songs and asked once per untagged one: the songs
 * are grouped by album and by artist up front, so a library with thousands of
 * each is not walked again for every song in question.
 */
export function placeFromLibrary(
  tagged: readonly Song[],
  tags: readonly Tag[],
): (song: Song) => { tag: Tag; why: string } | null {
  const byId = new Map(tags.map(tag => [tag.id, tag]))
  const byAlbum = new Map<string, Song[]>()
  const byArtist = new Map<string, Song[]>()
  for (const other of tagged) {
    if (other.album) push(byAlbum, other.album.toLowerCase(), other)
    push(byArtist, mainArtist(other.artist).toLowerCase(), other)
  }
  const shared = (others: readonly Song[], share: number, least: number): Tag | null => {
    if (others.length < least) return null
    const counts = tally(others.flatMap(other => other.tagIds.map(String)))
    const [id, n] = counts[0] ?? []
    if (id === undefined || n === undefined || n / others.length < share) return null
    return byId.get(Number(id)) ?? null
  }

  return song => {
    if (song.album) {
      const tag = shared(byAlbum.get(song.album.toLowerCase()) ?? [], 1, 1)
      if (tag) return { tag, why: `The rest of ${song.album} is in ${tag.name}` }
    }
    const artist = mainArtist(song.artist)
    const tag = shared(byArtist.get(artist.toLowerCase()) ?? [], 0.8, 2)
    if (tag) return { tag, why: `${artist}’s other songs are in ${tag.name}` }
    return null
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * Tags a tagged song is missing that every other song on its album carries
 * (two others at the least). An album is one record: when the rest of it is
 * in 古典, the one left out was missed, not judged.
 */
export function missingFromAlbum(song: Song, onAlbum: readonly Song[]): number[] {
  if (!song.album) return []
  const others = onAlbum.filter(
    other => other.id !== song.id && other.album.toLowerCase() === song.album.toLowerCase(),
  )
  if (others.length < 2) return []
  const shared = others[0]!.tagIds.filter(id => others.every(other => other.tagIds.includes(id)))
  return shared.filter(id => !song.tagIds.includes(id))
}

/** Tags spelled as one ("Chinese Pop", "chinese-pop"): each smaller one goes into the biggest. */
export function sameNames(tags: readonly Tag[]): { tag: Tag; into: Tag }[] {
  const byBare = new Map<string, Tag[]>()
  for (const tag of tags) {
    const key = bare(tag.name)
    if (key) push(byBare, key, tag)
  }
  return [...byBare.values()].flatMap(same => {
    if (same.length < 2) return []
    const [into, ...rest] = [...same].sort((a, b) => b.songCount - a.songCount || a.id - b.id)
    return rest.map(tag => ({ tag, into: into! }))
  })
}

/** Groups by who, what they carry, and the script of the title; biggest first. */
export function groupSongs(songs: readonly Song[]): Group[] {
  const groups = new Map<string, Song[]>()
  for (const song of songs) {
    const tagIds = [...song.tagIds].sort((a, b) => a - b)
    const key = `${mainArtist(song.artist).toLowerCase()}|${tagIds.join(',')}|${scriptOf(song.title)}`
    push(groups, key, song)
  }
  return [...groups.values()]
    .sort((a, b) => b.length - a.length)
    .map((group, index) => ({
      ref: `g${index + 1}`,
      artist: mainArtist(group[0]!.artist),
      tagIds: group[0]!.tagIds,
      script: scriptOf(group[0]!.title),
      songs: group,
    }))
}

function groupLine(group: Group, names: ReadonlyMap<number, string>): string {
  const albums = tally(group.songs.map(song => song.album).filter(Boolean))
  const titles = group.songs.slice(0, 5).map(song => song.title)
  return [
    group.ref,
    group.artist,
    `${group.songs.length} song${group.songs.length === 1 ? '' : 's'}`,
    group.tagIds.length
      ? `tags: ${group.tagIds.map(id => names.get(id) ?? '?').join(', ')}`
      : 'no tags',
    `titles in ${group.script}`,
    albums.length
      ? `albums: ${albums
          .slice(0, 4)
          .map(([name, n]) => `${name} ${n}`)
          .join(', ')}`
      : 'no album',
    `e.g. ${titles.join(' / ')}`,
  ].join(' | ')
}

/** The changes as they gather: one per (what, tag, who found it), however many groups lead to it. */
class Gathered {
  readonly #entries = new Map<
    string,
    {
      op: TagChange['op']
      tag: string
      isNew: boolean
      to: string | null
      by: TagChange['by']
      songs: Song[]
      whys: Map<string, number>
      who: string | null
    }
  >()

  songs(
    op: 'add' | 'remove',
    tag: string,
    isNew: boolean,
    by: TagChange['by'],
    songs: readonly Song[],
    why: string,
  ): void {
    const key = `${op}|${tag.toLowerCase()}|${by}`
    const entry = this.#entries.get(key) ?? {
      op,
      tag,
      isNew,
      to: null,
      by,
      songs: [],
      whys: new Map<string, number>(),
      who: null,
    }
    for (const song of songs) if (!entry.songs.includes(song)) entry.songs.push(song)
    entry.whys.set(why, (entry.whys.get(why) ?? 0) + songs.length)
    this.#entries.set(key, entry)
  }

  /** A change to a tag itself; the first one said about a tag stands. */
  tag(
    op: 'rename' | 'merge' | 'delete',
    tag: string,
    to: string | null,
    by: TagChange['by'],
    why: string,
    who: string,
  ): void {
    if (this.touched(tag)) return
    this.#entries.set(`${op}|${tag.toLowerCase()}`, {
      op,
      tag,
      isNew: false,
      to,
      by,
      songs: [],
      whys: new Map([[why, 1]]),
      who,
    })
  }

  /** Whether the tag itself is renamed, merged or deleted already. */
  touched(tag: string): boolean {
    return [...this.#entries.values()].some(
      entry =>
        entry.op !== 'add' &&
        entry.op !== 'remove' &&
        (entry.tag.toLowerCase() === tag.toLowerCase() ||
          (entry.to ?? '').toLowerCase() === tag.toLowerCase()),
    )
  }

  /** Where a merged tag's songs go, so an add to it lands in the tag it goes into. */
  mergedInto(tag: string): string | null {
    for (const entry of this.#entries.values()) {
      if (entry.op === 'merge' && entry.tag.toLowerCase() === tag.toLowerCase()) return entry.to
    }
    return null
  }

  deleted(tag: string): boolean {
    return [...this.#entries.values()].some(
      entry => entry.op === 'delete' && entry.tag.toLowerCase() === tag.toLowerCase(),
    )
  }

  changes(): TagChange[] {
    const order: Record<TagChange['op'], number> = {
      rename: 0,
      merge: 1,
      delete: 2,
      add: 3,
      remove: 4,
    }
    return [...this.#entries.values()]
      .map(entry => ({
        key: `${entry.op}:${entry.by}:${entry.tag}`,
        op: entry.op,
        tag: entry.tag,
        isNew: entry.isNew,
        to: entry.to,
        songIds: entry.songs.map(song => song.id),
        who: entry.who ?? whoOf(entry.songs),
        // The reason that covers the most songs speaks for the change.
        why: [...entry.whys].sort((a, b) => b[1] - a[1])[0]![0],
        by: entry.by,
      }))
      .sort(
        (a, b) =>
          Number(a.by === 'model') - Number(b.by === 'model') ||
          order[a.op] - order[b.op] ||
          b.songIds.length - a.songIds.length ||
          a.tag.localeCompare(b.tag),
      )
  }
}

export async function tagReview(
  deps: TagReviewDeps,
  input: TagReviewInput,
  steps: Steps = NO_STEPS,
): Promise<TagReview> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const tags = deps.tags()
  const named = (name: string): Tag | undefined =>
    tags.find(tag => tag.name.toLowerCase() === name.trim().toLowerCase())
  const names = new Map(tags.map(tag => [tag.id, tag.name]))
  const catalog = tagCatalog(songs, tags)
  const gathered = new Gathered()
  const notes: string[] = []
  /** What a tag holds, said the way a change says who its songs are by. */
  const holds = (tag: Tag): string =>
    whoOf(songs.filter(song => song.tagIds.includes(tag.id))) || 'no songs'

  // 1 · What the request is about. Without one, it is the untagged songs.
  let plan: z.infer<typeof PlanOut> = {
    checkup: false,
    ops: [],
    focus: [],
    newTag: null,
    songs: 'untagged',
    artists: [],
  }
  if (input.text !== null) {
    steps.begin('Reading your tags')
    const artists = tally(songs.map(song => mainArtist(song.artist)))
      .slice(0, 300)
      .map(([name, n]) => `${name} ${n}`)
      .join(', ')
    const prompt = `Their tags:\n${catalog}\n\nTheir artists, most songs first: ${artists}\n\nThe request:\n${input.text}`
    plan = await remembered.get(
      Remembered.key('tags-plan', VERSION, prompt),
      async () =>
        (
          await deps.llm.generate({
            task: 'tags-plan',
            tier: 'smart',
            system: PLAN_SYSTEM,
            prompt,
            schema: PlanOut,
          })
        ).value,
    )
    steps.done('Read your tags')
  }
  const checkup = input.text !== null && plan.checkup
  const songsMode = checkup ? 'all' : plan.songs

  // The tag the request wants made, when it is not one of theirs already.
  const newName = plan.newTag?.trim().replace(/\s+/g, ' ') ?? ''
  const newTag = newName && !named(newName) && newName.length <= TAG_NAME_MAX ? newName : null

  // 2 · The library's own answers: tags spelled as one, and songs their album or artist places.
  if (checkup) {
    for (const { tag, into } of sameNames(tags)) {
      gathered.tag('merge', tag.name, into.name, 'rule', `Spelled like ${into.name}`, holds(tag))
    }
  }
  for (const op of plan.ops) {
    const tag = named(op.tag)
    if (!tag) continue
    if (op.op === 'merge') {
      const into = op.to ? named(op.to) : undefined
      if (into && into.id !== tag.id) {
        gathered.tag('merge', tag.name, into.name, 'model', op.why, holds(tag))
      }
    } else if (op.op === 'rename') {
      const to = op.to?.trim().replace(/\s+/g, ' ') ?? ''
      const clash = to ? named(to) : undefined
      if (to && to !== tag.name && to.length <= TAG_NAME_MAX && (!clash || clash.id === tag.id)) {
        gathered.tag('rename', tag.name, to, 'model', op.why, holds(tag))
      }
    } else {
      gathered.tag('delete', tag.name, null, 'model', op.why, holds(tag))
    }
  }

  const focus = plan.focus.map(name => named(name)).filter((tag): tag is Tag => tag !== undefined)
  const unknownFocus = plan.focus.filter(
    name => !named(name) && name.trim().toLowerCase() !== (newTag ?? '').toLowerCase(),
  )
  if (unknownFocus.length > 0) notes.push(`You have no tag called ${unknownFocus.join(' or ')}.`)
  // Every tag is in question for a checkup and for the untagged pass.
  const anyTag = focus.length === 0 && newTag === null
  const inFocus = (tag: Tag): boolean => anyTag || focus.some(each => each.id === tag.id)
  const focusIds = focus.map(tag => tag.id)

  // Which songs are in question.
  const wantArtists = plan.artists.map(name => name.trim().toLowerCase()).filter(Boolean)
  const byArtist = (song: Song): boolean =>
    wantArtists.length === 0 ||
    wantArtists.some(
      name =>
        mainArtist(song.artist).toLowerCase() === name || song.artist.toLowerCase().includes(name),
    )
  const carries = (song: Song): boolean => focusIds.some(id => song.tagIds.includes(id))
  const lacks = (song: Song): boolean =>
    newTag !== null || focusIds.length === 0 || focusIds.some(id => !song.tagIds.includes(id))
  const inQuestion = songs.filter(song => {
    if (!byArtist(song)) return false
    switch (songsMode) {
      case 'none':
        return false
      case 'untagged':
        return song.tagIds.length === 0
      case 'without':
        return lacks(song)
      case 'with':
        return focusIds.length > 0 && carries(song)
      case 'all':
        return true
    }
  })

  const fromLibrary = placeFromLibrary(
    songs.filter(song => song.tagIds.length > 0),
    tags,
  )
  const tagById = new Map(tags.map(tag => [tag.id, tag]))
  const albums = new Map<string, Song[]>()
  for (const song of songs) if (song.album) push(albums, song.album.toLowerCase(), song)
  const placed = new Set<number>()
  if (songsMode !== 'with' && songsMode !== 'none') {
    for (const song of inQuestion) {
      if (song.tagIds.length === 0) {
        const found = fromLibrary(song)
        if (found && inFocus(found.tag)) {
          gathered.songs('add', found.tag.name, false, 'rule', [song], found.why)
          placed.add(song.id)
        }
      } else if (songsMode !== 'untagged') {
        for (const id of missingFromAlbum(song, albums.get(song.album.toLowerCase()) ?? [])) {
          const tag = tagById.get(id)
          if (!tag || !inFocus(tag)) continue
          gathered.songs(
            'add',
            tag.name,
            false,
            'rule',
            [song],
            `The rest of ${song.album} is in ${tag.name}`,
          )
          placed.add(song.id)
        }
      }
    }
  }

  // 3 · The model, over what the library could not place.
  let left = inQuestion.filter(song => !placed.has(song.id))
  if (checkup) {
    // A checkup looks where something is likely off: songs with no tag, and
    // artists whose songs are tagged more than one way.
    const ways = new Map<string, Set<string>>()
    for (const song of songs) {
      const key = mainArtist(song.artist).toLowerCase()
      const set = ways.get(key) ?? new Set<string>()
      set.add([...song.tagIds].sort((a, b) => a - b).join(','))
      ways.set(key, set)
    }
    left = left.filter(
      song =>
        song.tagIds.length === 0 ||
        (ways.get(mainArtist(song.artist).toLowerCase())?.size ?? 0) > 1,
    )
  }
  let groups = groupSongs(left)
  if (groups.length > MAX_GROUPS) {
    const shown = groups.slice(0, MAX_GROUPS)
    const rest = groups.slice(MAX_GROUPS).reduce((n, group) => n + group.songs.length, 0)
    notes.push(
      `Looked at the biggest ${MAX_GROUPS} groups; ${rest} songs were left for another time.`,
    )
    groups = shown
  }

  const unsure: TagReview['unsure'] = []
  if (groups.length > 0) {
    steps.begin(
      `Looking at ${left.length.toLocaleString('en')} ${left.length === 1 ? 'song' : 'songs'} by ${new Set(groups.map(group => group.artist.toLowerCase())).size} artists`,
    )
    const inQuestionTags = anyTag
      ? 'any of their tags'
      : [...focus.map(tag => tag.name), ...(newTag ? [newTag] : [])].join(', ')
    const newRule =
      input.text === null
        ? 'A new tag may be made only when their own tags clearly follow a pattern this group extends but no tag covers yet (they tag each region of a game separately and this album is a region without a tag). Never suggest a new tag merely because none fits.'
        : newTag
          ? `The tag ${newTag} does not exist yet; use its name in add, never in newTag.`
          : 'No new tag may be made: newTag is always null.'
    const request =
      input.text === null
        ? 'Give these songs, which have no tag yet, the tags they belong in.'
        : checkup
          ? `${input.text}\n(Check the groups' tags: songs missing a tag the rest of their kind carries, or carrying one that does not fit.)`
          : input.text
    let answers: z.infer<typeof GroupsOut>[]
    try {
      answers = await Promise.all(
        chunks(groups, GROUPS_PER_CALL).map(chunk => {
          const prompt = `The request:\n${request}\n\nTheir tags:\n${catalog}\n\nTags in question: ${inQuestionTags}\n${newRule}\n\nGroups (id | artist | songs | tags | script | albums | titles):\n${chunk.map(group => groupLine(group, names)).join('\n')}`
          return remembered.get(
            Remembered.key('tags-groups', VERSION, prompt),
            async () =>
              (
                await deps.llm.generate({
                  task: 'tags-groups',
                  tier: 'smart',
                  system: GROUPS_SYSTEM,
                  prompt,
                  schema: GroupsOut,
                })
              ).value,
          )
        }),
      )
    } catch (caught) {
      // The library's own answers still stand when the model cannot be asked.
      if (!(caught instanceof LlmError) || input.text !== null) throw caught
      answers = []
      notes.push(`${llmFailureWords[caught.kind]} Only what your library says by itself is here.`)
    }

    // The check: groups it was shown, tags in question, the one new name.
    const byRef = new Map(groups.map(group => [group.ref, group]))
    const answered = new Set<string>()
    for (const answer of answers.flatMap(each => each.groups)) {
      const group = byRef.get(answer.g)
      if (!group || answered.has(group.ref)) continue
      answered.add(group.ref)
      const adds: { name: string; isNew: boolean }[] = []
      for (const name of answer.add) {
        const tag = named(name)
        if (tag && inFocus(tag) && !group.tagIds.includes(tag.id)) {
          adds.push({ name: tag.name, isNew: false })
        } else if (!tag && newTag && name.trim().toLowerCase() === newTag.toLowerCase()) {
          adds.push({ name: newTag, isNew: true })
        }
      }
      const proposed = answer.newTag?.trim().replace(/\s+/g, ' ') ?? ''
      if (input.text === null && proposed && proposed.length <= TAG_NAME_MAX) {
        const existing = named(proposed)
        if (existing && !group.tagIds.includes(existing.id))
          adds.push({ name: existing.name, isNew: false })
        else if (!existing) adds.push({ name: proposed, isNew: true })
      }
      const removes = answer.remove
        .map(name => named(name))
        .filter(
          (tag): tag is Tag => tag !== undefined && inFocus(tag) && group.tagIds.includes(tag.id),
        )

      const changing = adds.length > 0 || removes.length > 0
      if (answer.sure === 'low' || !changing) {
        // Worth saying when it would have changed something, or when a song stays without a tag.
        if ((answer.sure === 'low' && changing) || input.text === null) {
          unsure.push({
            songIds: group.songs.map(song => song.id),
            who: whoOf(group.songs),
            why: answer.why,
          })
        }
        continue
      }
      for (const add of adds) {
        if (gathered.deleted(add.name)) continue
        const target = gathered.mergedInto(add.name) ?? add.name
        gathered.songs('add', target, add.isNew, 'model', group.songs, answer.why)
      }
      for (const tag of removes) {
        if (gathered.deleted(tag.name) || gathered.mergedInto(tag.name)) continue
        gathered.songs('remove', tag.name, false, 'model', group.songs, answer.why)
      }
    }
    // A group left out is right as it is; for songs without a tag, that is none fitting.
    if (input.text === null) {
      for (const group of groups) {
        if (!answered.has(group.ref) && answers.length > 0) {
          unsure.push({
            songIds: group.songs.map(song => song.id),
            who: whoOf(group.songs),
            why: 'none of your tags fits',
          })
        }
      }
    }
    steps.done()
  }

  // One line per reason, however many groups share it.
  const byWhy = new Map<string, number[]>()
  for (const each of unsure) {
    const ids = byWhy.get(each.why)
    if (ids) ids.push(...each.songIds)
    else byWhy.set(each.why, [...each.songIds])
  }
  const byId = new Map(songs.map(song => [song.id, song]))

  return {
    changes: gathered.changes(),
    looked: inQuestion.length,
    asked: input.text,
    unsure: [...byWhy].map(([why, songIds]) => ({
      songIds,
      who: whoOf(songIds.map(id => byId.get(id)!)),
      why,
    })),
    note: notes.length > 0 ? notes.join(' ') : null,
  }
}
