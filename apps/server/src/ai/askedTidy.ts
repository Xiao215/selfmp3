import { z } from 'zod/v4'
import {
  CJK,
  plural,
  SongFieldsSchema,
  TidyNameSchema,
  type Song,
  type TidyName,
  type TidyResult,
} from '@selfmp3/shared'
import { pool } from '../util/pool.js'
import { LlmError, llmFailureWords, Remembered, type Llm } from './llm.js'
import { nameField, within, type FoundName } from './names.js'
import { NO_STEPS, type Steps } from './progress.js'
import { chunks } from './text.js'
import { grouped, TIDY_VERSION, type TidyAsked, type TidyDeps } from './tidy.js'

/**
 * Tidy up, asked for something in particular (docs/features/ai.md, A4; tidy.ts
 * for the checkup): "give the 原神音乐 songs their official Chinese names,
 * albums too" does that, and only that. The songs the request is about go to
 * the model in batches, titles and all, and each edit it returns is checked
 * against the song it names. When the request wants names from outside the
 * library ("official Chinese names"), each song is looked up in the
 * catalogues first (`names.ts`); the model only shapes a name it was shown,
 * and an edit whose words are in no catalogue's name is dropped, so nothing
 * is made up.
 *
 * Before the lookups, the model reads the chosen songs' names alone and keeps
 * the ones the change is still to be made on ("the ones in English now"):
 * which songs need it is whatever the request says, not a filter of ours. A
 * number they give ("up to 300") is taken from those.
 */

/** Songs per model call: a line is about 40 tokens in and an edit about 30 out. */
const SONGS_PER_CALL = 60
/** Calls at once, so a big request does not run into the provider's rate limit. */
export const CALLS_AT_ONCE = 4
/** The most songs one request changes: as many as one edit can save. */
const MAX_ASKED = 2000

const EditsOut = z.object({
  edits: z
    .array(
      z.object({
        n: z.number().int(),
        field: z.enum(TidyNameSchema.options),
        to: z.string().max(400),
        why: z.string().max(120),
      }),
    )
    .max(SONGS_PER_CALL * 4),
  say: z.string().max(300),
})

const ASKED_SYSTEM = `You change the names in someone's own music library the way they ask. You are given their request and a numbered table of the songs it is about (n | title | artist | album | album artist). Reply with JSON only: edits, each a song's number (n), the field to change (title, artist, album or albumArtist), what it becomes (to), and why; and say.

- Only what the request asks for, on the fields it asks about. Leave a song out when it is right already, or when you do not know the answer for certain: never guess or make up a name. When they ask for official names, give a name the artist or publisher uses, not one you translated yourself.
- Every song on one album gets the same album name.
- why: at most six plain words, the same words for every edit made for the same reason ("Official Chinese name").
- Never use a number that is not in the table, and never an edit that keeps the name the same.
- say: what you tell them, in one or two plain sentences, in the language they wrote their request in (not the language of the songs' names). When you change nothing, or leave out a song they seem to mean, say which song you took them to mean and why it stays as it is. Empty when the edits say it all, or when no song in the table is one they mean.`

/** Added when the songs were looked up: what was found is the only place a name may come from. */
const FOUND_RULES = `

Each song may be followed by "found": what music catalogues (网易云, MusicBrainz, iTunes) list for this same recording, matched by its artist and length. Every name you give comes from a found name, in its own words, shaped the way they ask:
- A found name in two languages ("丹砂巍巍 Wordless Cliffs") keeps only the part in the language they want ("丹砂巍巍" for Chinese).
- Leave off a game's or series' prefix ("原神-千岩旷望 Millelith's Watch" is 千岩旷望 for an album) unless they ask for it.
- A song with nothing found, or nothing found that fits, is left out. Never write a name that is not in what was found.`

/** Added for songs no catalogue has, when the model may search the web. */
const WEB_RULES = `

None of these songs is in the music catalogues. Search the web for each one's name the way they ask: the artist's or publisher's own pages, stores, wikis. Give a name only when a page you read gives it for this same song, and leave the rest out.`

/** Songs per web call: each may mean a few searches. */
const WEB_PER_CALL = 15
/** The most songs looked for on the web in one request. */
const MAX_WEB = 150

/** Songs per sorting call: a line is about 20 tokens in and a number 3 out. */
const SORT_PER_CALL = 200

const SortOut = z.object({ n: z.array(z.number().int()).max(SORT_PER_CALL) })

