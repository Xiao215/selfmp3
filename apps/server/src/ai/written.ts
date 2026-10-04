import { z } from 'zod/v4'
import {
  WRAPPED_RANGE_LABELS,
  type Wrapped,
  type WrappedRange,
  type WrittenReport,
} from '@selfmp3/shared'
import { Remembered, type Llm } from './llm.js'

/**
 * A5 · your month, written (docs/features/ai.md): the Report's numbers told in
 * a few sentences.
 *
 * The model is shown the report as plain facts and nothing else, and every
 * number it writes is checked against them: a sentence with a number the
 * facts do not hold is dropped, not corrected. The numbers are the plays';
 * the model only chooses which ones to say and how.
 */

const VERSION = 2

const WrittenOut = z.object({
  sentences: z.array(z.string().max(280)).min(1).max(5),
})

const SYSTEM = `You write a few sentences about someone's own listening, from facts about it, for the top of their listening report. Reply with JSON only: sentences, three to five of them, warm and plain, second person ("you"), like a friend who noticed — not an advert, no exclamation marks, no emoji.

Use only the facts given. Every number you write must appear in the facts exactly (you may write hours where the facts give hours). Do not count, add or work out anything new. Name songs, artists and tags exactly as written, character for character. Write a date as "October 2", never as 2026-10-02. Say what stands out: who and what you played most, when you listen, a habit, something new you took to. Never say what the facts do not.`

const HOURS = ['12 am', ...Array.from({ length: 11 }, (_, i) => `${i + 1} am`), '12 pm']
for (let i = 1; i < 12; i++) HOURS.push(`${i} pm`)
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The report as the lines the model reads, with hours beside minutes so it need not divide. */
export function factsOf(wrapped: Wrapped): string {
  const { totals } = wrapped
  const lines = [
    `Period: ${WRAPPED_RANGE_LABELS[wrapped.range].toLowerCase()}`,
    `Plays: ${totals.plays}`,
    `Listening time: ${Math.round(totals.minutes)} minutes (${Math.round(totals.minutes / 60)} hours)`,
    `Different songs played: ${totals.songsPlayed}`,
    `Days with music: ${totals.activeDays}`,
    `Longest run of days in a row: ${wrapped.longestStreakDays}`,
  ]
  if (wrapped.topSongs.length) {
    lines.push('Most played songs:')
    for (const song of wrapped.topSongs)
      lines.push(`- ${song.title} by ${song.artist}: ${song.plays} plays`)
  }
  if (wrapped.topArtists.length) {
    lines.push('Most played artists:')
    for (const artist of wrapped.topArtists) lines.push(`- ${artist.key}: ${artist.plays} plays`)
  }
  if (wrapped.topTags.length) {
    lines.push('Most played tags:')
    for (const tag of wrapped.topTags) lines.push(`- ${tag.key}: ${tag.plays} plays`)
  }
  if (wrapped.peakHour) {
    lines.push(
      `Busiest hour of the day: ${HOURS[wrapped.peakHour.hour]} (${wrapped.peakHour.plays} plays)`,
    )
  }
  if (wrapped.peakWeekday) {
    lines.push(
      `Busiest day of the week: ${WEEKDAYS[wrapped.peakWeekday.weekday]} (${wrapped.peakWeekday.plays} plays)`,
    )
  }
  if (wrapped.busiestDate) {
    lines.push(`Busiest date: ${wrapped.busiestDate.date} (${wrapped.busiestDate.plays} plays)`)
  }
  if (wrapped.mostInOneDay) {
    const day = wrapped.mostInOneDay
    lines.push(
      `Most plays of one song in one day: ${day.title} by ${day.artist}, ${day.plays} times on ${day.date}`,
    )
  }
  if (wrapped.discovered.length) {
    lines.push('Added in this period and played often:')
    for (const song of wrapped.discovered.slice(0, 5))
      lines.push(`- ${song.title} by ${song.artist}: ${song.plays} plays`)
  }
  if (wrapped.personality.line) lines.push(`Listening style: ${wrapped.personality.line}`)
  return lines.join('\n')
}

/** The numbers a text holds: "1,342" is one, "14th" is 14, "09" is 9. */
function numbersIn(text: string): number[] {
  return [...text.replace(/(\d),(\d{3})/g, '$1$2').matchAll(/\d+(?:\.\d+)?/g)].map(match =>
    Number(match[0]),
  )
}

/** Runs of Chinese or Japanese in a text: names, which must be copied, not respelled. */
const namesIn = (text: string): string[] =>
  text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+/gu) ?? []

/**
 * The sentences that say only what the facts say: every number one of theirs,
 * every name in Chinese or Japanese written as they write it ("原神纯音乨" is
 * not 原神纯音乐, and nothing but this catches it).
 */
export function keepTrue(sentences: readonly string[], facts: string): string[] {
  const known = new Set(numbersIn(facts))
  return sentences
    .map(sentence => sentence.trim())
    .filter(
      sentence =>
        sentence &&
        numbersIn(sentence).every(number => known.has(number)) &&
        namesIn(sentence).every(name => facts.includes(name)),
    )
}

interface WrittenDeps {
  readonly llm: Llm
  readonly wrapped: (range: WrappedRange) => Wrapped
  readonly remembered?: Remembered
}

export async function written(
  deps: WrittenDeps,
  range: WrappedRange,
  again = false,
): Promise<WrittenReport> {
  const wrapped = deps.wrapped(range)
  if (wrapped.totals.plays === 0) return { range, sentences: [], dropped: 0 }
  const facts = factsOf(wrapped)
  const remembered = deps.remembered ?? new Remembered()
  const ask = async () =>
    (
      await deps.llm.generate({
        task: 'written',
        tier: 'smart',
        system: SYSTEM,
        prompt: facts,
        schema: WrittenOut,
      })
    ).value
  // Write it again asks afresh and keeps that answer for the next look.
  const key = Remembered.key('written', VERSION, facts)
  const out = again ? await remembered.put(key, ask) : await remembered.get(key, ask)
  const sentences = keepTrue(out.sentences, facts)
  return { range, sentences, dropped: out.sentences.length - sentences.length }
}
