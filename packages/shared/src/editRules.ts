import { hueFromString } from './format.js'
import type { EditRefusal, PlaylistKind } from './schemas/playlist.js'
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

/** A new tag's colour: the one asked for, or one its name always gives. */
export function newTagHue(name: string, hue: number | undefined): number {
  return hue ?? hueFromString(name.toLowerCase())
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
