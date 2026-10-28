import { z } from 'zod/v4'
import { plural, type AskCard, type AskReply, type DescribeResult } from '@selfmp3/shared'
import { sha256 } from '../../util/hash.js'
import type { Llm } from '../llm.js'

/**
 * The eval's judge (AGENT-DESIGN 4): a strong model reads a whole conversation,
 * each answer drawn as text, and says per turn whether it did what was meant.
 * It is for what code cannot count — is this calm, is this Cantonese, did the
 * words own up to what was not done — and is calibrated against a person's
 * verdicts on the same answers before its numbers are trusted.
 */

/** How one song reads to the judge: title · artist · album · tags. */
export type SongWords = (id: number) => string

export interface JudgedTurn {
  readonly pass: boolean
  readonly score: number
  readonly problems: readonly string[]
}

/** One turn as the judge sees it. */
export interface TurnToJudge {
  readonly asked: string
  /** The song playing when it was asked, in words. */
  readonly playing: string | null
  /** Whether a list from an earlier turn was on the screen ("these"). */
  readonly screen: string | null
  /** What a right answer is, with the library's facts it needs. */
  readonly meant: string | null
  /** The answer drawn as text, or why there was none. */
  readonly answer: string
}

/** The most songs of one card the judge reads; the rest are counted. */
const SONGS_SHOWN = 40

/** Which judge gave a verdict: a changed prompt is another judge. */
export const JUDGE_VERSION = () => sha256(SYSTEM).slice(0, 8)

const SYSTEM = [
  'You grade answers from Ask, the assistant in a personal music library app. A person types a request; the app replies with a few words of its own and one or more cards, in the order the request asked for them. A card is songs to play now, play next or keep as a playlist, tag or name changes to approve, songs to add to or take out of a playlist, a count or list from the library, listening stats, a playback control, words, or a question back when the request could mean different things. Nothing changes until the person approves it.',
  'You get a conversation: each turn with what was asked, the song playing if any, whether an earlier answer\'s songs were on the screen (what "these" and "the 3rd one" point at), what a right answer would be with the library facts it needs, and the answer drawn as text. Songs are drawn as title · artist · album · tags, with the reason the app gave.',
  'Grade every turn on three questions. One: did it do every part of what was asked in this turn, read with the turns before it — the right kind of action, the amount asked for, the songs or things named, the order. Two: does it match the library and the facts given — the right artist, language, mood or era, right numbers, nothing invented. Three: where it did less than asked or could not do something, does it say so plainly, and is what it says true.',
  'A turn passes when the person who asked would be satisfied: it did what was meant, at most with small flaws. It fails when it did something else, did only part without saying so, got the songs or facts materially wrong, or proposes a change that would harm the library. Saying the app cannot do something passes only when that is true and it points to where in the app it can be done, or to what comes closest; a refusal that does neither fails, and so does refusing what the app could do. A proposal to approve counts as doing it.',
  'Judge songs by their names, artists, albums and tags and by what you know of the music; a few borderline songs in a long list are a small flaw, not a failure. The library holds no data on instruments, voices or mood: choosing by what is known of the songs is how the app is meant to do that, so judge whether the songs fit, not whether it said how it chose. The facts given are true; prefer them to your memory.',
  'Score 1 to 5: 5 exactly right, 4 right with small flaws, 3 partly right, 2 mostly wrong, 1 wrong or harmful. pass is true for 4 and 5 only. problems are short, concrete sentences, none when there are none.',
].join('\n\n')

const VerdictSchema = z.object({
  turns: z.array(
    z.object({
      turn: z.number().int(),
      problems: z.array(z.string()),
      score: z.number().int().min(1).max(5),
      pass: z.boolean(),
    }),
  ),
})

