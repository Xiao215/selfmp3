import {
  ASK_ANSWERED_MAX,
  ASK_BEFORE_MAX,
  ASK_OBJECT_SONGS,
  ASK_TEXT_MAX,
  type AskAnswer,
  type AskObject,
  type AskPlaybackOp,
  type AskStatsRange,
  type AskTurn,
  type DescribeResult,
  type Understanding,
} from './schemas/ai.js'
import { plural } from './format.js'

/**
 * An Ask conversation as a device sends it back (docs/features/ai.md,
 * "Follow-ups"): each answer's recap in words and its objects by handle, and
 * the turns a follow-up is asked after. Here rather than in the app because
 * the server's eval harness (apps/server/src/ai/eval) replays conversations
 * exactly the way the app sends them, and two copies would drift.
 */

/** A turn as `beforeTurn` reads it: the app's own carries more. */
interface AskedTurn {
  readonly asked: string
  /** What its answer showed, in words (`answerRecap`); null until it is answered. */
  readonly answered: string | null
  /** What came of a proposal once it was acted on or put aside ("Fixed 31 songs"). */
  readonly outcome: string | null
  readonly objects: readonly AskObject[]
}

/** Whether words are more than Ask takes: they are never sent, and the turn says so. */
export function tooLongToAsk(asked: string): boolean {
  return asked.length > ASK_TEXT_MAX
}

/**
 * The conversation the turn at `index` is asked after (F1): each turn before
 * it with what was shown for it and its objects, and what came of a proposal
 * once it did. A long conversation sends only its newest turns, as many as
 * the server hears, and the one whose answer is on the screen (`screen`, a
 * handle) wherever it is, so "these" can be acted on however long ago it was
 * asked; a question too long to have been asked is left out, and a recap cut
 * to what the server takes for one.
 */
export function beforeTurn(
  turns: readonly AskedTurn[],
  index: number,
  screen: string | null = null,
): readonly AskTurn[] {
  const asked = turns.slice(0, index).filter(turn => !tooLongToAsk(turn.asked))
  const onScreen = asked.find(turn => turn.objects.some(object => object.handle === screen))
  const newest = asked.slice(-ASK_BEFORE_MAX)
  const sent =
    onScreen && !newest.includes(onScreen)
      ? [onScreen, ...asked.slice(-(ASK_BEFORE_MAX - 1))]
      : newest
  return sent.map(turn => {
    const answered = turn.outcome
      ? `${turn.answered ?? ''}\nThen: ${turn.outcome}`
      : (turn.answered ?? '')
    return {
      asked: turn.asked,
      answered:
        answered.length > ASK_ANSWERED_MAX
          ? `${answered.slice(0, ASK_ANSWERED_MAX - 1)}…`
          : answered,
      objects: [...turn.objects],
    }
  })
}

/** A stats range in words: "the last 7 days". */
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

/** A playback answer's request in words, before the device has said what came of it. */
export const PLAYBACK_ASKED: Readonly<Record<AskPlaybackOp, string>> = {
  next: 'skip to the next song',
  previous: 'go back a song',
  restart: 'start the song again',
  pause: 'pause',
  resume: 'carry on playing',
  upNext: 'play a song from Up next',
}

/** The most tag or name changes a recap names. */
const RECAP_CHANGES = 10
/** As long as a recap may be: what the server takes for one turn's answer. */
const RECAP_MAX = 2000

/**
 * What an answer showed, in words, for the follow-ups after it (F1): the
 * model hears what it said before, so it answers what is asked now rather
 * than everything again. Words answers are their words; lists and reviews
 * are a line saying what they offered. The songs themselves go as the turn's
 * objects (`objectsOf`), by id, so the recap does not name them.
 */
