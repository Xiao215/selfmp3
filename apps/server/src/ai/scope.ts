import type { AskObject, Song, Understanding } from '@selfmp3/shared'

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

/** Which songs: a handle and places in its list, or null for none named. */
type Scope = {
  readonly handle: string
  /** Places in the handle's numbered list, 1 for the first; null for all of it. */
  readonly picks: readonly number[] | null
} | null

/** What the handles can name on this request. */
export interface Held {
  readonly playing: Song | undefined
  /** What the earlier answers showed, sent back by the device. */
  readonly objects: readonly AskObject[]
  /** The handle of the answer on their screen, when one is. */
  readonly screen?: string | null
}

/** The object a handle names, or undefined. */
function heldObject(held: Held, handle: string): AskObject | undefined {
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
  return atPlaces(object.songIds, from.picks).flatMap(id => byId.get(id) ?? [])
}

/**
 * The items at places in a list, 1 for the first, once each and in the order
 * named; a place past the end names nothing. Null places: the whole list.
 * Every way of naming "the 3rd one" comes here, a handle's list or a set's.
 */
export function atPlaces<T>(list: readonly T[], places: readonly number[] | null): T[] {
  if (places === null) return [...list]
  return [...new Set(places)].flatMap(place => (place >= 1 ? (list[place - 1] ?? []) : []))
}

/** What a list was made from, in a line: what a change to it chooses again from. */
function understoodWords(understanding: Understanding): string {
  const range = (what: string, r: { min: number | null; max: number | null }): string =>
    r.min === null && r.max === null ? '' : `${what} ${r.min ?? '…'}–${r.max ?? '…'}`
  return [
    understanding.artists.length > 0 ? `artists ${understanding.artists.join(', ')}` : '',
    understanding.albums.length > 0 ? `albums ${understanding.albums.join(', ')}` : '',
    understanding.anyTags.length > 0 ? `tags ${understanding.anyTags.join(', ')}` : '',
    understanding.noTags.length > 0 ? `not tagged ${understanding.noTags.join(', ')}` : '',
    range('energy', understanding.energy),
    range('bpm', understanding.bpm),
    range('year', understanding.year),
    understanding.words ? `${understanding.words} lyrics` : '',
    understanding.loved !== null ? (understanding.loved ? 'loved' : 'not loved') : '',
    understanding.playedWithinDays ? `played within ${understanding.playedWithinDays} days` : '',
    understanding.notPlayedWithinDays
      ? `not played within ${understanding.notPlayedWithinDays} days`
      : '',
    understanding.addedWithinDays ? `added within ${understanding.addedWithinDays} days` : '',
    understanding.size ? `${understanding.size} songs` : '',
    understanding.minutes ? `${understanding.minutes} minutes` : '',
    understanding.sound ? `sound “${understanding.sound}”` : '',
    understanding.brief ? `brief “${understanding.brief}”` : '',
  ]
    .filter(Boolean)
    .join('; ')
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
  const understood = object.understanding ? understoodWords(object.understanding) : ''
  return [
    `${object.handle} — “${object.label}” (${what}), ${object.songIds.length} songs:`,
    ...(understood ? [`  made from: ${understood}`] : []),
    ...rows,
    ...(more > 0 ? [`  …and ${more} more`] : []),
  ].join('\n')
}