/** The judge's verdict on each turn of one conversation, in order. */
export async function judgeConversation(
  llm: Llm,
  turns: readonly TurnToJudge[],
): Promise<JudgedTurn[]> {
  const prompt = turns
    .map((turn, at) =>
      [
        `## Turn ${at + 1}`,
        `Asked: ${turn.asked}`,
        turn.playing ? `Playing: ${turn.playing}` : null,
        turn.screen ? `On the screen: ${turn.screen}` : null,
        turn.meant ? `A right answer: ${turn.meant}` : null,
        `Answer:\n${turn.answer}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
  const { value } = await llm.generate({
    task: 'eval-judge',
    tier: 'smart',
    system: SYSTEM,
    prompt: `${prompt}\n\nGrade each of the ${turns.length} turns.`,
    schema: VerdictSchema,
  })
  return turns.map((_, at) => {
    const verdict = value.turns.find(each => each.turn === at + 1)
    if (!verdict) return { pass: false, score: 1, problems: ['The judge gave no verdict.'] }
    // The score decides: a pass with a 3 is the judge contradicting itself.
    return { pass: verdict.score >= 4, score: verdict.score, problems: verdict.problems }
  })
}

/** A reply as text, for the judge and for a person reading the results: its words, then each card. */
export function replyWords(reply: AskReply, song: SongWords): string {
  const cards = reply.cards.map((card, at) =>
    reply.cards.length > 1 ? `Card ${at + 1}. ${cardWords(card, song)}` : cardWords(card, song),
  )
  return [reply.say ? `Said: ${reply.say}` : null, ...cards].filter(Boolean).join('\n')
}

/** One card as text. */
export function cardWords(answer: AskCard, song: SongWords): string {
  const songs = (ids: readonly number[], why?: readonly (string | null)[]): string => {
    const lines = ids
      .slice(0, SONGS_SHOWN)
      .map((id, at) => `${at + 1}. ${song(id)}${why?.[at] ? ` — ${why[at]}` : ''}`)
    if (ids.length > SONGS_SHOWN) lines.push(`… and ${ids.length - SONGS_SHOWN} more`)
    return lines.join('\n')
  }
  const described = (result: DescribeResult): string =>
    [
      `“${result.understanding.name}”, ${plural(result.picks.length, 'song', 'songs')}, picked from ${plural(result.fit, 'song', 'songs')} that fit the filters`,
      understood(result.understanding),
      ...result.loosened.map(each => `Loosened: ${each}`),
      result.unknown.length ? `Not in the library: ${result.unknown.join(', ')}` : null,
      ...result.notes.map(each => `Note: ${each}`),
      songs(
        result.picks.map(pick => pick.songId),
        result.picks.map(pick => pick.why),
      ),
    ]
      .filter(Boolean)
      .join('\n')
  switch (answer.kind) {
    case 'songs':
      return `Songs to ${answer.lead === 'play' ? 'play now' : answer.lead === 'save' ? 'keep as a playlist' : 'play next'}${answer.like === null ? '' : `, sounding like ${song(answer.like)}`}:\n${described(answer.describe)}`
    case 'together':
      return answer.describe
        ? `A listening room with:\n${described(answer.describe)}`
        : 'Open a listening room.'
    case 'find':
      return `Songs that could be it:\n${songs(
        answer.picks.map(pick => pick.songId),
        answer.picks.map(pick => pick.why),
      )}`
    case 'tags':
      return [
        `Tag changes to approve (${answer.review.looked} songs looked at):`,
        ...answer.review.changes.map(
          change =>
            `- ${change.op} ${change.isNew ? 'new tag ' : ''}${change.tag}${change.to ? ` → ${change.to}` : ''} on ${plural(change.songIds.length, 'song', 'songs')} (${change.who}) — ${change.why}\n${songs(change.songIds)}`,
        ),
        ...answer.review.unsure.map(each => `Unsure: ${each.who} — ${each.why}`),
        answer.review.note ? `Note: ${answer.review.note}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    case 'tidy':
      return [
        answer.tidy.reply ? `Said: ${answer.tidy.reply}` : null,
        `Name changes to approve (${answer.tidy.looked} songs looked at):`,
        ...answer.tidy.changes.map(
          change =>
            `- ${change.field}: ${change.from || '(none)'} → ${change.to} on ${plural(change.songIds.length, 'song', 'songs')} — ${change.why}\n${songs(change.songIds)}`,
        ),
        answer.tidy.note ? `Note: ${answer.tidy.note}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    case 'copies':
      return [
        `Songs held more than once (${answer.copies.looked} looked at):`,
        ...answer.copies.copies.map(
          copy =>
            `- keep ${song(copy.keep)}; delete ${copy.songIds.map(song).join('; ')} — ${copy.why}`,
        ),
        answer.copies.note ? `Note: ${answer.copies.note}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    case 'stats':
      return `Listening stats, ${answer.range}, about ${answer.about}: ${answer.plays} plays, ${Math.round(answer.minutes)} min\n${answer.items
        .map((item, at) => `${at + 1}. ${item.label} (${item.plays} plays)`)
        .join('\n')}`
    case 'library': {
      const listed = (name: string, rows: readonly { label: string; count: number }[]) =>
        rows.length ? `${name}: ${rows.map(row => `${row.label} (${row.count})`).join('; ')}` : null
      return [
        `From the library: ${answer.judged && answer.judged.songs < answer.judged.of ? 'about ' : ''}${plural(answer.count, 'song', 'songs')}, ${Math.round(answer.seconds / 60)} min, showing ${answer.show}${
          // Answers from before Stage 1 had no distinct counts (`calibrate.ts` reads them).
          (answer.distinct as typeof answer.distinct | null)
            ? `; ${answer.distinct.artists} artists, ${answer.distinct.albums} albums, ${answer.distinct.tags} tags`
            : ''
        }`,
        understood(answer.understanding),
        answer.unknown.length ? `Not in the library: ${answer.unknown.join(', ')}` : null,
        answer.judged
          ? `Judged by meaning: ${answer.judged.songs} of ${answer.judged.of} read`
          : null,
        listed('Artists', answer.artists),
        listed('Albums', answer.albums),
        listed('Tags', answer.tags),
        answer.songIds.length
          ? `Songs${answer.sortBy ? ` by ${answer.sortBy} ${answer.order}` : ''}:\n${songs(answer.songIds)}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    }
    case 'explore':
      return [
        answer.say,
        answer.songIds.length ? songs(answer.songIds) : null,
        answer.get ? `Offers to get: ${answer.get}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    case 'getMusic':
      return `To import from 网易云 (searched “${answer.words}”):\n${answer.items
        .map(
          item =>
            `- ${item.kind} ${item.title} — ${item.artist}: ${item.have} of ${item.tracks} already in the library`,
        )
        .join('\n')}`
    case 'playlists':
      return `Proposes to ${answer.op} the playlists ${answer.names.join(', ')}${answer.newName ? ` → ${answer.newName}` : ''}${answer.unknown.length ? `; no playlist called ${answer.unknown.join(', ')}` : ''}`
    case 'playlistSongs':
      return [
        `Proposes to ${answer.op === 'add' ? 'add to' : answer.op === 'remove' ? 'take out of' : 'put in order'} the playlist ${answer.playlist}${answer.sortBy ? ` by ${answer.sortBy} ${answer.order}` : ''} (chosen by ${answer.by}):`,
        answer.unknown.length ? `Not in the library: ${answer.unknown.join(', ')}` : null,
        songs(
          answer.songs.map(each => each.songId),
          answer.songs.map(each => each.why),
        ),
      ]
        .filter(Boolean)
        .join('\n')
    case 'remember':
      return `Offers to remember for every Ask after: ${answer.note}`
    case 'open':
      return `Points to the ${answer.place} page: ${answer.say}`
    case 'playback':
      return `Playback: ${answer.op}${answer.place === null ? '' : ` (Up next place ${answer.place})`}`
    case 'clarify':
      return `Asks back: ${answer.question}${answer.options.length ? `\nOffers: ${answer.options.join(' | ')}` : ''}`
  }
}

/** What a list understood, in the words of its parts that are set. */
function understood(understanding: DescribeResult['understanding']): string | null {
  const parts = Object.entries(understanding).flatMap(([key, value]) => {
    if (key === 'name' || value === null || value === undefined) return []
    if (Array.isArray(value)) return value.length ? [`${key} ${value.join(', ')}`] : []
    if (typeof value === 'object') {
      const { min, max } = value
      return min === null && max === null
        ? []
        : [`${key} ${String(min ?? '…')}–${String(max ?? '…')}`]
    }
    return [`${key} ${String(value)}`]
  })
  return parts.length ? `Understood as: ${parts.join('; ')}` : null
}
