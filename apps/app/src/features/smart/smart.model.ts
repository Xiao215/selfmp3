import { ApiError } from '@selfmp3/client'
import type {
  AiCheck,
  AskPlace,
  BulkEditSongs,
  Song,
  TidyChange,
  AskStatsRange,
  DescribeResult,
  Tag,
  TagSuggestion,
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

/** What a describe answer says beside its songs: what fit, and what it set aside. */
export function describeNotes(result: DescribeResult, picked: number): string[] {
  const notes: string[] = []
  notes.push(
    result.fit === picked
      ? `${picked} song${picked === 1 ? '' : 's'} fit`
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

export interface SuggestionHere {
  readonly suggestion: TagSuggestion
  /** This device's song ids, for the songs it has. */
  readonly songIds: number[]
  /** The tag here, or null for a tag that would be made. */
  readonly tag: Tag | null
}

/** Suggestions in this device's terms; one left with no song here is dropped. */
export function suggestionsHere(
  suggestions: readonly TagSuggestion[],
  onDevice: (serverId: number) => number | undefined,
  tags: readonly Tag[],
): SuggestionHere[] {
  return suggestions.flatMap(suggestion => {
    const songIds = suggestion.songIds.flatMap(id => {
      const here = onDevice(id)
      return here === undefined ? [] : [here]
    })
    if (songIds.length === 0) return []
    const tag = tags.find(each => each.name.toLowerCase() === suggestion.tag.toLowerCase()) ?? null
    return [{ suggestion, songIds, tag }]
  })
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

/** Where an "open" answer goes. */
export function placePath(place: AskPlace): string {
  return `/${place}`
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

/**
 * The first leg, from what asking the server for its smart setup did. A 404 is
 * a server older than the check itself, which is said as that: restarting it
 * is the fix, and "no such endpoint" would not say so.
 */
export function serverHop(result: { ms: number } | { error: unknown }): Hop {
  if ('ms' in result)
    return { ok: true, line: `This device reached your server in ${took(result.ms)}` }
  const { error } = result
  if (error instanceof ApiError && error.status === 404) {
    return {
      ok: false,
      line: 'Your server is older than this app. Restart it with the current build, then test again.',
    }
  }
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

/** A Tidy up change as this device has it: its own song ids, still as the change found them. */
export interface TidyHere {
  readonly change: TidyChange
  readonly songIds: readonly number[]
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

/** One reason and its changes, in the order the server gave them. */
interface TidyReason {
  readonly why: string
  readonly changes: TidyHere[]
}

/**
 * The changes in two bands by how far to trust them: what a plain rule found,
 * then the model's guesses, each under its reasons. An empty band is left out.
 */
export function tidyBands(
  changes: readonly TidyHere[],
): { by: TidyChange['by']; reasons: TidyReason[] }[] {
  return (['rule', 'model'] as const).flatMap(by => {
    const reasons = new Map<string, TidyReason>()
    for (const here of changes) {
      if (here.change.by !== by) continue
      const reason = reasons.get(here.change.why) ?? { why: here.change.why, changes: [] }
      reason.changes.push(here)
      reasons.set(here.change.why, reason)
    }
    return reasons.size > 0 ? [{ by, reasons: [...reasons.values()] }] : []
  })
}

/** A song left out of a change it would otherwise be part of. */
export function leftOutKey(changeKey: string, songId: number): string {
  return `${changeKey}:${songId}`
}

/** The songs of a change still in it: all of them, less the ones left out. */
export function tidyKept(here: TidyHere, leftOut: ReadonlySet<string>): number[] {
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
    for (const id of tidyKept(here, leftOut)) {
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
export function tickedAtFirst(changes: readonly TidyHere[]): Set<string> {
  return new Set(changes.filter(here => here.change.by === 'rule').map(here => here.change.key))
}
