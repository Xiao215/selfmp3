import { hueFromString } from './format.js'
import type { EditRefusal, PlaylistKind } from './schemas/playlist.js'
import type { SmartRules } from './schemas/smart.js'
import { sameTagName } from './sync.js'

/**
 * The rules an edit follows, whoever answers it (docs/SYNC.md).
 *
 * An edit reaches one of two answerers: a server, which changes its database
 * (apps/server/src/routes), or this device's copy of a cloud library, which
 * records it as a change for the bucket (packages/replica/src/edits.ts). Each
 * once had its own copy of these, and they drifted: a phone refused to
 * reorder a playlist that follows tags long after the server had learned to.
 * So what an edit may do, and the parts of it that are plain arithmetic, live
 * here, and both answerers call them — with `playlistPatchProblem`, which the
 * replay of the change log needs too, beside the playlist's schema.
 */

const badRequest = (message: string): EditRefusal => ({
  status: 400,
  code: 'bad_request',
  message,
})

// --- Playlists -------------------------------------------------------------------

/**
 * Why songs cannot be put into, or taken out of, a playlist of this kind by
 * hand: one that follows tags builds itself. Null for a manual playlist.
 */
export function playlistSongsProblem(kind: PlaylistKind): EditRefusal | null {
  return kind === 'live'
    ? badRequest('a live playlist builds itself — edit its rules instead')
    : null
}

/**
 * Adding songs, none of which are in the library: refused, where a list with
 * some songs gone since the screen was drawn adds the rest.
 */
export function noSongsProblem(found: number): EditRefusal | null {
  return found === 0 ? badRequest('none of those songs exist') : null
}

/**
 * A playlist's order with songs put in at `position` (clamped to the list),
 * leaving out any it already has, which keep their place.
 */
export function insertedAt<T>(
  current: readonly T[],
  incoming: readonly T[],
  position: number,
): T[] {
  const already = new Set(current)
  const added = [...new Set(incoming)].filter(item => !already.has(item))
  const at = Math.min(Math.max(position, 0), current.length)
  return [...current.slice(0, at), ...added, ...current.slice(at)]
}

/**
 * The rule's answer, in the order it was put in by hand.
 *
 * A playlist that follows tags can still be reordered (Xiao, 2026-09-21). The
 * rule decides *which* songs; the order kept by hand decides where the ones it
 * names go, and whatever the rule has matched since — which that order has
 * never heard of — follows at the end in the rule's own order. A song that
 * stops matching keeps its place silently, so tagging it again puts it back
 * where you had it rather than at the bottom.
 */
export function inKeptOrder<T>(kept: readonly T[], matched: readonly T[]): T[] {
  if (kept.length === 0) return [...matched]
  const place = new Map(kept.map((item, at) => [item, at]))
  const known: T[] = []
  const rest: T[] = []
  for (const item of matched) (place.has(item) ? known : rest).push(item)
  known.sort((a, b) => (place.get(a) ?? 0) - (place.get(b) ?? 0))
  return [...known, ...rest]
}

// --- Tags ------------------------------------------------------------------------

/** The tag with this name, by the one comparison names are told apart with (`sameTagName`). */
export function tagNamed<T extends { readonly name: string }>(
  tags: readonly T[],
  name: string,
): T | null {
  return tags.find(tag => sameTagName(tag.name, name)) ?? null
}

/**
 * The hues a tag is offered: thirteen around the wheel, skipping the muddy
 * stretch between yellow and green where chips stop looking like different
 * colours from each other.
 */
export const TAG_HUES = [0, 22, 40, 58, 95, 140, 168, 192, 212, 235, 262, 290, 318] as const

/** How far apart two hues are, the short way round the wheel. */
function hueGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return Math.min(d, 360 - d)
}