const SORT_SYSTEM = `You sort someone's songs before a change they asked for is made to their names. You are given their request and a numbered table of songs (n | title | artist | album | album artist). Reply with JSON only: n, the numbers of the songs the change is still to be made on.

- Leave out a song the request leaves out (it asks only for the titles in English, and this title is Chinese already), and one whose names already are the way they want them.
- Keep a song whenever you can't tell from the table: it is checked properly after this.
- Never use a number that is not in the table.`

/** Lookups at once: 网易云 answers quickly, and MusicBrainz waits its turn on its own. */
const LOOKUPS_AT_ONCE = 3

/** A found name as the model is shown it. */
const foundLine = (found: readonly FoundName[]): string =>
  found
    .slice(0, 3)
    .map(each => `${each.source} “${each.title}” by ${each.artist} on “${each.album || '-'}”`)
    .join('; ')

/** The songs a call is about, as the model reads them: `n | title | artist | album | album artist`. */
function nameTable(batch: readonly Song[], extra?: (song: Song) => string): string {
  return batch
    .map(
      (song, index) =>
        `${index + 1} | ${song.title} | ${song.artist || '-'} | ${song.album || '-'} | ${song.albumArtist || '-'}${extra ? extra(song) : ''}`,
    )
    .join('\n')
}

/**
 * The model's edits for one batch, kept to what can be applied: a song in the
 * batch, each field once, a value the field accepts — and whatever `accept`
 * asks on top. Each one that passes is handed on with the song it is for.
 */
function eachChecked(
  answer: z.infer<typeof EditsOut>,
  batch: readonly Song[],
  accept: (song: Song, edit: { field: TidyName; to: string; why: string }) => boolean,
): void {
  const seen = new Set<string>()
  for (const edit of answer.edits) {
    const song = batch[edit.n - 1]
    const to = edit.to.trim().replace(/\s+/g, ' ')
    const at = `${edit.n}:${edit.field}`
    if (!song || seen.has(at)) continue
    if (!SongFieldsSchema.shape[edit.field].safeParse(to).success) continue
    if (accept(song, { field: edit.field, to, why: edit.why })) seen.add(at)
  }
}

/**
 * The songs the request still wants changed, in the order given, from a fast
 * read of their names. A batch the model can't answer keeps all its songs:
 * the careful step after this one judges them.
 */
async function needingIt(
  llm: Llm,
  remembered: Remembered,
  text: string,
  songs: readonly Song[],
  steps: Steps,
): Promise<Song[]> {
  const all = songs.length.toLocaleString('en')
  steps.begin(`Finding which of ${all} songs need it`)
  const keep = new Set<number>()
  await pool(chunks(songs, SORT_PER_CALL), CALLS_AT_ONCE, async batch => {
    const prompt = `The request:\n${text}\n\nThe songs (n | title | artist | album | album artist):\n${nameTable(batch)}`
    try {
      const answer = await remembered.get(
        Remembered.key('tidy-sort', TIDY_VERSION, prompt),
        async () =>
          (
            await llm.generate({
              task: 'tidy-sort',
              tier: 'fast',
              system: SORT_SYSTEM,
              prompt,
              schema: SortOut,
            })
          ).value,
      )
      for (const n of answer.n) {
        const song = batch[n - 1]
        if (song) keep.add(song.id)
      }
    } catch (caught) {
      if (!(caught instanceof LlmError)) throw caught
      for (const song of batch) keep.add(song.id)
    }
  })
  const needing = songs.filter(song => keep.has(song.id))
  steps.done(`${needing.length.toLocaleString('en')} of ${all} need it`)
  return needing
}