export function answerRecap(answer: AskAnswer): string {
  const picked = (result: DescribeResult): string =>
    `${plural(result.picks.length, 'song', 'songs')} (“${result.understanding.name}”)`
  const recap = ((): string => {
    switch (answer.kind) {
      case 'songs':
        return `Offered ${picked(answer.describe)} ${LEAD_WORDS[answer.lead]}`
      case 'together':
        return answer.describe
          ? `Offered a listening room with ${picked(answer.describe)}`
          : 'Offered to open a listening room.'
      case 'find':
        return `Found ${plural(answer.picks.length, 'song', 'songs')} that could be it`
      case 'explore':
        return answer.say
      case 'tags':
        return `Proposed ${plural(answer.review.changes.length, 'tag change', 'tag changes')}: ${answer.review.changes
          .slice(0, RECAP_CHANGES)
          .map(change => `${change.op} ${change.tag}${change.to ? ` → ${change.to}` : ''}`)
          .join('; ')}`
      case 'tidy':
        return [
          answer.tidy.reply,
          `Proposed ${plural(answer.tidy.changes.length, 'name change', 'name changes')}: ${answer.tidy.changes
            .slice(0, RECAP_CHANGES)
            .map(change => `${change.from} → ${change.to}`)
            .join('; ')}`,
        ]
          .filter(Boolean)
          .join('\n')
      case 'copies':
        return `Found ${plural(answer.copies.copies.length, 'song', 'songs')} they have more than once.`
      case 'remember':
        return `Offered to remember: ${answer.note}`
      case 'getMusic':
        return `Found on 网易云: ${answer.items
          .map(item => `${item.title} — ${item.artist} (${item.have} of ${item.tracks} theirs)`)
          .join('; ')}`
      case 'playlists':
        return answer.op === 'delete'
          ? `Proposed deleting the playlists ${answer.names.join(', ')}`
          : `Proposed renaming ${answer.names.join(', ')} to ${answer.newName ?? ''}`
      case 'playlistSongs':
        return answer.op === 'sort'
          ? `Proposed putting ${answer.playlist} in order by ${answer.sortBy ?? 'name'}`
          : `Proposed ${answer.op === 'add' ? 'adding' : 'taking out'} ${plural(answer.songs.length, 'song', 'songs')} ${answer.op === 'add' ? 'to' : 'from'} ${answer.playlist}`
      case 'library': {
        const listed =
          answer.show === 'artists'
            ? answer.artists
            : answer.show === 'albums'
              ? answer.albums
              : answer.show === 'tags'
                ? answer.tags
                : null
        const about = answer.judged && answer.judged.songs < answer.judged.of ? 'About ' : ''
        const counted = `${about}${plural(answer.count, 'song', 'songs')}`
        if (!listed) return counted
        const distinct =
          answer.show === 'albums'
            ? answer.distinct.albums
            : answer.show === 'tags'
              ? answer.distinct.tags
              : answer.distinct.artists
        return `${counted} in ${distinct} ${answer.show}: ${listed
          .slice(0, RECAP_CHANGES)
          .map(each => `${each.label} (${each.count})`)
          .join('; ')}`
      }
      case 'stats':
        return `${plural(answer.plays, 'play', 'plays')}, ${Math.round(answer.minutes)} min in ${rangeWords(answer.range)}: ${answer.items
          .map(item => `${item.label} (${item.plays})`)
          .join('; ')}`
      case 'open':
        return answer.say
      case 'playback':
        // What it came to is the device's to say (`PlaybackAnswer`); until then, only what was asked.
        return `Asked to ${PLAYBACK_ASKED[answer.op]}.`
      case 'none':
        return answer.say
    }
  })()
  return recap.length > RECAP_MAX ? `${recap.slice(0, RECAP_MAX - 1)}…` : recap
}

/** What a song answer was offered for, after its name in a recap. */
const LEAD_WORDS: Readonly<Record<'play' | 'save' | 'next', string>> = {
  play: 'to play now',
  save: 'to keep as a playlist',
  next: 'to play after the song playing',
}

/** The longest an object's label is. */
const LABEL_MAX = 120