/**
 * A new tag's colour: the one asked for, or else the offered hue farthest
 * from every hue `inUse` (X5, 2026-10-25: "calm" came out the red "live"
 * already was, when its name alone chose). Among hues as far, the one
 * nearest the hue its name gives, so the same library and name always give
 * the same colour.
 */
export function newTagHue(name: string, hue: number | undefined, inUse: readonly number[]): number {
  if (hue !== undefined) return hue
  const own = hueFromString(name.toLowerCase())
  if (inUse.length === 0) return own
  const room = (candidate: number): number =>
    Math.min(...inUse.map(used => hueGap(candidate, used)))
  let best: number = TAG_HUES[0]
  for (const candidate of TAG_HUES) {
    const more = room(candidate) - room(best)
    if (more > 0 || (more === 0 && hueGap(candidate, own) < hueGap(best, own))) best = candidate
  }
  return best
}

/** Why tag `id` cannot be called `name`: another tag already is. Null when it can. */
export function tagRenameProblem(
  tags: readonly { readonly id: number; readonly name: string }[],
  id: number,
  name: string | undefined,
): EditRefusal | null {
  if (name === undefined) return null
  const clash = tags.find(tag => tag.id !== id && sameTagName(tag.name, name))
  return clash
    ? { status: 409, code: 'conflict', message: `a tag called "${name}" already exists` }
    : null
}

/**
 * A song's tags after a change: the ones it had, with `add` put on and
 * `remove` taken off. A tag edit says only what it changes, never the whole
 * set — a whole set worked out on one device took off whatever another device
 * had put on meanwhile (a picker left open, an edit made offline).
 */
export function tagsAfter<T>(had: readonly T[], add: readonly T[], remove: readonly T[]): T[] {
  const gone = new Set(remove)
  return [...new Set([...had, ...add])].filter(tag => !gone.has(tag))
}

/**
 * A song's tags set all at once, as the tags that go on and the ones that come
 * off — which are what each answerer stamps, or records, one by one.
 */
export function tagFlips<T>(had: readonly T[], wanted: readonly T[]): { on: T[]; off: T[] } {
  const before = new Set(had)
  const after = new Set(wanted)
  return {
    on: [...after].filter(tag => !before.has(tag)),
    off: [...before].filter(tag => !after.has(tag)),
  }
}

// --- Removing tags ----------------------------------------------------------------

/**
 * Whether a live playlist's rules name this tag, so that deleting it changes
 * the playlist: it keeps the songs it shows and stops following.
 *
 * Left alone, a rule about a tag nobody can see or remove made "has" playlists
 * empty (and so hidden) and "does not have" ones the whole library. Taking
 * just that rule out is no better whenever there are others: under "all" a
 * dropped rule widens the playlist ("has chill and not loved" became every
 * song not loved), under "any" it narrows it. Either way the playlist would
 * silently show other songs, so it keeps the ones it has instead.
 */
export function followsTag(rules: SmartRules, tagId: number): boolean {
  return rules.rules.some(rule => rule.field === 'tag' && rule.tagId === tagId)
}

// --- Removing songs --------------------------------------------------------------

/**
 * The tags that removing these songs leaves with none: those whose every song
 * is among them. They go with the songs, everywhere — as a change of their
 * own in the log, so every device and the server lose exactly these — rather
 * than linger at 0 in every sidebar. A tag that had no songs to begin with is
 * not among them: one just made, here or on another device, is yours to fill.
 */
export function tagsEmptiedBy(
  tags: readonly { readonly id: number; readonly songCount: number }[],
  removed: readonly { readonly tagIds: readonly number[] }[],
): number[] {
  const losing = new Map<number, number>()
  for (const song of removed) {
    for (const tagId of new Set(song.tagIds)) losing.set(tagId, (losing.get(tagId) ?? 0) + 1)
  }
  return tags
    .filter(tag => tag.songCount > 0 && (losing.get(tag.id) ?? 0) >= tag.songCount)
    .map(tag => tag.id)
}
