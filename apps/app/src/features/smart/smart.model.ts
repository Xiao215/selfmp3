import { ApiError } from '@selfmp3/client'
import { plural, formatLongDuration } from '@selfmp3/shared'
import type {
  AiCheck,
  AskAnswer,
  AskOrder,
  AskSort,
  BulkEditSongs,
  Playlist,
  SmartRules,
  Song,
  TagChange,
  TidyChange,
  AskStatsRange,
  DescribeResult,
  Tag,
  Understanding,
} from '@selfmp3/shared'

/**
 * The smart features as the app draws them (docs/features/ai.md): what a
 * description was understood as, part by part, and the server's answers
 * turned into this device's songs and tags.
 */

/** One part of an understanding, drawn as a chip that can be taken away. */
export interface Part {
  readonly key: string
  readonly label: string
  /** A tag's hue, for a tag's dot. */
  readonly hue?: number
  readonly without: (understanding: Understanding) => Understanding
}

/** At most `n` characters, ending on a whole word with an ellipsis when cut. */
function clip(text: string, n: number): string {
  if (text.length <= n) return text
  const cut = text.slice(0, n)
  const space = cut.lastIndexOf(' ')
  return `${(space > n / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const days = (n: number): string => (n === 1 ? 'today' : n === 7 ? 'this week' : `in ${n} days`)

function rangeLabel(
  what: 'energy' | 'bpm',
  range: { min: number | null; max: number | null },
): string | null {
  const { min, max } = range
  if (min === null && max === null) return null
  const show = (n: number): string => (what === 'energy' ? n.toFixed(2) : `${Math.round(n)} bpm`)
  if (what === 'energy') {
    if (min === null) return `Calm · energy under ${show(max!)}`
    if (max === null) return `Lively · energy over ${show(min)}`
    return `Energy ${show(min)}–${show(max)}`
  }
  if (min === null) return `Under ${show(max!)}`
  if (max === null) return `Over ${show(min)}`
  return `${Math.round(min)}–${show(max)}`
}

/** "2000s", "Since 2015", "Before 2010", "2003", "2012–2016": a year range the way it was likely said. */
export function yearLabel(range: { min: number | null; max: number | null }): string | null {
  const { min, max } = range
  if (min === null && max === null) return null
  if (min === null) return max! % 10 === 9 ? `Before ${max! + 1}` : `Up to ${max}`
  if (max === null) return `Since ${min}`
  if (min === max) return String(min)
  if (min % 10 === 0 && max === min + 9) return `${min}s`
  return `${min}–${max}`
}

export function parts(understanding: Understanding, tags: readonly Tag[]): Part[] {
  const hueOf = (name: string): number | undefined =>
    tags.find(tag => tag.name.toLowerCase() === name.toLowerCase())?.hue
  const out: Part[] = []

  for (const name of understanding.anyTags) {
    out.push({
      key: `tag:${name}`,
      label: name,
      hue: hueOf(name),
      without: u => ({ ...u, anyTags: u.anyTags.filter(other => other !== name) }),
    })
  }
  for (const name of understanding.artists) {
    out.push({
      key: `artist:${name}`,
      label: name,
      without: u => ({ ...u, artists: u.artists.filter(other => other !== name) }),
    })
  }
  for (const name of understanding.noTags) {
    out.push({
      key: `not:${name}`,
      label: `Not ${name}`,
      without: u => ({ ...u, noTags: u.noTags.filter(other => other !== name) }),
    })
  }
  const energy = rangeLabel('energy', understanding.energy)
  if (energy)
    out.push({
      key: 'energy',
      label: energy,
      without: u => ({ ...u, energy: { min: null, max: null } }),
    })
  const bpm = rangeLabel('bpm', understanding.bpm)
  if (bpm)
    out.push({ key: 'bpm', label: bpm, without: u => ({ ...u, bpm: { min: null, max: null } }) })
  const year = yearLabel(understanding.year)
  if (year)
    out.push({ key: 'year', label: year, without: u => ({ ...u, year: { min: null, max: null } }) })
  if (understanding.sound !== null) {
    // The listening model's words, in English: only songs that sound like it, best first.
    out.push({
      key: 'sound',
      label: `Sounds like ${clip(understanding.sound, 40)}`,
      without: u => ({ ...u, sound: null }),
    })
  }
  if (understanding.words !== null) {
    out.push({
      key: 'words',
      label: understanding.words === 'with' ? 'With words' : 'No words',
      without: u => ({ ...u, words: null }),
    })
  }
  if (understanding.loved !== null) {
    out.push({
      key: 'loved',
      label: understanding.loved ? 'Loved' : 'Not loved',
      without: u => ({ ...u, loved: null }),
    })
  }
  if (understanding.playedWithinDays !== null) {
    out.push({
      key: 'played',
      label: `Played ${days(understanding.playedWithinDays)}`,
      without: u => ({ ...u, playedWithinDays: null }),
    })
  }
  if (understanding.notPlayedWithinDays !== null) {
    out.push({
      key: 'notPlayed',
      label: `Not played ${days(understanding.notPlayedWithinDays)}`,
      without: u => ({ ...u, notPlayedWithinDays: null }),
    })
  }
  if (understanding.addedWithinDays !== null) {
    out.push({
      key: 'added',
      label: `Added ${days(understanding.addedWithinDays)}`,
      without: u => ({ ...u, addedWithinDays: null }),
    })
  }
  if (understanding.minutes !== null) {
    out.push({
      key: 'minutes',
      label: `About ${formatLongDuration(understanding.minutes * 60)}`,
      without: u => ({ ...u, minutes: null }),
    })
  }
  return out
}

/**
 * Whether the understanding is tags and nothing else, which is the one kind a
 * playlist can follow and keep itself filled from. Anything more is a set of
 * picks, made once.
 */
export function onlyTags(understanding: Understanding): boolean {
  return (
    understanding.anyTags.length > 0 &&
    understanding.brief === null &&
    parts(understanding, []).every(part => part.key.startsWith('tag:'))
  )
}

/** This device's tag ids for tag names, leaving out any it does not have. */
export function tagIdsFor(names: readonly string[], tags: readonly Tag[]): number[] {
  return names.flatMap(name =>
    tags.filter(tag => tag.name.toLowerCase() === name.toLowerCase()).map(tag => tag.id),
  )
}

interface DevicePick {
  readonly songId: number
  readonly why: string | null
}

/**
 * The picks as this device's songs. A song the server has and this device
 * does not yet is left out: it cannot be added to a playlist from here.
 */
export function picksHere(
  result: Pick<DescribeResult, 'picks'>,
  onDevice: (serverId: number) => number | undefined,
): DevicePick[] {
  return result.picks.flatMap(pick => {
    const songId = onDevice(pick.songId)
    return songId === undefined ? [] : [{ songId, why: pick.why }]
  })
}

/**
 * An answer's songs as this device has them, in the order you put them in on
 * its page (`order`, this device's ids), with any it did not cover — a song
 * that reached this device after the reorder — after them in the answer's
 * order. The card in Search and the answer's page both draw this, so the two
 * never disagree about how many songs or minutes it is.
 */
export function answerSongs<S extends { readonly id: number }>(
  result: Pick<DescribeResult, 'picks'>,
  order: readonly number[] | null,
  onDevice: (serverId: number) => number | undefined,
  byId: ReadonlyMap<number, S>,
): S[] {
  const picked = picksHere(result, onDevice).flatMap(pick => byId.get(pick.songId) ?? [])
  if (!order) return picked
  const place = new Map(order.map((songId, index) => [songId, index]))
  return [...picked].sort(
    (a, b) => (place.get(a.id) ?? order.length) - (place.get(b.id) ?? order.length),
  )
}

/** What a describe answer says beside its songs: what fit, and what it set aside. */
export function describeNotes(result: DescribeResult, picked: number): string[] {
  const notes: string[] = []
  notes.push(
    result.fit === picked
      ? `${plural(picked, 'song', 'songs')} fit`
      : `Picked ${picked} of the ${result.fit} that fit`,
  )
  if (result.loosened.length > 0) {
    notes.push(`Nothing fit all of it, so it let go of ${result.loosened.join(', ')}.`)
  }
  if (result.unknown.length > 0) {
    notes.push(`Your library has no ${result.unknown.join(', ')}.`)
  }
  return notes
}

/**
 * Whether the box offers to ask (S1): three letters at least, and either more
 * than one word or nothing on the device that matches. A single word that
 * finds a song is a search, and stays one.
 */
export function askable(text: string, matches: number): boolean {
  const trimmed = text.trim()
  return trimmed.length >= 3 && (/\S\s+\S/.test(trimmed) || matches === 0)
}

export function rangeWords(range: AskStatsRange): string {
  switch (range) {
    case '7d':
      return 'the last 7 days'
    case '30d':
      return 'the last 30 days'
    case '90d':
      return 'the last 90 days'
    case '365d':
      return 'the last year'
    case 'all':
      return 'all time'
  }
}

/**
 * Tags whose name holds what was typed (N1), the ones starting with it first,
 * leaving out those already chosen.
 */
export function matchingTags(
  text: string,
  tags: readonly Tag[],
  chosen: readonly number[],
  limit = 8,
): Tag[] {
  const typed = text.trim().toLowerCase()
  if (!typed) return []
  return tags
    .filter(tag => !chosen.includes(tag.id) && tag.name.toLowerCase().includes(typed))
    .sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(typed)) -
          Number(!b.name.toLowerCase().startsWith(typed)) || b.songCount - a.songCount,
    )
    .slice(0, limit)
}

/** The tag typed in full, if one is called exactly that. */
export function exactTag(text: string, tags: readonly Tag[]): Tag | null {
  const typed = text.trim().toLowerCase()
  return tags.find(tag => tag.name.toLowerCase() === typed) ?? null
}

/** One leg of Settings' Test: this device to the server, or the server to the model. */
export interface Hop {
  readonly ok: boolean
  readonly line: string
  /** The endpoint's or the system's own words, under the line. */
  readonly detail?: string
}

/** "24 ms" under a second, "1.3 s" over it. */
export function took(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** The first leg, from what asking the server for its smart setup did. */
export function serverHop(result: { ms: number } | { error: unknown }): Hop {
  if ('ms' in result)
    return { ok: true, line: `This device reached your server in ${took(result.ms)}` }
  const { error } = result
  if (error instanceof ApiError && error.isOffline) {
    return { ok: false, line: 'This device can’t reach your server.', detail: error.message }
  }
  return {
    ok: false,
    line: 'Your server answered with an error.',
    detail: error instanceof Error ? error.message : String(error),
  }
}

/** The second leg: the server's one small call to the model. */
export function modelHop(check: AiCheck): Hop {
  if (check.ok) {
    return { ok: true, line: `Your server reached the model (${check.model}) in ${took(check.ms)}` }
  }
  return { ok: false, line: check.message, detail: check.detail }
}

/**
 * A change in a review (Tidy up's names, Tags' changes) as this device has it:
 * its key, whether a plain rule or the model found it, and its songs here.
 */
export interface Reviewed {
  readonly change: { readonly key: string; readonly by: 'rule' | 'model' }
  readonly songIds: readonly number[]
}

/** A Tidy up change as this device has it: its own song ids, still as the change found them. */
export interface TidyHere extends Reviewed {
  readonly change: TidyChange
}

/**
 * The server's changes on this device's songs. A song edited since the server
 * looked — its field no longer what the change says it is — is left out, so an
 * approval never overwrites an edit made in between.
 */
export function tidyHere(
  changes: readonly TidyChange[],
  onDevice: (serverId: number) => number | undefined,
  songsById: ReadonlyMap<number, Song>,
): TidyHere[] {
  return changes.flatMap(change => {
    const songIds = change.songIds.flatMap(serverId => {
      const id = onDevice(serverId)
      const song = id === undefined ? undefined : songsById.get(id)
      return song && song[change.field] === change.from ? [song.id] : []
    })
    return songIds.length > 0 ? [{ change, songIds }] : []
  })
}

/** One heading and its changes, in the order the server gave them. */
interface ReviewSection<T> {
  readonly title: string
  readonly changes: T[]
}

/**
 * The changes in two bands by how far to trust them: what a plain rule found,
 * then the model's guesses, each under its headings (Tidy up's reasons, the
 * tags' kinds of change). An empty band is left out.
 */
export function reviewBands<T extends Reviewed>(
  changes: readonly T[],
  sectionOf: (change: T) => string,
): { by: Reviewed['change']['by']; sections: ReviewSection<T>[] }[] {
  return (['rule', 'model'] as const).flatMap(by => {
    const sections = new Map<string, ReviewSection<T>>()
    for (const here of changes) {
      if (here.change.by !== by) continue
      const title = sectionOf(here)
      const section = sections.get(title) ?? { title, changes: [] }
      section.changes.push(here)
      sections.set(title, section)
    }
    return sections.size > 0 ? [{ by, sections: [...sections.values()] }] : []
  })
}

/** A song left out of a change it would otherwise be part of. */
export function leftOutKey(changeKey: string, songId: number): string {
  return `${changeKey}:${songId}`
}

/** The songs of a change still in it: all of them, less the ones left out. */
export function keptSongs(here: Reviewed, leftOut: ReadonlySet<string>): number[] {
  return here.songIds.filter(id => !leftOut.has(leftOutKey(here.change.key, id)))
}

/**
 * The approved changes as one edit per song, a title and an artist fixed
 * together. `undo` writes each field back to what it was, for the toast's Undo.
 */
export function tidyEdits(
  changes: readonly TidyHere[],
  leftOut: ReadonlySet<string> = new Set(),
  undo = false,
): BulkEditSongs['edits'] {
  const patches = new Map<number, Record<string, string>>()
  for (const here of changes) {
    const { field, from, to } = here.change
    for (const id of keptSongs(here, leftOut)) {
      patches.set(id, { ...patches.get(id), [field]: undo ? from : to })
    }
  }
  return [...patches].map(([songId, patch]) => ({ songId, patch }))
}

/** A piece of a change drawn on one line: kept, taken out, or put in. */
interface TidyPart {
  readonly kind: 'same' | 'gone'
  readonly text: string
}

/** Words, runs of space and single marks: what a name is compared in. */
const PIECES = /[\p{L}\p{N}\p{M}]+|\s+|[^\p{L}\p{N}\p{M}\s]/gu

/**
 * A change as one line when it only takes words out — a repeated name, the
 * video's words, a translation, a stray comma: the name as it is, with the
 * part that goes marked. Anything that puts words in (another spelling,
 * another script) is a rename, drawn as old → new, and gets null here.
 */
export function tidyParts(from: string, to: string): TidyPart[] | null {
  const a = from.match(PIECES) ?? []
  const b = to.match(PIECES) ?? []
  // The longest run of `to` found in order in `from`, from the end back.
  const longest = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i]![j] =
        a[i] === b[j]
          ? longest[i + 1]![j + 1]! + 1
          : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!)
    }
  }
  if (longest[0]![0] !== b.length || b.join('') !== to) return null
  const parts: TidyPart[] = []
  const put = (kind: TidyPart['kind'], text: string): void => {
    const last = parts[parts.length - 1]
    if (last?.kind === kind) parts[parts.length - 1] = { kind, text: last.text + text }
    else parts.push({ kind, text })
  }
  let j = 0
  for (let i = 0; i < a.length; i++) {
    // Keep a piece only when the rest of `to` still fits after it, so what
    // goes is the later copy: "A, B, A, C" loses its second A, not its first.
    if (j < b.length && a[i] === b[j] && longest[i + 1]![j + 1] === b.length - j - 1) {
      put('same', a[i]!)
      j++
    } else put('gone', a[i]!)
  }
  return parts
}

/** Rule-found changes start ticked; the model's wait for a yes. */
export function tickedAtFirst(changes: readonly Reviewed[]): Set<string> {
  return new Set(changes.filter(here => here.change.by === 'rule').map(here => here.change.key))
}

/**
 * A tag change as this device has it. An add keeps only songs still without
 * the tag and a remove only songs still with it, so an approval never undoes
 * an edit made since; a change to a tag that is gone, or a rename onto a name
 * taken since, is left out.
 */
export interface TagHere extends Reviewed {
  readonly change: TagChange
  /** The tag here; null only for an add that makes it. */
  readonly tag: Tag | null
  /** The tag a merge goes into. */
  readonly into: Tag | null
}

export function tagChangesHere(
  changes: readonly TagChange[],
  onDevice: (serverId: number) => number | undefined,
  songsById: ReadonlyMap<number, Song>,
  tags: readonly Tag[],
): TagHere[] {
  const named = (name: string | null): Tag | null =>
    name === null ? null : (tags.find(tag => tag.name.toLowerCase() === name.toLowerCase()) ?? null)
  return changes.flatMap((change): TagHere[] => {
    const tag = named(change.tag)
    if (change.op === 'add' || change.op === 'remove') {
      if (!tag && (change.op === 'remove' || !change.isNew)) return []
      const songIds = change.songIds.flatMap(serverId => {
        const id = onDevice(serverId)
        const song = id === undefined ? undefined : songsById.get(id)
        if (!song) return []
        const has = tag !== null && song.tagIds.includes(tag.id)
        return has === (change.op === 'remove') ? [song.id] : []
      })
      return songIds.length > 0 ? [{ change, songIds, tag, into: null }] : []
    }
    if (!tag) return []
    if (change.op === 'merge') {
      const into = named(change.to)
      return into && into.id !== tag.id ? [{ change, songIds: [], tag, into }] : []
    }
    if (change.op === 'rename') {
      const taken = named(change.to)
      return change.to && (!taken || taken.id === tag.id)
        ? [{ change, songIds: [], tag, into: null }]
        : []
    }
    return [{ change, songIds: [], tag, into: null }]
  })
}

/** A tag by its id, or one made earlier in the same apply, by its name. */
export type TagRef = { readonly id: number } | { readonly name: string }

/** A live playlist's rules, kept to put back. */
interface RulesBefore {
  readonly id: number
  readonly rules: SmartRules
}

/** One step of applying tag changes, in the order they run. */
export type TagStep =
  | { readonly kind: 'make'; readonly name: string }
  | {
      readonly kind: 'songs'
      readonly action: 'add' | 'remove'
      readonly tag: TagRef
      readonly songIds: readonly number[]
    }
  | { readonly kind: 'rename'; readonly tagId: number; readonly from: string; readonly to: string }
  | {
      readonly kind: 'merge'
      readonly from: Tag
      readonly into: Tag
      /** The songs it held, to give back on Undo. */
      readonly songIds: readonly number[]
      /** Its songs without `into` yet: the ones that gain it. */
      readonly gaining: readonly number[]
      readonly playlists: readonly RulesBefore[]
    }
  | {
      readonly kind: 'delete'
      readonly tag: Tag
      readonly songIds: readonly number[]
      readonly playlists: readonly RulesBefore[]
    }

/** A live playlist's rules with one tag swapped for another, a rule that repeats dropped. */
export function swapTagInRules(rules: SmartRules, from: number, to: number): SmartRules {
  const out: SmartRules['rules'] = []
  for (const rule of rules.rules) {
    const swapped = rule.field === 'tag' && rule.tagId === from ? { ...rule, tagId: to } : rule
    const repeat = out.some(
      other =>
        other.field === 'tag' &&
        swapped.field === 'tag' &&
        other.tagId === swapped.tagId &&
        other.op === swapped.op,
    )
    if (!repeat) out.push(swapped)
  }
  return { ...rules, rules: out }
}

/** The live playlists that follow a tag, with their rules as they are. */
function followersOf(tagId: number, playlists: readonly Playlist[]): RulesBefore[] {
  return playlists.flatMap(playlist =>
    playlist.kind === 'live' &&
    playlist.rules.rules.some(rule => rule.field === 'tag' && rule.tagId === tagId)
      ? [{ id: playlist.id, rules: playlist.rules }]
      : [],
  )
}

/**
 * The approved tag changes as the steps that make them: new tags first, then
 * songs in and out of tags, then renames, merges and deletes, so a change to
 * songs always finds its tag by the id it has now. A merge gives its songs the
 * tag it goes into, moves the playlists following it over, then deletes it.
 */
export function tagSteps(
  approved: readonly TagHere[],
  leftOut: ReadonlySet<string>,
  songs: readonly Song[],
  playlists: readonly Playlist[],
): TagStep[] {
  const make: TagStep[] = []
  const members: TagStep[] = []
  const renames: TagStep[] = []
  const merges: TagStep[] = []
  const deletes: TagStep[] = []
  const holding = (tag: Tag): number[] =>
    songs.filter(song => song.tagIds.includes(tag.id)).map(song => song.id)
  for (const here of approved) {
    const { change, tag } = here
    switch (change.op) {
      case 'add':
      case 'remove': {
        const songIds = keptSongs(here, leftOut)
        if (songIds.length === 0) break
        if (!tag) make.push({ kind: 'make', name: change.tag })
        members.push({
          kind: 'songs',
          action: change.op,
          tag: tag ? { id: tag.id } : { name: change.tag },
          songIds,
        })
        break
      }
      case 'rename':
        renames.push({ kind: 'rename', tagId: tag!.id, from: tag!.name, to: change.to! })
        break
      case 'merge': {
        const songIds = holding(tag!)
        const gaining = songs
          .filter(song => song.tagIds.includes(tag!.id) && !song.tagIds.includes(here.into!.id))
          .map(song => song.id)
        merges.push({
          kind: 'merge',
          from: tag!,
          into: here.into!,
          songIds,
          gaining,
          playlists: followersOf(tag!.id, playlists),
        })
        break
      }
      case 'delete':
        deletes.push({
          kind: 'delete',
          tag: tag!,
          songIds: holding(tag!),
          playlists: followersOf(tag!.id, playlists),
        })
        break
    }
  }
  return [...make, ...members, ...renames, ...merges, ...deletes]
}

/** "Put on songs", "Take off songs", …: the heading a tag change is listed under. */
export function tagSection(change: TagChange): string {
  switch (change.op) {
    case 'add':
      return 'Put on songs'
    case 'remove':
      return 'Take off songs'
    case 'rename':
      return 'Rename'
    case 'merge':
      return 'Merge'
    case 'delete':
      return 'Delete'
  }
}

/** "calmest first", "newest first": an order said the way a person would. */
export function sortWords(by: AskSort, order: AskOrder): string {
  const up = order === 'asc'
  switch (by) {
    case 'energy':
      return up ? 'calmest first' : 'liveliest first'
    case 'bpm':
      return up ? 'slowest first' : 'fastest first'
    case 'year':
      return up ? 'oldest release first' : 'newest release first'
    case 'title':
      return up ? 'by title, A to Z' : 'by title, Z to A'
    case 'artist':
      return up ? 'by artist, A to Z' : 'by artist, Z to A'
    case 'addedAt':
      return up ? 'oldest first' : 'newest first'
    case 'duration':
      return up ? 'shortest first' : 'longest first'
    case 'plays':
      return up ? 'least played first' : 'most played first'
    case 'lastPlayed':
      return up ? 'longest unplayed first' : 'most recently played first'
  }
}

/**
 * A playlist edit in this device's songs, against the playlist as it is now:
 * an add keeps the songs not in it, a remove the ones still in it, and a sort
 * is the new order with any song added since kept at the end.
 */
export function playlistEditHere(
  answer: Extract<AskAnswer, { kind: 'playlistSongs' }>,
  onDevice: (serverId: number) => number | undefined,
  current: readonly number[],
): { songIds: number[]; why: Map<number, string> } {
  const inIt = new Set(current)
  const why = new Map<number, string>()
  const mapped = answer.songs.flatMap(pick => {
    const id = onDevice(pick.songId)
    if (id === undefined) return []
    if (pick.why) why.set(id, pick.why)
    return [id]
  })
  if (answer.op === 'sort') {
    const order = mapped.filter(id => inIt.has(id))
    const placed = new Set(order)
    return { songIds: [...order, ...current.filter(id => !placed.has(id))], why }
  }
  const adding = answer.op === 'add'
  return { songIds: mapped.filter(id => inIt.has(id) !== adding), why }
}
