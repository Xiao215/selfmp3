import { z } from 'zod/v4'
import type { AskObject, Song } from '@selfmp3/shared'

/**
 * The songs a request points at rather than describes, named by a handle a
 * form can hold and resolved here, in code, to the songs themselves: the one
 * playing, when they say "this", or what an earlier answer showed, by the
 * handle the device gave it (`t2.1`, AGENT-DESIGN 2.1), with places in its
 * list when they mean some of it ("the 3rd one"). A pipeline given a scope
 * looks at those songs and no others, so "tag this one 粤语" touches exactly
 * the song playing and "add these to gym" exactly the songs shown.
 *
 * The handles are what Ask's agent's working set will hold (AGENT-DESIGN
 * 2.2): the tag review, Tidy up, Copies and a playlist's songs take the songs,
 * whichever handle named them.
 */

/** The handle for the song playing on the asking device. */
export const PLAYING = 'playing'

/** A form's way to say which songs: a handle and places in it, or null for the songs the words describe. */
export const ScopeField = z
  .object({
    handle: z.string().max(12),
    /** Places in the handle's numbered list, 1 for the first; null for all of it. */
    picks: z.array(z.number().int().min(1).max(200)).max(50).nullable(),
  })
  .nullable()
export type Scope = z.infer<typeof ScopeField>

/** How a form fills a scope, in the words every form uses. */
export const SCOPE_WHEN =
  'from names songs already in front of them instead of describing which songs: handle is "playing" for the song playing, or an earlier answer\'s handle for what it showed; picks are places in that answer\'s numbered list when they mean only some of it (1 for the first, and one place when they speak of one song), else null. Otherwise from is null.'

/** What the handles can name on this request. */
export interface Held {
  readonly playing: Song | undefined
  /** What the earlier answers showed, sent back by the device. */
  readonly objects: readonly AskObject[]
}

export const NOTHING_HELD: Held = { playing: undefined, objects: [] }

/** The object a handle names, or undefined. */
export function heldObject(held: Held, handle: string): AskObject | undefined {
  return held.objects.find(object => object.handle === handle)
}

/**
 * The songs a scope names, in its order, or null for no scope. Only songs the
 * library has: an id the device sent that is not one of them is dropped, as is
 * a place past the end of the list. Empty when it names nothing here (nothing
 * playing, a handle not in the conversation): the caller says so rather than
 * falling back to the whole library.
 */
export function scopeOf(from: Scope, held: Held, songs: readonly Song[]): readonly Song[] | null {
  if (from === null) return null
  if (from.handle === PLAYING) return held.playing ? [held.playing] : []
  const object = heldObject(held, from.handle)
  if (!object) return []
  const byId = new Map(songs.map(song => [song.id, song]))
  const ids = from.picks
    ? [...new Set(from.picks)].flatMap(place => object.songIds[place - 1] ?? [])
    : object.songIds
  return ids.flatMap(id => byId.get(id) ?? [])
}

/** Why each song of an object is in it, by id, where the answer said. */
export function whyOf(object: AskObject): ReadonlyMap<number, string | null> {
  return new Map(object.songIds.map((id, index) => [id, object.why[index] ?? null]))
}

/** Why a scope's songs fit, by id, from the object it names. */
export function scopeWhy(from: Scope, held: Held): ReadonlyMap<number, string | null> {
  const object = from && from.handle !== PLAYING ? heldObject(held, from.handle) : undefined
  return object ? whyOf(object) : new Map()
}

/** The most rows of an object a prompt lists. */
const LISTED = 40
/** How much of a song's why a prompt carries. */
const WHY_SHOWN = 80

/**
 * An object as a prompt sets it out: its handle, what it is, and its songs
 * numbered in the order shown — `3. 大海 · 张雨生 (why: …)` — so "the 3rd one",
 * "大海" and "those" can be named by handle and place. Ids stay out: the model
 * names songs by place and code turns places into ids.
 */
export function objectLines(object: AskObject, songs: ReadonlyMap<number, Song>): string {
  const what = [
    object.kind,
    object.lead ? `offered to ${object.lead === 'next' ? 'play next' : object.lead}` : '',
    object.playlist ? `for the playlist “${object.playlist}”` : '',
  ]
    .filter(Boolean)
    .join(', ')
  const rows = object.songIds.slice(0, LISTED).flatMap((id, index) => {
    const song = songs.get(id)
    if (!song) return []
    const why = object.why[index]
    const said = why
      ? ` (why: ${why.length > WHY_SHOWN ? `${why.slice(0, WHY_SHOWN - 1)}…` : why})`
      : ''
    return [`  ${index + 1}. ${song.title} · ${song.artist || '-'}${said}`]
  })
  const more = object.songIds.length - LISTED
  return [
    `${object.handle} — “${object.label}” (${what}), ${object.songIds.length} songs:`,
    ...rows,
    ...(more > 0 ? [`  …and ${more} more`] : []),
  ].join('\n')
}
