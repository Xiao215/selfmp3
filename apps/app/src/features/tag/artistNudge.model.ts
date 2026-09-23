import type { Artist } from '@selfmp3/shared'

/**
 * The nudge a new tag gets when its name is an artist's (docs/ui-mock `P11`),
 * without the dialog.
 *
 * Most people typing an artist's name as a tag wanted the artist, which is
 * already a place of its own with every one of their songs. So it is offered
 * first; anyone who meant a tag of their own still gets one.
 */

/** `New tag: "yorushika"`, as it was typed, as `P11` draws it. */
export function nudgeTitle(name: string): string {
  return `New tag: "${name.trim()}"`
}

/** What the artist already is, and what a tag is for instead. */
export function nudgeBody(artist: Pick<Artist, 'name' | 'songIds'>): string {
  const count = artist.songIds.length
  const songs = `${count.toLocaleString()} ${count === 1 ? 'song' : 'songs'}`
  return `${artist.name} is already an artist here, with their ${songs}. A tag is for songs you choose, whoever made them.`
}
