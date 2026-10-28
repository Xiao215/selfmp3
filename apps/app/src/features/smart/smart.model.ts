import {
  ASK_OBJECT_SONGS,
  EVERY_SONG,
  plural,
  formatLongDuration,
  tidyValue,
} from '@selfmp3/shared'
import type {
  AskCard,
  AskObject,
  AskReply,
  AskOrder,
  AskPlaybackOp,
  AskSort,
  BulkEditSongs,
  Playlist,
  SmartRules,
  Song,
  TagChange,
  TidyChange,
  TidyCopy,
  AskStatsRange,
  DescribeResult,
  Tag,
  Understanding,
} from '@selfmp3/shared'

/**
 * The smart features as the app draws them (docs/features/ai.md): what a
 * description was understood as, part by part, and the server's answers
 * turned into this device's songs and tags.
 */

/** One part of an understanding, drawn as a chip that can be taken away. */
interface Part {
  readonly key: string
  readonly label: string
  /** A tag's hue, for a tag's dot. */
  readonly hue?: number
  readonly without: (understanding: Understanding) => Understanding
}

/** At most `n` characters, ending on a whole word with an ellipsis when cut. */
function clip(text: string, n: number): string {
  if (text.length <= n) return text
  const cut = text.slice(0, n)
  const space = cut.lastIndexOf(' ')
  return `${(space > n / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const days = (n: number): string => (n === 1 ? 'today' : n === 7 ? 'this week' : `in ${n} days`)

function rangeLabel(
  what: 'energy' | 'bpm',
  range: { min: number | null; max: number | null },
): string | null {
  const { min, max } = range
  if (min === null && max === null) return null
  const show = (n: number): string => (what === 'energy' ? n.toFixed(2) : `${Math.round(n)} bpm`)
  if (what === 'energy') {
    if (min === null) return `Calm · energy under ${show(max!)}`
    if (max === null) return `Lively · energy over ${show(min)}`
    return `Energy ${show(min)}–${show(max)}`
  }
  if (min === null) return `Under ${show(max!)}`
  if (max === null) return `Over ${show(min)}`
  return `${Math.round(min)}–${show(max)}`
}

/** "2000s", "Since 2015", "Before 2010", "2003", "2012–2016": a year range the way it was likely said. */
export function yearLabel(range: { min: number | null; max: number | null }): string | null {
  const { min, max } = range
  if (min === null && max === null) return null
  if (min === null) return max! % 10 === 9 ? `Before ${max! + 1}` : `Up to ${max}`
  if (max === null) return `Since ${min}`
  if (min === max) return String(min)
  if (min % 10 === 0 && max === min + 9) return `${min}s`
  return `${min}–${max}`
}

export function parts(understanding: Understanding, tags: readonly Tag[]): Part[] {
  const hueOf = (name: string): number | undefined =>
    tags.find(tag => tag.name.toLowerCase() === name.toLowerCase())?.hue
  const out: Part[] = []

  for (const name of understanding.anyTags) {
    out.push({
      key: `tag:${name}`,
      label: name,
      hue: hueOf(name),
      without: u => ({ ...u, anyTags: u.anyTags.filter(other => other !== name) }),
    })
  }
  for (const name of understanding.artists) {
    out.push({
      key: `artist:${name}`,
      label: name,
      without: u => ({ ...u, artists: u.artists.filter(other => other !== name) }),
    })
  }
  for (const name of understanding.albums) {
    out.push({
      key: `album:${name}`,
      label: name,
      without: u => ({ ...u, albums: u.albums.filter(other => other !== name) }),
    })
  }
  for (const name of understanding.noTags) {
    out.push({
      key: `not:${name}`,
      label: `Not ${name}`,
      without: u => ({ ...u, noTags: u.noTags.filter(other => other !== name) }),
    })
  }
  const energy = rangeLabel('energy', understanding.energy)
  if (energy)
    out.push({
      key: 'energy',
      label: energy,
      without: u => ({ ...u, energy: { min: null, max: null } }),
    })
  const bpm = rangeLabel('bpm', understanding.bpm)
  if (bpm)
    out.push({ key: 'bpm', label: bpm, without: u => ({ ...u, bpm: { min: null, max: null } }) })
  const year = yearLabel(understanding.year)
  if (year)
    out.push({ key: 'year', label: year, without: u => ({ ...u, year: { min: null, max: null } }) })
  if (understanding.sound !== null) {
    // The listening model's words, in English: only songs that sound like it, best first.
    out.push({
      key: 'sound',
      label: `Sounds like ${clip(understanding.sound, 40)}`,
      without: u => ({ ...u, sound: null }),
    })
  }
  if (understanding.words !== null) {
    out.push({
      key: 'words',
      label: understanding.words === 'with' ? 'With words' : 'No words',
      without: u => ({ ...u, words: null }),
    })
  }
  if (understanding.loved !== null) {
    out.push({
      key: 'loved',
      label: understanding.loved ? 'Liked' : 'Not liked',
      without: u => ({ ...u, loved: null }),
    })
  }
  if (understanding.playedWithinDays !== null) {
    out.push({
      key: 'played',
      label: `Played ${days(understanding.playedWithinDays)}`,
      without: u => ({ ...u, playedWithinDays: null }),
    })
  }
  if (understanding.notPlayedWithinDays !== null) {
    out.push({
      key: 'notPlayed',
      label: `Not played ${days(understanding.notPlayedWithinDays)}`,
      without: u => ({ ...u, notPlayedWithinDays: null }),
    })
  }
  if (understanding.addedWithinDays !== null) {
    out.push({
      key: 'added',
      label: `Added ${days(understanding.addedWithinDays)}`,
      without: u => ({ ...u, addedWithinDays: null }),
    })
  }
  if (understanding.minutes !== null) {
    out.push({
      key: 'minutes',
      label: `About ${formatLongDuration(understanding.minutes * 60)}`,
      without: u => ({ ...u, minutes: null }),
    })
  }
  return out
}

/**
 * Whether the understanding is tags and nothing else, which is the one kind a
 * playlist can follow and keep itself filled from. Anything more is a set of
 * picks, made once: "10 jpop songs" too, since a playlist following jpop
 * holds every one of them. Every song (`EVERY_SONG`) is no number at all.
 */
export function onlyTags(understanding: Understanding): boolean {
  return (
    understanding.anyTags.length > 0 &&
    understanding.brief === null &&
    (understanding.size === null || understanding.size >= EVERY_SONG) &&
    parts(understanding, []).every(part => part.key.startsWith('tag:'))
  )
}

/** This device's tag ids for tag names, leaving out any it does not have. */
export function tagIdsFor(names: readonly string[], tags: readonly Tag[]): number[] {
  return names.flatMap(name =>
    tags.filter(tag => tag.name.toLowerCase() === name.toLowerCase()).map(tag => tag.id),
  )
}

interface DevicePick {
  readonly songId: number
  readonly why: string | null
}

/**
 * The picks as this device's songs. A song the server has and this device
 * does not yet is left out: it cannot be added to a playlist from here.
 */
export function picksHere(
  result: Pick<DescribeResult, 'picks'>,
  onDevice: (serverId: number) => number | undefined,
): DevicePick[] {
  return result.picks.flatMap(pick => {
    const songId = onDevice(pick.songId)
    return songId === undefined ? [] : [{ songId, why: pick.why }]
  })
}

/**
 * An answer's songs as this device has them, in the order you put them in on
 * its page (`order`, this device's ids), with any it did not cover — a song
 * that reached this device after the reorder — after them in the answer's
 * order. The card in Search and the answer's page both draw this, so the two
 * never disagree about how many songs or minutes it is.
 */
export function answerSongs<S extends { readonly id: number }>(
  result: Pick<DescribeResult, 'picks'>,
  order: readonly number[] | null,
  onDevice: (serverId: number) => number | undefined,
  byId: ReadonlyMap<number, S>,
): S[] {
  const picked = picksHere(result, onDevice).flatMap(pick => byId.get(pick.songId) ?? [])
  if (!order) return picked
  const place = new Map(order.map((songId, index) => [songId, index]))
  return [...picked].sort(
    (a, b) => (place.get(a.id) ?? order.length) - (place.get(b.id) ?? order.length),
  )
}

/**
 * What a describe answer says beside its songs: what fit, what it set aside,
 * the songs picked that this device does not have yet (`here` is how many
 * it shows), so a song missing here never reads as one it chose to leave out,
 * and whatever else made the songs fewer (the server's `notes`).
 *
 * Fewer than were asked for is said in so many words, after the first note
 * (which a list's head says as its own count): "about 15" that came back as
 * one song said only "picked from 2 that fit". A length is short when what
 * came (`seconds`, when the songs are at hand) is under nine tenths of it,
 * since songs never add up to it exactly.
 */
export function describeNotes(result: DescribeResult, here: number, seconds?: number): string[] {
  const notes: string[] = []
  const picked = Math.max(here, result.picks.length)
  notes.push(
    result.fit === picked
      ? `${plural(picked, 'song', 'songs')} fit`
      : `Picked ${picked} of the ${result.fit} that fit`,
  )
  const { size, minutes } = result.understanding
  const why = picked === result.fit ? 'no more fit' : `the rest that fit didn’t suit it`
  if (size !== null && size !== EVERY_SONG && picked < size) {
    notes.push(
      `Only ${plural(picked, 'song', 'songs')}, not the ${size} you asked for: ${
        result.fit < size && picked < result.fit ? `just ${result.fit} fit` : why
      }.`,
    )
  } else if (minutes !== null && seconds !== undefined && seconds < minutes * 60 * 0.9) {
    notes.push(
      `Only ${formatLongDuration(seconds)}, not the ${formatLongDuration(minutes * 60)} you asked for: ${why}.`,
    )
  }
  const away = picked - here
  if (away > 0) {
    notes.push(`${away === 1 ? 'One of them isn’t' : `${away} of them aren’t`} on this device yet.`)
  }
  if (result.loosened.length > 0) {
    notes.push(`Nothing fit all of it, so it let go of ${result.loosened.join(', ')}.`)
  }
  if (result.unknown.length > 0) {
    notes.push(`Your library has no ${result.unknown.join(', ')}.`)
  }
  notes.push(...result.notes)
  return notes
}

/** What the Ask offer says it does, in one line: Search's card and the palette's row alike. */
export const ASK_SUB = 'Play, find, list or tag songs'

/** Writing whose two characters are already a word: 情歌, 摇滚, 演歌, 발라드's first two. */
const WORD_PER_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * Whether the box offers to ask (S1, I1): three letters at least, or two in
 * Chinese, Japanese or Korean, where two characters say a whole thing. The
 * offer is always there for that much; where it sits and what Enter does
 * depend on whether anything matched (`asksOnEnter`).
 */
export function askable(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length >= 3) return true
  const characters = [...trimmed]
  return characters.length === 2 && characters.every(each => WORD_PER_CHARACTER.test(each))
}

/**
 * Whether Enter in Search sends the words to Ask (I1): only when nothing on
 * the device matches. People press Enter by reflex, so a song name that found
 * its song never leaves the search.
 */
export function asksOnEnter(text: string, matches: number): boolean {
  return askable(text) && matches === 0
}

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
const PLAYBACK_ASKED: Readonly<Record<AskPlaybackOp, string>> = {
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
 * What a reply showed, in words, for the follow-ups after it (F1): the model
 * hears what it said before, so it answers what is asked now rather than
 * everything again. Its own words first, then a line for each card in order:
 * words are their words, lists and reviews a line saying what they offered,
 * a playback card what it came to on this device (`carried`, by the card's
 * place) once it has. The songs themselves go as the turn's objects
 * (`objectsOf`), by id, so the recap does not name them.
 */
export function answerRecap(
  reply: AskReply,
  carried: Readonly<Record<number, string>> = {},
): string {
  const recap = [
    reply.say,
    ...reply.cards.map((card, index) =>
      card.kind === 'playback' && carried[index] !== undefined ? carried[index] : cardRecap(card),
    ),
  ]
    .filter(Boolean)
    .join('\n')
  return recap.length > RECAP_MAX ? `${recap.slice(0, RECAP_MAX - 1)}…` : recap
}

/** One card of a reply, in words for the model (`answerRecap`). */
function cardRecap(answer: AskCard): string {
  const picked = (result: DescribeResult): string =>
    `${plural(result.picks.length, 'song', 'songs')} (“${result.understanding.name}”)`
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
    case 'clarify':
      return answer.options.length > 0
        ? `Asked them: ${answer.question} (offered: ${answer.options.join('; ')})`
        : `Asked them: ${answer.question}`
  }
}

/** What a song answer was offered for, after its name in a recap. */
const LEAD_WORDS: Readonly<Record<'play' | 'save' | 'next', string>> = {
  play: 'to play now',
  save: 'to keep as a playlist',
  next: 'to play after the song playing',
}

/** The longest an object's label is. */
const LABEL_MAX = 120

/** A list's songs as shown now (moved on its page, changed since), and what it understands now. */
export interface ShownList {
  readonly songIds: readonly number[]
  readonly understanding: Understanding
}

/**
 * What a reply showed, as objects a follow-up can name by handle (F1,
 * AGENT-DESIGN 2.1): one for each card that showed songs, its songs by the
 * server's ids in the order shown, each with the reason it was given, and for
 * a list what it understood and what it was for. The handle is
 * `t{turn}.{card}`: `turn` the turn's place on the page and `card` the
 * card's in the reply, 1 for the first of each. `shown` is each list as it
 * is now, by its card's place in `reply.cards`; a card that showed no songs
 * has no object.
 */
export function objectsOf(
  reply: AskReply,
  turn: number,
  shown: ReadonlyMap<number, ShownList> = new Map(),
): AskObject[] {
  return reply.cards.flatMap((card, index) =>
    cardObjects(card, `t${turn}.${index + 1}`, shown.get(index)),
  )
}

/** One card's object, under its handle (`objectsOf`). */
function cardObjects(answer: AskCard, handle: string, shown: ShownList | undefined): AskObject[] {
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
        handle,
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
    case 'clarify':
      return []
  }
}

/** The longest line Ask's log gives an answer before it is cut short. */
const LOG_LINE_MAX = 90

/**
 * A reply as one line of Ask's log (S1, 2026-10-27): what came of it, for a
 * person and short — how many songs and their name, what is waiting to be
 * looked over, or the start of what was said — a part for each card, in
 * order. `told` is what a card came to on this device, by its place: a
 * proposal done with ("Fixed 31 songs"), a playback card carried out.
 * `answerRecap` is the model's.
 */
export function logLine(reply: AskReply, told: Readonly<Record<number, string>> = {}): string {
  const line = reply.cards.map((card, index) => told[index] ?? cardLine(card)).join(' + ')
  return line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX - 1)}…` : line
}

