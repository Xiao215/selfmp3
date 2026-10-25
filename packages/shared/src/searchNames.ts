import { artistKey, splitArtists } from './artists.js'
import type { Library } from './schemas/library.js'
import type { Song } from './schemas/song.js'

/**
 * The names search finds things by, besides the ones they are shown by.
 *
 * A Chinese or Japanese name is found typed in Latin letters, through its
 * spellings (`Library.spellings`: 周杰伦 as "zhou jie lun", and by its
 * initials "zjl"), and an artist is found by the names they also go by
 * (`Library.artistNames`: 周杰伦 as "Jay Chou", 幾田りら as "ikura"). Both are
 * the server's to work out and travel with the library, so search on a phone
 * away from the server finds them too.
 */

export type LibraryNames = Pick<Library, 'artistNames' | 'spellings'>

export const NO_NAMES: LibraryNames = { artistNames: {}, spellings: {} }

/**
 * A name's entry in `artistNames` or `spellings`. The records come as JSON, so
 * a name that is also an object's own key ("constructor", "__proto__") must
 * not find what every object inherits: search read a function as a list and
 * every device's Search crashed on such a song.
 */
export function namesFor(
  record: Readonly<Record<string, readonly string[]>>,
  name: string,
): readonly string[] {
  return Object.hasOwn(record, name) ? (record[name] ?? []) : []
}

/** Chinese or Japanese: what pinyin and romaji spell. Korean has neither here. */
const SPELT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

/** Whether a name needs spelling in Latin letters to be found by them. */
export function needsSpelling(name: string): boolean {
  return SPELT.test(name)
}

/**
 * A name, then its spelling when it has one — spaced, so each word's initial
 * counts ("zjl"), and run together, since the spaces fall where the
 * dictionary splits words and not where a person typing would ("ikuta").
 */
function withSpelling(name: string, names: LibraryNames, into: string[]): void {
  if (!name) return
  into.push(name)
  for (const spelt of namesFor(names.spellings, name)) {
    into.push(spelt)
    const joined = spelt.replace(/\s+/g, '')
    if (joined !== spelt) into.push(joined)
  }
}

/** An artist's name, their other names, and each of those spelt. */
export function artistSearchNames(name: string, names: LibraryNames): string[] {
  const found: string[] = []
  withSpelling(name, names, found)
  for (const other of namesFor(names.artistNames, artistKey(name))) {
    withSpelling(other, names, found)
  }
  return found
}

/**
 * Every name a song is found by. First the title, artist and album together,
 * as search has always read a song — "yoasobi idol" across two of them — and
 * then each of them alone, spelt, and each of its artists' other names.
 */
export function songSearchNames(
  song: Pick<Song, 'title' | 'artist' | 'album'>,
  names: LibraryNames,
): string[] {
  const found = [`${song.title} ${song.artist} ${song.album}`]
  withSpelling(song.title, names, found)
  for (const artist of splitArtists(song.artist)) {
    found.push(...artistSearchNames(artist, names))
  }
  withSpelling(song.album, names, found)
  return found
}

/**
 * Every name in a library that needs a spelling: titles, artists, albums and
 * the names artists also go by that are written in Chinese or Japanese. What
 * the server spells (services/spellings.ts).
 */
export function namesToSpell(
  songs: readonly Pick<Song, 'title' | 'artist' | 'album'>[],
  artistNames: Readonly<Record<string, readonly string[]>>,
): Set<string> {
  const wanted = new Set<string>()
  const add = (name: string): void => {
    if (name && needsSpelling(name)) wanted.add(name)
  }
  for (const song of songs) {
    add(song.title)
    add(song.album)
    for (const artist of splitArtists(song.artist)) add(artist)
  }
  for (const others of Object.values(artistNames)) for (const other of others) add(other)
  return wanted
}
