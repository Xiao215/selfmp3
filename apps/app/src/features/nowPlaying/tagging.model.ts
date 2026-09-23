import type { Song } from '@selfmp3/shared'
import { isUntagged } from '../tag/tag.model'

/**
 * Play-and-tag, with nothing drawn (docs/UI-MIGRATION.md, Open question 1).
 *
 * All tags' "N songs have no tag yet" card plays those songs and opens Now
 * Playing with `?tagging=1`. The tag editor comes up for the song playing;
 * giving it a tag and closing the editor starts the next one, with the editor
 * up again. The picker saves every tick as it is made, so there is no Save to
 * wait for: closing it is the moment the song is judged.
 */

/** The address's `tagging` param, on or off. */
export function parseTagging(value: unknown): boolean {
  return value === '1'
}

/**
 * What closing the editor does.
 *
 * - `next`: the song has a tag, and there is another to play.
 * - `end`: the song has a tag, and it was the last: the queue ran out.
 * - `stop`: closed without a tag, which is how a person says "enough".
 * - `wait`: a tick is still on its way to the server, and the song as the
 *   library has it does not show it yet. Judged again once it lands, so a
 *   quick tick-and-close is not read as closing with nothing.
 */
export type TagCloseStep = 'next' | 'end' | 'stop' | 'wait'

export function tagCloseStep({
  tagged,
  saving,
  hasNext,
}: {
  /** Whether the song, as the library has it now, has at least one tag. */
  tagged: boolean
  /** Whether a change to this song's tags has been sent and not yet answered. */
  saving: boolean
  hasNext: boolean
}): TagCloseStep {
  if (saving) return 'wait'
  if (!tagged) return 'stop'
  return hasNext ? 'next' : 'end'
}

/**
 * How many songs are left to tag: the one playing and those after it that
 * still have none. A song already tagged further on is not one to go, and the
 * one playing drops out of the count the moment it is given a tag.
 */
export function taggingLeft(songs: readonly Pick<Song, 'tagIds'>[], index: number): number {
  let left = 0
  for (let i = Math.max(0, index); i < songs.length; i += 1) {
    const song = songs[i]
    if (song && isUntagged(song)) left += 1
  }
  return left
}

/** "Tagging · 3 to go", the quiet line that says the page is in this mode. */
export function taggingLine(left: number): string {
  return left === 0 ? 'Tagging · all tagged' : `Tagging · ${left.toLocaleString()} to go`
}