/** One change asked for across the songs it is about, a batch at a time. */
export async function askedTidy(
  deps: TidyDeps,
  asked: TidyAsked,
  steps: Steps = NO_STEPS,
): Promise<TidyResult> {
  const remembered = deps.remembered ?? new Remembered()
  const { llm } = deps
  const notes: string[] = []
  if (asked.unknown.length > 0) notes.push(`Your library has no ${asked.unknown.join(' or ')}.`)
  // An album's songs side by side, so one batch names the whole album.
  const chosen = [...asked.songs].sort(
    (a, b) =>
      (a.albumArtist || a.artist).localeCompare(b.albumArtist || b.artist) ||
      a.album.localeCompare(b.album) ||
      (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
      a.id - b.id,
  )
  const lookingUp = asked.lookUp && deps.findNames !== undefined
  if (asked.lookUp && !deps.findNames) notes.push('Names can’t be looked up from here.')
  const cap = Math.min(asked.limit ?? MAX_ASKED, MAX_ASKED)

  // 0 · The songs the change is still to be made on, from their names alone: before
  // the slow lookups, and before a number they gave is counted out.
  const sorting = (lookingUp && chosen.length > SONGS_PER_CALL) || chosen.length > cap
  const needing = sorting ? await needingIt(llm, remembered, asked.text, chosen, steps) : chosen
  const songs = needing.slice(0, cap)
  if (needing.length > songs.length) {
    const of = needing.length.toLocaleString('en')
    notes.push(
      sorting
        ? `Changing the first ${songs.length.toLocaleString('en')} of the ${of} songs that need it; ask again for the rest.`
        : `Looked at the first ${songs.length.toLocaleString('en')} of ${of} songs; ask again for the rest.`,
    )
  }
  if (songs.length === 0) {
    steps.done('0 changes')
    return {
      changes: [],
      looked: chosen.length,
      note: notes.join(' ') || null,
      asked: asked.text,
      reply: null,
      gaps: null,
    }
  }

  // 1 · The catalogues, when the names must come from outside: a song none of them has is left be.
  const found = new Map<number, FoundName[]>()
  if (lookingUp) {
    const findNames = deps.findNames
    const all = songs.length.toLocaleString('en')
    let looked = 0
    const lookingFor = `Looking up ${all} ${songs.length === 1 ? 'song' : 'songs'} on 网易云 and MusicBrainz`
    steps.begin(lookingFor)
    await pool(songs, LOOKUPS_AT_ONCE, async song => {
      const names = await findNames(song)
      if (names.length > 0) found.set(song.id, names)
      looked++
      if (looked % 25 === 0 && looked < songs.length) {
        steps.update(`${lookingFor} · ${looked.toLocaleString('en')} done`)
      }
    })
    const notFound = songs.length - found.size
    steps.done(`Found ${found.size.toLocaleString('en')} of ${all}`)
    if (notFound > 0) {
      notes.push(
        deps.web?.()
          ? `${plural(notFound, 'song wasn’t', 'songs weren’t')} found on 网易云, MusicBrainz or iTunes, so the web was searched instead: what it found waits for a yes.`
          : `${plural(notFound, 'song wasn’t', 'songs weren’t')} found on 网易云, MusicBrainz or iTunes, so ${notFound === 1 ? 'it is' : 'they are'} left as ${notFound === 1 ? 'it is' : 'they are'}.`,
      )
    }
  }
  const asking = lookingUp ? songs.filter(song => found.has(song.id)) : songs

  // 2 · The model, a batch at a time.
  const batches = chunks(asking, SONGS_PER_CALL)
  const { propose, changes } = grouped()
  // What the model told them, batch by batch: from a batch that changed
  // something when one did, since one that found nothing to change speaks
  // only of its own songs ("none of these is that artist").
  const said: string[] = []
  const saidChanging: string[] = []
  const saidOnWeb: string[] = []
  /** How many batches changed something. */
  let changing = 0
  let done = 0
  const failures: LlmError[] = []
  let missed = 0
  const total = asking.length.toLocaleString('en')
  const reading = `Reading ${total} ${asking.length === 1 ? 'song' : 'songs'}`
  if (asking.length > 0) steps.begin(reading)

  const run = async (batch: Song[]): Promise<void> => {
    const table = nameTable(
      batch,
      lookingUp ? song => ` | found: ${foundLine(found.get(song.id) ?? [])}` : undefined,
    )
    const prompt = `The request:\n${asked.text}\n\nThe songs (n | title | artist | album | album artist${lookingUp ? ' | found' : ''}):\n${table}`
    let answer: z.infer<typeof EditsOut>
    try {
      answer = await remembered.get(
        Remembered.key('tidy-asked', TIDY_VERSION, prompt),
        async () =>
          (
            await llm.generate({
              task: 'tidy-asked',
              tier: 'smart',
              system: lookingUp ? ASKED_SYSTEM + FOUND_RULES : ASKED_SYSTEM,
              prompt,
              schema: EditsOut,
            })
          ).value,
      )
    } catch (caught) {
      if (!(caught instanceof LlmError)) throw caught
      failures.push(caught)
      missed += batch.length
      return
    }
    // The check: a song in this batch, a field once each, a name a song may have.
    let changed = false
    eachChecked(answer, batch, (song, edit) => {
      if (lookingUp) {
        // Only words a catalogue has for this recording: the one it came from says why, and it starts ticked.
        const source = (found.get(song.id) ?? []).find(each =>
          within(edit.to, nameField(edit.field, each)),
        )
        if (!source) return false
        const why = `The name on ${source.source}`
        propose(song, edit.field, song[edit.field], { value: edit.to, whys: [why] }, 'rule')
        changed = true
        return true
      }
      const why = edit.why.trim() || 'As you asked'
      propose(song, edit.field, song[edit.field], { value: edit.to, whys: [why] }, 'model')
      changed = true
      return true
    })
    if (changed) changing++
    const say = answer.say.trim()
    if (say) (changed ? saidChanging : said).push(say)
    done += batch.length
    steps.update(
      done < asking.length
        ? `${reading} · ${done.toLocaleString('en')} done`
        : `Read ${total} songs`,
    )
  }

  await pool(batches, CALLS_AT_ONCE, run)
  const [failure] = failures
  if (failure && missed === asking.length) throw failure
  if (failure) {
    notes.push(
      `${llmFailureWords[failure.kind]} Left out ${plural(missed, 'song', 'songs')}; ask again for them.`,
    )
  }

  // 3 · The web, for songs no catalogue has: the model's finds, unticked.
  const unfound =
    lookingUp && deps.web?.() ? songs.filter(song => !found.has(song.id)).slice(0, MAX_WEB) : []
  if (unfound.length > 0) {
    let webMissed = 0
    steps.begin(`Searching the web for ${plural(unfound.length, 'song', 'songs')}`)
    await pool(chunks(unfound, WEB_PER_CALL), 2, async batch => {
      const prompt = `The request:\n${asked.text}\n\nThe songs (n | title | artist | album | album artist):\n${nameTable(batch)}`
      let answer: z.infer<typeof EditsOut>
      try {
        answer = await remembered.get(
          Remembered.key('tidy-web', TIDY_VERSION, prompt),
          async () =>
            (
              await llm.generate({
                task: 'tidy-web',
                tier: 'smart',
                system: ASKED_SYSTEM + WEB_RULES,
                prompt,
                schema: EditsOut,
                webSearch: true,
              })
            ).value,
        )
      } catch (caught) {
        if (!(caught instanceof LlmError)) throw caught
        webMissed += batch.length
        return
      }
      if (answer.say.trim()) saidOnWeb.push(answer.say.trim())
      eachChecked(answer, batch, (song, edit) => {
        propose(
          song,
          edit.field,
          song[edit.field],
          { value: edit.to, whys: ['Found on the web'] },
          'model',
        )
        return true
      })
    })
    if (webMissed > 0) notes.push(`The web search left out ${plural(webMissed, 'song', 'songs')}.`)
  }

  const proposed = changes()
  steps.done(`${proposed.length} ${proposed.length === 1 ? 'change' : 'changes'}`)
  return {
    changes: proposed,
    // Every song chosen was checked, unless a number they gave left some for later.
    looked: needing.length > songs.length ? songs.length : chosen.length,
    note: notes.length > 0 ? notes.join(' ') : null,
    asked: asked.text,
    // One thing said, and only what agrees with the card: a batch speaks of
    // its own songs, so its words stand for the answer when it made every
    // change, or when nothing changed; with several batches changing, the
    // card says what changed. The web pass speaks for what it changed alone.
    reply: inTheirLanguage(
      asked.text,
      changing === 1
        ? (saidChanging[0] ?? null)
        : changing > 0
          ? null
          : proposed.length > 0
            ? (saidOnWeb[0] ?? null)
            : (said[0] ?? saidOnWeb[0] ?? null),
    ),
    gaps: null,
  }
}

/**
 * What the model said, when it is written the way the request is: mostly in
 * Chinese or Japanese letters, or mostly not. Shown a table of Chinese names,
 * it has answered an English request in Chinese; such a reply is dropped, and
 * the changes speak for themselves.
 */
export function inTheirLanguage(request: string, said: string | null): string | null {
  if (!said) return null
  const cjkly = (text: string): boolean => {
    const cjk = [...text].filter(letter => CJK.test(letter)).length
    const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length
    // A Chinese or Japanese letter says about as much as a word of Latin ones.
    return cjk * 3 > latin
  }
  return cjkly(request) === cjkly(said) ? said : null
}