/** The first line of some words, cut to fit the log. */
function firstLine(said: string): string {
  const line = said.split('\n')[0]?.trim() ?? ''
  return line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX - 1)}…` : line
}

/** One card's part of the log's line (`logLine`). */
function cardLine(answer: AskCard): string {
  const first = firstLine
  const songs = (count: number): string => plural(count, 'song', 'songs')
  switch (answer.kind) {
    case 'songs':
      return `${songs(answer.describe.picks.length)} · ${answer.describe.understanding.name}`
    case 'together':
      return answer.describe
        ? `A listening room with ${songs(answer.describe.picks.length)}`
        : 'A listening room'
    case 'find':
      return plural(answer.picks.length, 'song found', 'songs found')
    case 'explore':
    case 'open':
      return first(answer.say)
    case 'clarify':
      return first(answer.question)
    case 'tags':
      return `${plural(answer.review.changes.length, 'tag change', 'tag changes')} to look over`
    case 'tidy':
      return `${plural(answer.tidy.changes.length, 'name change', 'name changes')} to look over`
    case 'copies':
      return `${songs(answer.copies.copies.length)} you have more than once`
    case 'remember':
      return 'Something to remember'
    case 'getMusic':
      return `${plural(answer.items.length, 'match', 'matches')} to get`
    case 'playlists':
      return answer.op === 'delete'
        ? `${plural(answer.names.length, 'playlist', 'playlists')} to delete`
        : 'A playlist to rename'
    case 'playlistSongs':
      return `A change to ${answer.playlist}`
    case 'library':
      return songs(answer.count)
    case 'stats':
      return `${plural(answer.plays, 'play', 'plays')} in ${rangeWords(answer.range)}`
    case 'playback':
      return `Asked to ${PLAYBACK_ASKED[answer.op]}`
  }
}

/**
 * A card's quiet heading in a reply of several (`AnswerBody`), so each part
 * of the reply reads as a part of it: "Songs to play", "Tag changes". Null
 * for words, which need none, and for a question back, always alone.
 */
export function cardHeading(card: AskCard): string | null {
  switch (card.kind) {
    case 'songs':
      return card.lead === 'play'
        ? 'Songs to play'
        : card.lead === 'save'
          ? 'Songs to keep'
          : 'To play next'
    case 'together':
      return 'Listening together'
    case 'find':
      return 'Could be it'
    case 'tags':
      return 'Tag changes'
    case 'tidy':
      return 'Name changes'
    case 'copies':
      return 'Songs you have twice'
    case 'remember':
      return 'To remember'
    case 'getMusic':
      return 'To get'
    case 'playlists':
    case 'playlistSongs':
      return 'Playlists'
    case 'library':
      return 'In your library'
    case 'stats':
      return 'Your listening'
    case 'playback':
      return 'Playing'
    case 'explore':
    case 'open':
    case 'clarify':
      return null
  }
}

/**
 * A change in a review (Tidy up's names, Tags' changes) as this device has it:
 * its key, whether a plain rule or the model found it, and its songs here.
 */
export interface Reviewed {
  readonly change: { readonly key: string; readonly by: 'rule' | 'model' }
  readonly songIds: readonly number[]
}

/** A Tidy up change as this device has it: its own song ids, still as the change found them. */
export interface TidyHere extends Reviewed {
  readonly change: TidyChange
}

/**
 * The server's changes on this device's songs. A song edited since the server
 * looked — its field no longer what the change says it is — is left out, so an
 * approval never overwrites an edit made in between.
 */
export function tidyHere(
  changes: readonly TidyChange[],
  onDevice: (serverId: number) => number | undefined,
  songsById: ReadonlyMap<number, Song>,
): TidyHere[] {
  return changes.flatMap(change => {
    const songIds = change.songIds.flatMap(serverId => {
      const id = onDevice(serverId)
      const song = id === undefined ? undefined : songsById.get(id)
      return song && tidyValue(song, change.field) === change.from ? [song.id] : []
    })
    return songIds.length > 0 ? [{ change, songIds }] : []
  })
}

/** One heading and its changes, in the order the server gave them. */
interface ReviewSection<T> {
  readonly title: string
  readonly changes: T[]
}

/**
 * The changes in two bands by how far to trust them: what a plain rule found,
 * then the model's guesses, each under its headings (Tidy up's reasons, the
 * tags' kinds of change). An empty band is left out.
 */
export function reviewBands<T extends Reviewed>(
  changes: readonly T[],
  sectionOf: (change: T) => string,
): { by: Reviewed['change']['by']; sections: ReviewSection<T>[] }[] {
  return (['rule', 'model'] as const).flatMap(by => {
    const sections = new Map<string, ReviewSection<T>>()
    for (const here of changes) {
      if (here.change.by !== by) continue
      const title = sectionOf(here)
      const section = sections.get(title) ?? { title, changes: [] }
      section.changes.push(here)
      sections.set(title, section)
    }
    return sections.size > 0 ? [{ by, sections: [...sections.values()] }] : []
  })
}

/** A song left out of a change it would otherwise be part of. */
export function leftOutKey(changeKey: string, songId: number): string {
  return `${changeKey}:${songId}`
}

/** The songs of a change still in it: all of them, less the ones left out. */
export function keptSongs(here: Reviewed, leftOut: ReadonlySet<string>): number[] {
  return here.songIds.filter(id => !leftOut.has(leftOutKey(here.change.key, id)))
}

/**
 * The approved changes as one edit per song, a title and an artist fixed
 * together, a year as the number it is. `undo` writes each field back to what
 * it was, for the toast's Undo. A cover is no edit of the song's own: the
 * server takes it in (`tidyCovers`).
 */
export function tidyEdits(
  changes: readonly TidyHere[],
  leftOut: ReadonlySet<string> = new Set(),
  undo = false,
): BulkEditSongs['edits'] {
  const patches = new Map<number, Record<string, string | number | null>>()
  for (const here of changes) {
    const { field, from, to } = here.change
    if (field === 'cover') continue
    const value = undo ? from : to
    for (const id of keptSongs(here, leftOut)) {
      patches.set(id, {
        ...patches.get(id),
        [field]: field === 'year' ? (value === '' ? null : Number(value)) : value,
      })
    }
  }
  return [...patches].map(([songId, patch]) => ({ songId, patch }))
}

/**
 * What a checkup found missing, in a sentence: "3 songs have no album, 10 no
 * year and 2 no cover."
 */
export function gapWords(gaps: { album: number; year: number; cover: number }): string {
  const parts = (['album', 'year', 'cover'] as const).filter(field => gaps[field] > 0)
  const said = parts.map((field, index) =>
    index === 0
      ? `${plural(gaps[field], 'song has', 'songs have')} no ${field}`
      : `${gaps[field].toLocaleString('en')} no ${field}`,
  )
  const last = said.pop()
  return `${said.length > 0 ? `${said.join(', ')} and ${last}` : last}.`
}

/** The approved covers: each song (this device's id) and the picture it takes. */
export function tidyCovers(
  changes: readonly TidyHere[],
  leftOut: ReadonlySet<string> = new Set(),
): { songId: number; artworkUrl: string }[] {
  return changes.flatMap(here =>
    here.change.field === 'cover'
      ? keptSongs(here, leftOut).map(songId => ({ songId, artworkUrl: here.change.to }))
      : [],
  )
}

/**
 * A copy as this device has it: the extra copies still here, and the one kept.
 * A copy already gone, or one whose kept song is gone, is left out — deleting
 * the last of a song is never what was offered.
 */
export interface CopyHere extends Reviewed {
  readonly change: TidyCopy
  readonly keep: Song
}

export function copiesHere(
  copies: readonly TidyCopy[],
  onDevice: (serverId: number) => number | undefined,
  songsById: ReadonlyMap<number, Song>,
): CopyHere[] {
  return copies.flatMap(change => {
    const keepId = onDevice(change.keep)
    const keep = keepId === undefined ? undefined : songsById.get(keepId)
    if (!keep) return []
    const songIds = change.songIds.flatMap(serverId => {
      const id = onDevice(serverId)
      return id !== undefined && songsById.has(id) ? [id] : []
    })
    return songIds.length > 0 ? [{ change, keep, songIds }] : []
  })
}

/** A piece of a change drawn on one line: kept, taken out, or put in. */
interface TidyPart {
  readonly kind: 'same' | 'gone'
  readonly text: string
}

/** Words, runs of space and single marks: what a name is compared in. */
const PIECES = /[\p{L}\p{N}\p{M}]+|\s+|[^\p{L}\p{N}\p{M}\s]/gu

/**
 * A change as one line when it only takes words out — a repeated name, the
 * video's words, a translation, a stray comma: the name as it is, with the
 * part that goes marked. Anything that puts words in (another spelling,
 * another script) is a rename, drawn as old → new, and gets null here.
 */
export function tidyParts(from: string, to: string): TidyPart[] | null {
  const a = from.match(PIECES) ?? []
  const b = to.match(PIECES) ?? []
  // The longest run of `to` found in order in `from`, from the end back.
  const longest = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i]![j] =
        a[i] === b[j]
          ? longest[i + 1]![j + 1]! + 1
          : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!)
    }
  }
  if (longest[0]![0] !== b.length || b.join('') !== to) return null
  const parts: TidyPart[] = []
  const put = (kind: TidyPart['kind'], text: string): void => {
    const last = parts[parts.length - 1]
    if (last?.kind === kind) parts[parts.length - 1] = { kind, text: last.text + text }
    else parts.push({ kind, text })
  }
  let j = 0
  for (let i = 0; i < a.length; i++) {
    // Keep a piece only when the rest of `to` still fits after it, so what
    // goes is the later copy: "A, B, A, C" loses its second A, not its first.
    if (j < b.length && a[i] === b[j] && longest[i + 1]![j + 1] === b.length - j - 1) {
      put('same', a[i]!)
      j++
    } else put('gone', a[i]!)
  }
  return parts
}

/** Rule-found changes start ticked; the model's wait for a yes. */
export function tickedAtFirst(changes: readonly Reviewed[]): Set<string> {
  return new Set(changes.filter(here => here.change.by === 'rule').map(here => here.change.key))
}

/**
 * A tag change as this device has it. An add keeps only songs still without
 * the tag and a remove only songs still with it, so an approval never undoes
 * an edit made since; a change to a tag that is gone, or a rename onto a name
 * taken since, is left out.
 */
export interface TagHere extends Reviewed {
  readonly change: TagChange
  /** The tag here; null only for an add that makes it. */
  readonly tag: Tag | null
  /** The tag a merge goes into. */
  readonly into: Tag | null
}

export function tagChangesHere(
  changes: readonly TagChange[],
  onDevice: (serverId: number) => number | undefined,
  songsById: ReadonlyMap<number, Song>,
  tags: readonly Tag[],
): TagHere[] {
  const named = (name: string | null): Tag | null =>
    name === null ? null : (tags.find(tag => tag.name.toLowerCase() === name.toLowerCase()) ?? null)
  return changes.flatMap((change): TagHere[] => {
    const tag = named(change.tag)
    if (change.op === 'add' || change.op === 'remove') {
      if (!tag && (change.op === 'remove' || !change.isNew)) return []
      const songIds = change.songIds.flatMap(serverId => {
        const id = onDevice(serverId)
        const song = id === undefined ? undefined : songsById.get(id)
        if (!song) return []
        const has = tag !== null && song.tagIds.includes(tag.id)
        return has === (change.op === 'remove') ? [song.id] : []
      })
      return songIds.length > 0 ? [{ change, songIds, tag, into: null }] : []
    }
    if (!tag) return []
    if (change.op === 'merge') {
      const into = named(change.to)
      return into && into.id !== tag.id ? [{ change, songIds: [], tag, into }] : []
    }
    if (change.op === 'rename') {
      const taken = named(change.to)
      return change.to && (!taken || taken.id === tag.id)
        ? [{ change, songIds: [], tag, into: null }]
        : []
    }
    return [{ change, songIds: [], tag, into: null }]
  })
}

/** A tag by its id, or one made earlier in the same apply, by its name. */
export type TagRef = { readonly id: number } | { readonly name: string }

/** A live playlist's rules, kept to put back. */
interface RulesBefore {
  readonly id: number
  readonly rules: SmartRules
}

/** One step of applying tag changes, in the order they run. */
export type TagStep =
  | { readonly kind: 'make'; readonly name: string }
  | {
      readonly kind: 'songs'
      readonly action: 'add' | 'remove'
      readonly tag: TagRef
      readonly songIds: readonly number[]
    }
  | { readonly kind: 'rename'; readonly tagId: number; readonly from: string; readonly to: string }
  | {
      readonly kind: 'merge'
      readonly from: Tag
      readonly into: Tag
      /** The songs it held, to give back on Undo. */
      readonly songIds: readonly number[]
      /** Its songs without `into` yet: the ones that gain it. */
      readonly gaining: readonly number[]
      readonly playlists: readonly RulesBefore[]
    }
  | {
      readonly kind: 'delete'
      readonly tag: Tag
      readonly songIds: readonly number[]
      readonly playlists: readonly RulesBefore[]
    }

/** A live playlist's rules with one tag swapped for another, a rule that repeats dropped. */
export function swapTagInRules(rules: SmartRules, from: number, to: number): SmartRules {
  const out: SmartRules['rules'] = []
  for (const rule of rules.rules) {
    const swapped = rule.field === 'tag' && rule.tagId === from ? { ...rule, tagId: to } : rule
    const repeat = out.some(
      other =>
        other.field === 'tag' &&
        swapped.field === 'tag' &&
        other.tagId === swapped.tagId &&
        other.op === swapped.op,
    )
    if (!repeat) out.push(swapped)
  }
  return { ...rules, rules: out }
}

/** The live playlists that follow a tag, with their rules as they are. */
function followersOf(tagId: number, playlists: readonly Playlist[]): RulesBefore[] {
  return playlists.flatMap(playlist =>
    playlist.kind === 'live' &&
    playlist.rules.rules.some(rule => rule.field === 'tag' && rule.tagId === tagId)
      ? [{ id: playlist.id, rules: playlist.rules }]
      : [],
  )
}

/**
 * The approved tag changes as the steps that make them: new tags first, then
 * songs in and out of tags, then renames, merges and deletes, so a change to
 * songs always finds its tag by the id it has now. A merge gives its songs the
 * tag it goes into, moves the playlists following it over, then deletes it.
 */
export function tagSteps(
  approved: readonly TagHere[],
  leftOut: ReadonlySet<string>,
  songs: readonly Song[],
  playlists: readonly Playlist[],
): TagStep[] {
  const make: TagStep[] = []
  const members: TagStep[] = []
  const renames: TagStep[] = []
  const merges: TagStep[] = []
  const deletes: TagStep[] = []
  const holding = (tag: Tag): number[] =>
    songs.filter(song => song.tagIds.includes(tag.id)).map(song => song.id)
  for (const here of approved) {
    const { change, tag } = here
    switch (change.op) {
      case 'add':
      case 'remove': {
        const songIds = keptSongs(here, leftOut)
        if (songIds.length === 0) break
        if (!tag) make.push({ kind: 'make', name: change.tag })
        members.push({
          kind: 'songs',
          action: change.op,
          tag: tag ? { id: tag.id } : { name: change.tag },
          songIds,
        })
        break
      }
      case 'rename':
        renames.push({ kind: 'rename', tagId: tag!.id, from: tag!.name, to: change.to! })
        break
      case 'merge': {
        const songIds = holding(tag!)
        const gaining = songs
          .filter(song => song.tagIds.includes(tag!.id) && !song.tagIds.includes(here.into!.id))
          .map(song => song.id)
        merges.push({
          kind: 'merge',
          from: tag!,
          into: here.into!,
          songIds,
          gaining,
          playlists: followersOf(tag!.id, playlists),
        })
        break
      }
      case 'delete':
        deletes.push({
          kind: 'delete',
          tag: tag!,
          songIds: holding(tag!),
          playlists: followersOf(tag!.id, playlists),
        })
        break
    }
  }
  return [...make, ...members, ...renames, ...merges, ...deletes]
}

/** "Put on songs", "Remove from songs", …: the heading a tag change is listed under. */
export function tagSection(change: TagChange): string {
  switch (change.op) {
    case 'add':
      return 'Put on songs'
    case 'remove':
      return 'Remove from songs'
    case 'rename':
      return 'Rename'
    case 'merge':
      return 'Merge'
    case 'delete':
      return 'Delete'
  }
}

/** "calmest first", "newest first": an order said the way a person would. */
export function sortWords(by: AskSort, order: AskOrder): string {
  const up = order === 'asc'
  switch (by) {
    case 'energy':
      return up ? 'calmest first' : 'liveliest first'
    case 'bpm':
      return up ? 'slowest first' : 'fastest first'
    case 'year':
      return up ? 'oldest release first' : 'newest release first'
    case 'title':
      return up ? 'by title, A to Z' : 'by title, Z to A'
    case 'artist':
      return up ? 'by artist, A to Z' : 'by artist, Z to A'
    case 'addedAt':
      return up ? 'oldest first' : 'newest first'
    case 'duration':
      return up ? 'shortest first' : 'longest first'
    case 'plays':
      return up ? 'least played first' : 'most played first'
    case 'lastPlayed':
      return up ? 'longest unplayed first' : 'most recently played first'
  }
}

/**
 * A playlist edit in this device's songs, against the playlist as it is now:
 * an add keeps the songs not in it, a remove the ones still in it, and a sort
 * is the new order with any song added since kept at the end.
 */
export function playlistEditHere(
  answer: Extract<AskCard, { kind: 'playlistSongs' }>,
  onDevice: (serverId: number) => number | undefined,
  current: readonly number[],
): { songIds: number[]; why: Map<number, string> } {
  const inIt = new Set(current)
  const why = new Map<number, string>()
  const mapped = answer.songs.flatMap(pick => {
    const id = onDevice(pick.songId)
    if (id === undefined) return []
    if (pick.why) why.set(id, pick.why)
    return [id]
  })
  if (answer.op === 'sort') {
    const order = mapped.filter(id => inIt.has(id))
    const placed = new Set(order)
    return { songIds: [...order, ...current.filter(id => !placed.has(id))], why }
  }
  const adding = answer.op === 'add'
  return { songIds: mapped.filter(id => inIt.has(id) !== adding), why }
}

/**
 * Three things to ask before the first question, made from this library (L1,
 * 2026-10-25): music for the tag played most, the month's most played, and the
 * songs still without a tag by whoever has most of them — or, with every song
 * tagged, more like the artist with most songs. Fewer when the library has
 * nothing to make one from.
 */
export function askSuggestions(
  tags: readonly Pick<Tag, 'name'>[],
  untaggedBy: string | null,
  topArtist: string | null,
): string[] {
  const [tag] = tags
  return [
    tag ? `Something for ${tag.name}` : null,
    'What did I play most last month?',
    untaggedBy
      ? `Tag my untagged ${untaggedBy} songs`
      : topArtist
        ? `More like ${topArtist}`
        : null,
  ].filter((line): line is string => line !== null)
}

/**
 * What a tag review counts, one way everywhere on it (X4, 2026-10-25): its
 * title, what is ticked, each band, "Review all" and the button. Songs, when
 * every change gives songs a tag or takes one off — that is what a person
 * asked about ("tag 5 of my untagged songs"), and a song with two tags is
 * one song; changes, when a tag itself is renamed, merged or deleted.
 * "7 changes", "4 ticked" and "Apply 4 changes" over three rows read as
 * three different numbers.
 */
export function tagCounter(
  all: readonly TagHere[],
): (list: readonly TagHere[], leftOut?: ReadonlySet<string>) => number {
  if (!all.every(each => onSongs(each.change.op))) return list => list.length
  return (list, leftOut = new Set()) => new Set(list.flatMap(each => keptSongs(each, leftOut))).size
}

function onSongs(op: TagChange['op']): boolean {
  return op === 'add' || op === 'remove'
}

/** "Tags for 5 songs", "2 changes to your tags": a tag review's title, in what `tagCounter` counts. */
export function tagsTitle(ops: readonly TagChange['op'][], count: number): string {
  const songs = count === 1 ? 'one song' : `${count} songs`
  if (ops.every(op => op === 'add')) return `Tags for ${songs}`
  if (ops.every(op => op === 'remove')) return `Tags to take off ${songs}`
  if (ops.every(onSongs)) return `Tag changes for ${songs}`
  return count === 1 ? 'One change to your tags' : `${count} changes to your tags`
}

/**
 * The button under a tag review, naming what it does to the `ticked` of
 * them, in what `tagCounter` counts: "Tag 5 songs", "Make 2 changes". What it
 * does is read from all of them, so the button keeps its verb while nothing
 * is ticked.
 */
export function tagsApply(ops: readonly TagChange['op'][], ticked: number): string {
  const songs = plural(ticked, 'song', 'songs')
  if (ops.every(op => op === 'add')) return ticked === 0 ? 'Tag' : `Tag ${songs}`
  if (ops.every(op => op === 'remove')) return ticked === 0 ? 'Take off' : `Take tags off ${songs}`
  if (ops.every(onSongs)) return ticked === 0 ? 'Apply' : `Change ${songs}`
  return ticked === 0 ? 'Apply' : ticked === 1 ? 'Make the change' : `Make ${ticked} changes`
}

/** "One thing to fix", "3 things to fix", and its button: "Fix it", "Fix 3 things" (AD1). */
export function shortTidyTitle(count: number): string {
  return count === 1 ? 'One thing to fix' : `${count} things to fix`
}

export function shortTidyApply(count: number): string {
  return count === 0 ? 'Fix' : count === 1 ? 'Fix it' : `Fix ${count} things`
}