/**
 * What an answer showed, as objects a follow-up can name by handle (F1,
 * AGENT-DESIGN 2.1): its songs by the server's ids in the order shown, each
 * with the reason it was given, and for a list what it understood and what
 * it was for. The handle is `t{turn}.1`, `turn` its place on the page, 1 for
 * the first: an answer is one card today. `shown` is a list's songs as shown
 * now (moved on its page, changed since), `understanding` what it understands
 * now; an answer that showed no songs has none.
 */
export function objectsOf(
  answer: AskAnswer,
  turn: number,
  shown?: { songIds: readonly number[]; understanding: Understanding },
): AskObject[] {
  const object = (
    kind: AskObject['kind'],
    label: string,
    songs: readonly { songId: number; why?: string | null }[],
    more: Partial<Pick<AskObject, 'playlist' | 'lead' | 'like' | 'understanding'>> = {},
  ): AskObject[] => {
    const kept = songs.slice(0, ASK_OBJECT_SONGS)
    if (kept.length === 0) return []
    return [
      {
        handle: `t${turn}.1`,
        kind,
        label: label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label,
        songIds: kept.map(song => song.songId),
        why: kept.map(song => song.why ?? null),
        playlist: more.playlist ?? null,
        lead: more.lead ?? null,
        like: more.like ?? null,
        understanding: more.understanding ?? null,
      },
    ]
  }
  // A list as it is shown now, each song with the reason it was picked.
  const listed = (result: DescribeResult): { songId: number; why: string | null }[] => {
    if (!shown) return result.picks
    const why = new Map(result.picks.map(pick => [pick.songId, pick.why]))
    return shown.songIds.map(songId => ({ songId, why: why.get(songId) ?? null }))
  }
  const ids = (songIds: readonly number[]) => [...new Set(songIds)].map(songId => ({ songId }))
  switch (answer.kind) {
    case 'songs':
      return object('songs', answer.describe.understanding.name, listed(answer.describe), {
        lead: answer.lead,
        like: answer.like,
        understanding: shown?.understanding ?? answer.describe.understanding,
      })
    case 'together':
      return answer.describe
        ? object('together', answer.describe.understanding.name, listed(answer.describe), {
            understanding: shown?.understanding ?? answer.describe.understanding,
          })
        : []
    case 'find':
      return object('find', 'Songs that could be it', answer.picks)
    case 'library':
      return object('library', plural(answer.count, 'song', 'songs'), ids(answer.songIds), {
        understanding: answer.understanding,
      })
    case 'stats':
      return object(
        'stats',
        `Most played in ${rangeWords(answer.range)}`,
        ids(answer.items.flatMap(item => (item.songId === null ? [] : [item.songId]))),
      )
    case 'explore':
      return object('explore', answer.say.split('\n')[0] ?? '', ids(answer.songIds))
    case 'playlistSongs':
      return object(
        'playlistSongs',
        `${answer.op === 'add' ? 'To add to' : answer.op === 'remove' ? 'To take out of' : 'In order'} ${answer.playlist}`,
        answer.songs,
        { playlist: answer.playlist },
      )
    case 'tags':
      return object(
        'tagChanges',
        plural(answer.review.changes.length, 'tag change', 'tag changes'),
        ids(answer.review.changes.flatMap(change => change.songIds)),
      )
    case 'tidy':
      return object(
        'nameChanges',
        plural(answer.tidy.changes.length, 'name change', 'name changes'),
        ids(answer.tidy.changes.flatMap(change => change.songIds)),
      )
    case 'copies':
      return object(
        'copies',
        plural(answer.copies.copies.length, 'song you have twice', 'songs you have twice'),
        ids(answer.copies.copies.flatMap(copy => [copy.keep, ...copy.songIds])),
      )
    case 'remember':
    case 'getMusic':
    case 'playlists':
    case 'open':
    case 'playback':
    case 'none':
      return []
  }
}
