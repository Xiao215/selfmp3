import { z } from 'zod/v4'
import type { Song, Tag } from '@selfmp3/shared'

/**
 * The songs a request points at rather than describes — the one playing, when
 * they say "this" — named by a handle a form can hold and resolved here, in
 * code, to the songs themselves. A pipeline given a scope looks at those songs
 * and no others, so "tag this one 粤语" touches exactly the song playing.
 *
 * The one handle today is `playing`. Ask's agent (AGENT-DESIGN, the working
 * set) adds an earlier answer's songs under handles of their own; the tag
 * review, Tidy up and Copies take the songs, whichever handle named them.
 */

export const SCOPE_HANDLES = ['playing'] as const
export type ScopeHandle = (typeof SCOPE_HANDLES)[number]

/** A form's way to say which songs: a handle, or null for the songs the words describe. */
export const ScopeField = z.enum(SCOPE_HANDLES).nullable()

/** How a form fills `from`, in the words every form uses. */
export const SCOPE_WHEN =
  'from is "playing" when the request points at the song playing instead of describing which songs, else null.'

/** What the handles can name on this request. */
export interface Held {
  readonly playing: Song | undefined
}

/**
 * The songs a handle names, or null for no handle. Empty when it names
 * nothing here (nothing is playing): the caller says so rather than
 * falling back to the whole library.
 */
export function scopeOf(from: ScopeHandle | null, held: Held): readonly Song[] | null {
  if (from === null) return null
  return held.playing ? [held.playing] : []
}

/** The songs each handle names, as a prompt lists them: `handle: title | artist | album | tags`. */
export function scopeLines(held: Held, tags: readonly Tag[]): string {
  const names = new Map(tags.map(tag => [tag.id, tag.name]))
  const line = (handle: ScopeHandle, song: Song): string =>
    `${handle}: ${song.title} | ${song.artist || '-'} | ${song.album || '-'} | ${
      song.tagIds.map(id => names.get(id) ?? '?').join(', ') || 'no tags'
    }`
  return held.playing ? line('playing', held.playing) : ''
}
