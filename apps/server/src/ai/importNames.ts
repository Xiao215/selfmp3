import { z } from 'zod/v4'
import {
  formatDuration,
  splitArtists,
  type ImportNames,
  type ImportNamesRequest,
} from '@selfmp3/shared'
import { withNotes } from './ask.js'
import { LlmError, Remembered, type Llm } from './llm.js'
import { within } from './names.js'
import { chunks, pool } from './text.js'

/**
 * A9 · the model's part (docs/features/ai.md): an import review's rows read
 * for names that look wrong, each answered with the names it should have, for
 * the review to offer row by row.
 *
 * The rules part runs where a row is made (`toProbedTrack`, the 网易云
 * listing): each name once in a credit, the original title without the
 * English after it. What rules cannot see — a title and an artist the wrong
 * way round, a channel's name standing in for the artist, words about the
 * upload left in a title — the model reads, and says only for the rows it
 * thinks wrong.
 *
 * Grounded as Fix song info's card is: every name it answers with must be
 * found in that row's own words or the list's name, or the field stays as it
 * was. So a suggestion moves and trims words, and never makes a name up.
 */

const VERSION = 1

const ROWS_PER_CALL = 60
const CALLS_AT_ONCE = 3

export interface ImportNamesDeps {
  readonly llm: Llm
  readonly remembered?: Remembered
  readonly notes?: () => readonly string[]
}

const RowsOut = z.object({
  rows: z
    .array(
      z.object({
        n: z.number().int(),
        title: z.string().max(300),
        artist: z.string().max(300),
        album: z.string().max(300),
        why: z.string().max(80),
      }),
    )
    .max(ROWS_PER_CALL),
})

const SYSTEM = `You read the names of songs someone is about to import into their own music library. You are given the name of the list they come from, if it has one, and a numbered table of its songs (n | title | artist | album | length), named the way the place they come from wrote them. Reply with JSON only: rows, one for each song whose names look wrong for a song in a music library, with its number (n), the title, artist and album it should have, and why in at most six plain words. Leave out every song whose names look right.

- Use only words already in that song's row or in the list's name: put each in the field it belongs to, and leave out whatever is not part of the song's name. Never translate, respell or add a name yourself.
- Keep a field as it is when it is right; an album may stay empty.
- Never use a number that is not in the table.`

/** A row as the request gives it, its optional names filled in. */
interface Row {
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly duration: number
}

export async function importNames(
  deps: ImportNamesDeps,
  request: ImportNamesRequest,
): Promise<ImportNames> {
  const remembered = deps.remembered ?? new Remembered()
  const list = request.list?.trim() || null
  const rows: Row[] = request.rows.map(row => ({
    title: row.title,
    artist: row.artist ?? '',
    album: row.album ?? '',
    duration: row.duration ?? 0,
  }))
  const batches = chunks(
    rows.map((row, index) => ({ row, index })),
    ROWS_PER_CALL,
  )
  const suggestions: ImportNames['suggestions'] = []
  const failures: LlmError[] = []
  await pool(batches, CALLS_AT_ONCE, async batch => {
    const prompt = withNotes(
      [
        `The list: ${list ?? '(no name)'}`,
        '',
        'The songs (n | title | artist | album | length):',
        ...batch.map(
          ({ row }, at) =>
            `${at + 1} | ${row.title || '-'} | ${row.artist || '-'} | ${row.album || '-'} | ${row.duration > 0 ? formatDuration(row.duration) : '-'}`,
        ),
      ].join('\n'),
      deps.notes?.() ?? [],
    )
    try {
      const reply = await remembered.get(
        Remembered.key('import-names', VERSION, prompt),
        async () =>
          (
            await deps.llm.generate({
              task: 'import-names',
              tier: 'fast',
              system: SYSTEM,
              prompt,
              schema: RowsOut,
            })
          ).value,
      )
      const seen = new Set<number>()
      for (const said of reply.rows) {
        const at = batch[said.n - 1]
        if (!at || seen.has(said.n)) continue
        seen.add(said.n)
        const suggestion = grounded(at.row, list, said)
        if (suggestion) suggestions.push({ row: at.index, ...suggestion })
      }
    } catch (caught) {
      if (!(caught instanceof LlmError)) throw caught
      failures.push(caught)
    }
  })
  // Some rows answered is an answer; none, and the model's failure is.
  const [failure] = failures
  if (failure && failures.length === batches.length) throw failure
  return { suggestions: suggestions.sort((a, b) => a.row - b.row) }
}

/**
 * The model's names for a row, each kept only when every part of it is in the
 * row's words or the list's name; null when that leaves nothing changed.
 */
export function grounded(
  row: Row,
  list: string | null,
  said: { title: string; artist: string; album: string; why: string },
): Omit<ImportNames['suggestions'][number], 'row'> | null {
  const sources = [row.title, row.artist, row.album, list ?? ''].filter(Boolean)
  const found = (value: string, credit: boolean): boolean =>
    (credit ? splitArtists(value, 'list') : [value]).every(part =>
      sources.some(source => within(part, source)),
    )
  const take = (field: 'title' | 'artist' | 'album'): string => {
    const value = said[field].trim().replace(/\s+/g, ' ')
    if (value === row[field].trim()) return row[field]
    // Only an album may be emptied, when it was never an album's name at all.
    if (value === '') return field === 'album' ? '' : row[field]
    return found(value, field === 'artist') ? value : row[field]
  }
  const names = { title: take('title'), artist: take('artist'), album: take('album') }
  if (names.title === row.title && names.artist === row.artist && names.album === row.album) {
    return null
  }
  return { ...names, why: said.why.trim() || 'The names look mixed up' }
}
