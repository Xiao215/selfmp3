import { pinyin } from 'pinyin-pro'
import { clamp01, cleanTitle, editDistance, splitArtists, type ImportFound } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { pool } from '../util/pool.js'
import { swapped, type ListedTrack } from './trackLists.js'
import type { ProbedTrack } from './ytdlp.js'
import type { CreditedSong, YouTubeMusicLists } from './youtubeMusicLists.js'

/**
 * Finding a song on YouTube by its name: a Spotify list, a pasted list of
 * names, a 网易云 song it will not give out.
 *
 * YouTube Music's song search is asked, not yt-dlp's: one plain web request
 * per song rather than a paced yt-dlp run (ytThrottle.ts), and its answers
 * are songs with their artist, album, length and square art, not videos. The
 * first answer is usually right, but not always — a live take, another
 * singer's cover — so each is scored on how well its title and artist match
 * and how close its length is, and a weak best is said to be unsure, for the
 * person to listen to before importing.
 *
 * A good score is not enough to be sure. A song YouTube Music does not have
 * is answered with other people's covers of it, and a cover has the song's
 * name and very nearly its length: by the score alone it is the song. So a
 * match is sure only when the answer is also by the artist asked for
 * (`ByArtist`), and the rest are left to be listened to.
 *
 * The scoring is pure, so the weighting can be tuned against a table of real
 * cases.
 */

/** At or above this a match by the artist asked for is taken without a second thought. */
const SURE = 0.7
/** Below this the best answer is not the song at all. */
const FOUND = 0.4
/** What being YouTube Music's first answer adds; see `bestMatch`. */
const FIRST = 0.08
/** Songs looked up at once. */
const CONCURRENCY = 4
/** Artists whose channels are remembered; past it the memory starts again. */
const ARTISTS_REMEMBERED = 2_000

/** What has been folded already: a library is compared with every pasted song. */
const folded = new Map<string, string>()

/**
 * Lower-case, no accents, no punctuation, single spaces — and Chinese as its
 * pinyin. 网易云 writes 周杰伦 where YouTube Music writes 周杰倫, and the two
 * scripts differ in nearly every character a famous name has; read aloud
 * they are the same, and pinyin is how they are read.
 *
 * A run of characters is one word, its syllables run together: 周杰伦 is
 * "zhoujielun", not "zhou jie lun". One syllable a word would let any two
 * names that share characters match in any order: 忘我 would be found
 * inside 我不曾忘记.
 */
export function normalizeForMatch(text: string): string {
  const known = folded.get(text)
  if (known !== undefined) return known
  const result = fold(text)
  if (folded.size > 20_000) folded.clear()
  folded.set(text, result)
  return result
}

function fold(raw: string): string {
  const text = raw.replace(
    /\p{Script=Han}+/gu,
    run => ` ${pinyin(run, { toneType: 'none', type: 'array' }).join('')} `,
  )
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 0–1 similarity: the better of edit similarity and token overlap, over text
 * folded to pinyin. Not lookupScore.ts's `candidateSimilarity`, on purpose:
 * this one compares names across scripts (周杰伦 / 周杰倫) and has a cheap
 * threshold form (`similarAtLeast`) for checking a whole library, where that
 * one scores catalogue entries in one script against tags with release noise.
 */
export function matchSimilarity(a: string, b: string): number {
  const x = normalizeForMatch(a)
  const y = normalizeForMatch(b)
  if (!x || !y) return 0
  if (x === y) return 1

  const longest = Math.max(x.length, y.length)
  const edit = 1 - editDistance(x, y, longest) / longest

  return Math.max(edit, overlap(new Set(x.split(' ')), new Set(y.split(' '))))
}

/** Text folded for `similarAtLeast` once, rather than once per comparison. */
export interface Folded {
  readonly text: string
  readonly words: ReadonlySet<string>
}

export function foldForMatch(raw: string): Folded {
  const text = normalizeForMatch(raw)
  return { text, words: new Set(text.split(' ')) }
}

/**
 * `matchSimilarity(a, b) >= threshold`, the same answer, cheaply.
 *
 * The full edit distance is most of `matchSimilarity`'s cost, and a duplicate check
 * asks it of every song in the library for every song pasted: 50 against
 * 1,400 took 300 ms, all of it on the one thread every request waits on. Asked
 * only whether a threshold is reached, the word overlap answers first when it
 * can, and the edit distance stops as soon as it is too far to reach it.
 */
export function similarAtLeast(a: Folded, b: Folded, threshold: number): boolean {
  if (!a.text || !b.text) return threshold <= 0
  if (a.text === b.text) return true
  if (overlap(a.words, b.words) >= threshold) return true
  const longest = Math.max(a.text.length, b.text.length)
  // Any distance past this one fails, so the count can stop there.
  const allowed = Math.ceil((1 - threshold) * longest)
  return 1 - editDistance(a.text, b.text, allowed) / longest >= threshold
}

/** The word half of `matchSimilarity`. */
function overlap(wordsA: ReadonlySet<string>, wordsB: ReadonlySet<string>): number {
  let shared = 0
  for (const word of wordsA) if (wordsB.has(word)) shared++
  // Containment rather than Jaccard: "get lucky" inside "daft punk get lucky
  // official audio" is a match, and the extra words are handled elsewhere.
  const containment = shared / Math.min(wordsA.size, wordsB.size)
  const jaccard = shared / (wordsA.size + wordsB.size - shared)
  return containment * 0.85 + jaccard * 0.15
}

/**
 * Words that mean "this is not the studio recording", in English and as
 * 网易云 and YouTube Music write them in Chinese and Japanese: 翻自 for a
 * cover, 伴奏 for the backing track, a bracket that starts with a DJ's name.
 * One line is one meaning in every language, so a song asked for as
 * 后来 (现场) is not marked down for an answer called "后来 (Live)".
 */
const PENALTIES: readonly { pattern: RegExp; weight: number }[] = [
  { pattern: /\blive\b|现场|現場|演唱会|演唱會|ライブ/i, weight: 0.3 },
  { pattern: /\bcover\b|翻自|翻唱|カバー|歌ってみた/i, weight: 0.35 },
  { pattern: /\bremix\b|混音|[(（[【]\s*dj\b|\bdj\s*版/i, weight: 0.3 },
  { pattern: /\breaction\b/i, weight: 0.6 },
  { pattern: /\breacts?\b/i, weight: 0.6 },
  { pattern: /\b8d\b/i, weight: 0.55 },
  { pattern: /\bsped ?up\b|加速|倍速/i, weight: 0.55 },
  { pattern: /\bslowed\b|降速|慢速|减速|減速/i, weight: 0.55 },
  { pattern: /\bnightcore\b/i, weight: 0.55 },
  { pattern: /\bkaraoke\b|卡拉\s*ok|カラオケ/i, weight: 0.4 },
  {
    pattern: /\binstrumental\b|\boff ?vocal\b|伴奏|纯音乐|純音樂|オフボーカル|インスト/i,
    weight: 0.35,
  },
  { pattern: /\bacoustic\b/i, weight: 0.2 },
  { pattern: /\btutorial\b/i, weight: 0.5 },
  { pattern: /\bmashup\b|\bmedley\b|串烧|串燒|联唱|聯唱|メドレー/i, weight: 0.35 },
  { pattern: /\b(?:1|2|3|5|10) hours?\b/i, weight: 0.5 },
  { pattern: /\bloop\b/i, weight: 0.3 },
  { pattern: /\bextended\b/i, weight: 0.15 },
  { pattern: /\btrailer\b/i, weight: 0.4 },
  // Sung by someone else, or in another language: 女声版, 粤语版.
  { pattern: /[女男童][声聲]?版/, weight: 0.35 },
  { pattern: /(?:粤语|粵語|国语|國語|日语|日語|英文|韩语|韓語)版/, weight: 0.3 },
  // Played on one instrument: 钢琴版, 吉他弹唱.
  { pattern: /(?:钢琴|鋼琴|吉他|古筝|古箏|小提琴|八音盒)(?:版|曲|演奏|弹唱|彈唱)/, weight: 0.35 },
  { pattern: /抖音/, weight: 0.3 },
  { pattern: /\bsnippet\b|\bpreview\b|片段|试听|試聽/i, weight: 0.5 },
  // Lyric videos are usually the real audio with words on top; barely a mark down.
  { pattern: /\blyrics?\b/i, weight: 0.03 },
]

const BONUSES: readonly { pattern: RegExp; weight: number }[] = [
  { pattern: /\bofficial (?:audio|music video|video|visuali[sz]er)\b/i, weight: 0.05 },
  { pattern: /\bprovided to youtube\b/i, weight: 0.05 },
]

/** "The Weeknd" should not match every video with "the" in the title. */
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'los', 'las', 'le', 'la', 'les'])

function isTopicChannel(channel: string): boolean {
  return /\s-\s*topic$/i.test(channel.trim())
}

function isVevoChannel(channel: string): boolean {
  return /vevo$/i.test(channel.trim())
}

/** Closeness of two lengths, 1 at ≤3s apart falling to 0 at 45s apart. */
export function durationScore(source: number, candidate: number): number | null {
  if (source <= 0 || candidate <= 0) return null
  const diff = Math.abs(source - candidate)
  if (diff <= 3) return 1
  if (diff >= 45) return 0
  return 1 - (diff - 3) / 42
}

/** What a result offers the scoring: its title, who it is by, and its length. */
export interface MatchHit {
  readonly title: string
  /** The channel or credited artist. */
  readonly channel: string
  /** Seconds; 0 when unknown. */
  readonly duration: number
  /** The album it is from, when it says: a concert's album is a live take whatever the title says. */
  readonly album?: string
}

/**
 * Score one result. The video title is split on its dashes so "Daft Punk -
 * Get Lucky" is compared part by part against the artist and the title, and
 * the artist is also looked for in the channel name.
 */
export function scoreHit(source: ListedTrack, hit: MatchHit): number {
  const sourceTitle = cleanTitle(source.title)
  const sourceArtist = source.artist
  const videoTitle = cleanTitle(hit.title)
  const channel = hit.channel.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '')
  const parts = videoTitle.split(/\s+[-–—|:]\s+|\s*[–—]\s*|\s+"|"\s*/).filter(part => part.trim())

  let title = matchSimilarity(sourceTitle, videoTitle)
  for (const part of parts) title = Math.max(title, matchSimilarity(sourceTitle, part))

  let artist: number
  if (!sourceArtist.trim()) {
    artist = 0.6
  } else {
    artist = matchSimilarity(sourceArtist, channel)
    for (const part of parts) artist = Math.max(artist, matchSimilarity(sourceArtist, part))
    // Artist named anywhere in the video title still counts for a lot.
    const allTokens = normalizeForMatch(sourceArtist).split(' ')
    const meaningful = allTokens.filter(token => !STOPWORDS.has(token))
    const artistTokens = meaningful.length > 0 ? meaningful : allTokens
    const haystack = ` ${normalizeForMatch(`${videoTitle} ${channel}`)} `
    const found = artistTokens.filter(token => haystack.includes(` ${token} `)).length
    artist = Math.max(artist, (found / artistTokens.length) * 0.9)
  }

  // Multiplicative on purpose: the wrong song by the right artist at the
  // right length is still the wrong song, so nothing can rescue a bad title.
  const textScore = title * (0.7 + 0.3 * artist)
  const durationCloseness = durationScore(source.duration, hit.duration)
  // No length to compare: neither reward nor punish, just lean on the text.
  let score = durationCloseness === null ? textScore : textScore * (0.75 + 0.25 * durationCloseness)

  if (isTopicChannel(hit.channel)) score += 0.08
  else if (isVevoChannel(hit.channel)) score += 0.04
  for (const bonus of BONUSES) if (bonus.pattern.test(hit.title)) score += bonus.weight

  const sourceText = `${source.title} ${source.album}`
  const hitText = `${hit.title} ${hit.album ?? ''}`
  for (const penalty of PENALTIES) {
    if (penalty.pattern.test(hitText) && !penalty.pattern.test(sourceText)) score -= penalty.weight
  }

  // A result twice as long as the song is a compilation whatever the title says.
  if (source.duration > 0 && hit.duration > source.duration * 2 + 30) score -= 0.3

  return clamp01(score)
}

/**
 * Whether an answer is by the artist a song names, as far as anything says.
 * What can say so: the two names being alike, a name the artist also goes by,
 * the album being the same one, and the answer's channel being the artist's
 * on YouTube Music (`YouTubeMatcher.byArtist`). A song that names no artist
 * is not asked.
 */
export type ByArtist = (source: ListedTrack, answer: ProbedTrack) => boolean

/** Text folded and run together, so "G.E.M." is "GEM" and 周杰伦 is 周杰倫. */
const compact = (text: string): string => normalizeForMatch(text).replaceAll(' ', '')

/** A run of Chinese, Japanese or Korean writing. */
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu

/**
 * The ways one name is written, each `compact`: the whole of it, and each
 * side where it is written twice — in brackets ("五月天 (Mayday)"), around a
 * dash ("陳奕迅 - Eason Chan"), or as two scripts side by side
 * ("G.E.M.邓紫棋", "周杰倫 Jay Chou").
 *
 * Nothing looser. A name that only holds another is somebody else: 五月天 阿信
 * is not 五月天, and "Daft Punk Tribute Band" is not Daft Punk.
 */
function writtenAs(name: string): Set<string> {
  const ways = new Set<string>()
  const sides = name.split(/\s+-\s+|[()（）[\]【】]/)
  for (const side of [name, ...sides]) {
    ways.add(compact(side))
    // Two scripts side by side: one run of each, and nothing else ("Official髭男dism" is one name).
    const native = side.match(CJK_RUN) ?? []
    const latin = side.split(CJK_RUN).filter(piece => compact(piece) !== '')
    if (native.length === 1 && latin.length === 1) {
      ways.add(compact(native[0] ?? ''))
      ways.add(compact(latin[0] ?? ''))
    }
  }
  ways.delete('')
  return ways
}

/** Whether two names are one artist's: some way one is written is a way the other is. */
function sameArtist(a: string, b: string): boolean {
  const ways = writtenAs(b)
  return [...writtenAs(a)].some(way => ways.has(way))
}

/**
 * By what is written alone: one of the answer's artists is named as one of
 * the song's is, or as a name they also go by; or both are from the same
 * album.
 *
 * An album named after its song is a single, and says nothing: a cover is a
 * single of the same name.
 */
export function namedAlike(
  source: ListedTrack,
  answer: Pick<ProbedTrack, 'artist' | 'album'>,
  otherNames: readonly string[] = [],
): boolean {
  const asked = [...splitArtists(source.artist), ...otherNames]
  const credited = splitArtists(answer.artist)
  if (asked.some(name => credited.some(other => sameArtist(name, other)))) return true
  const album = compact(cleanTitle(source.album))
  return (
    album !== '' &&
    album === compact(cleanTitle(answer.album)) &&
    album !== compact(cleanTitle(source.title))
  )
}

/** One of YouTube Music's answers for a song: how well it matched, and whether it can be taken unheard. */
interface Match {
  readonly track: ProbedTrack
  readonly confidence: number
  /** A good match by the artist asked for; a good match by anyone, for a song that names no artist. */
  readonly sure: boolean
}

/**
 * The best of YouTube Music's answers for a song; null for none worth having.
 * An answer that is sure is taken before a better-scoring one that is not: the
 * artist's own recording, where there is one, rather than a cover that
 * happened to come first.
 */
export function bestMatch(
  source: ListedTrack,
  results: readonly ProbedTrack[],
  by: ByArtist = namedAlike,
): Match | null {
  const asksArtist = source.artist.trim() !== ''
  let best: Match | null = null
  for (const [rank, track] of results.entries()) {
    const score = scoreHit(source, {
      title: track.title,
      channel: track.artist,
      duration: track.duration,
      album: track.album,
    })
    /*
     * YouTube Music's own first answer gets a little more trust: it is the
     * one it thinks was meant, and it knows a song by names no comparison
     * here can see.
     */
    const confidence = Math.round(Math.min(1, score + (rank === 0 ? FIRST : 0)) * 100) / 100
    const sure = confidence >= SURE && (!asksArtist || by(source, track))
    if (!best || (sure && !best.sure) || (sure === best.sure && confidence > best.confidence)) {
      best = { track, confidence, sure }
    }
  }
  return best && best.confidence >= FOUND ? best : null
}

/**
 * The best of YouTube Music's answers, for the song as it was written or read
 * the other way round. "Never Gonna Give You Up - Rick Astley" is as likely
 * as "Rick Astley - Never Gonna Give You Up", and a list too short to tell
 * (`guessOrder`) reads it as the second; the search is the same words either
 * way, and whichever reading its answers fit better is the song.
 */
export function bestReading(
  source: ListedTrack,
  results: readonly ProbedTrack[],
  by: ByArtist = namedAlike,
): (Match & { reversed: boolean }) | null {
  const asWritten = bestMatch(source, results, by)
  const written = asWritten && { ...asWritten, reversed: false }
  if (!source.artist.trim()) return written
  const reversed = bestMatch(swapped(source), results, by)
  if (!reversed) return written
  if (asWritten) {
    const better =
      reversed.sure === asWritten.sure ? reversed.confidence > asWritten.confidence : reversed.sure
    if (!better) return written
  }
  return { ...reversed, reversed: true }
}

/** The query sent to YouTube. Artist first: it narrows results better. */
export function searchQuery(source: ListedTrack): string {
  return [source.artist, cleanTitle(source.title)]
    .filter(part => part.trim())
    .join(' ')
    .trim()
}

/**
 * Whether an artist a search listed is the one asked for by name: one of the
 * ways the row writes them (`writtenAs`: "陳奕迅 - Eason Chan",
 * "Yorushika(ヨルシカ)") is the name asked for, whole.
 */
export function listedAs(listed: string, asked: string): boolean {
  const wanted = compact(asked)
  return wanted !== '' && writtenAs(listed).has(wanted)
}

/**
 * The languages to ask YouTube Music about an artist in, in turn: the one
 * their name is written in, so the answer is written the same way and can be
 * recognised. Characters alone may be Chinese or Japanese: asked in Chinese
 * 米津玄師 is "Kenshi Yonezu", and in Japanese he is 米津玄師.
 */
export function languagesOf(name: string): readonly string[] {
  if (/[\u3040-\u30ff]/.test(name)) return ['ja']
  if (/[\uac00-\ud7af]/.test(name)) return ['ko']
  if (/\p{Script=Han}/u.test(name)) return ['zh-TW', 'ja']
  return ['en']
}

export class YouTubeMatcher {
  readonly #lists: Pick<YouTubeMusicLists, 'songsBy' | 'artists'>
  readonly #otherNames: (artist: string) => readonly string[]
  readonly #logger: Logger
  /** Each artist asked about, by `compact` name: their channels on YouTube Music. */
  readonly #channels = new Map<string, Promise<ReadonlySet<string>>>()

  constructor(deps: {
    lists: Pick<YouTubeMusicLists, 'songsBy' | 'artists'>
    /** The names the library knows an artist also goes by (services/artistNames.ts). */
    otherNames?: (artist: string) => readonly string[]
    logger: Logger
  }) {
    this.#lists = deps.lists
    this.#otherNames = deps.otherNames ?? (() => [])
    this.#logger = deps.logger.child('youtube-match')
  }

  /** Each song found on YouTube Music, in order; null where nothing good enough came back. */
  async find(tracks: readonly ListedTrack[]): Promise<(ImportFound | null)[]> {
    return pool(tracks, CONCURRENCY, track => this.#one(track))
  }

  /**
   * How to tell whether one of these answers is by the artist one of these
   * songs names (`ByArtist`), with everything that can say so.
   *
   * Names are tried first, and they are free. YouTube Music is asked who an
   * artist is only for a song they leave unsettled: one with a good answer
   * under a name unlike the artist's. 陈奕迅's songs are credited to "Eason
   * Chan" there, which no comparison of the two names can see; its artist
   * search, asked for 陈奕迅 in Chinese, lists 陳奕迅 with the channel those
   * songs are credited to. A cover's singer has another channel.
   */
  async byArtist(
    sources: readonly ListedTrack[],
    answers: readonly CreditedSong[],
  ): Promise<ByArtist> {
    const named: ByArtist = (source, answer) =>
      namedAlike(
        source,
        answer,
        splitArtists(source.artist).flatMap(name => this.#otherNames(name)),
      )
    const tracks = answers.map(answer => answer.track)
    const unsettled = sources.filter(source => {
      const best = bestMatch(source, tracks, named)
      return best !== null && !best.sure && best.confidence >= SURE
    })
    if (unsettled.length === 0) return named

    // Each artist once, however many of the songs are theirs.
    const artists = new Map(
      unsettled.flatMap(source => splitArtists(source.artist)).map(name => [compact(name), name]),
    )
    const channels = new Map<string, ReadonlySet<string>>()
    await Promise.all(
      [...artists].map(async ([key, name]) => channels.set(key, await this.#channelsOf(name))),
    )
    const creditedTo = new Map(answers.map(answer => [answer.track, answer.channels]))
    return (source, answer) =>
      named(source, answer) ||
      splitArtists(source.artist).some(name => {
        const theirs = channels.get(compact(name))
        return theirs !== undefined && (creditedTo.get(answer) ?? []).some(id => theirs.has(id))
      })
  }

  /** An artist's channels on YouTube Music: those its artist search lists under this very name. */
  #channelsOf(name: string): Promise<ReadonlySet<string>> {
    const key = compact(name)
    const known = this.#channels.get(key)
    if (known) return known
    const asked = this.#ask(name).then(channels => {
      // No answer is not "no such artist": asked again next time.
      if (channels === null) this.#channels.delete(key)
      return channels ?? new Set<string>()
    })
    if (this.#channels.size >= ARTISTS_REMEMBERED) this.#channels.clear()
    this.#channels.set(key, asked)
    return asked
  }

  /** `#channelsOf`, asked of YouTube Music; null when it did not answer. */
  async #ask(name: string): Promise<ReadonlySet<string> | null> {
    for (const language of languagesOf(name)) {
      const listed = await this.#lists.artists(name, language)
      if (listed === null) return null
      const theirs = listed.filter(artist => listedAs(artist.name, name))
      if (theirs.length > 0) return new Set(theirs.map(artist => artist.channel))
    }
    return new Set()
  }

  async #one(source: ListedTrack): Promise<ImportFound | null> {
    const answers = await this.#lists.songsBy(searchQuery(source))
    if (!answers) {
      this.#logger.debug('YouTube Music did not answer', { title: source.title })
      return null
    }
    const tracks = answers.map(answer => answer.track)
    const written = await this.byArtist([source], answers)
    let best = bestReading(source, tracks, written)
    // Read the other way round its title is an artist to ask about too: only once the song as written is not settled.
    if (best && !best.sure && source.artist.trim()) {
      const turned = await this.byArtist([swapped(source)], answers)
      best = bestReading(source, tracks, (song, answer) =>
        song === source ? written(song, answer) : turned(song, answer),
      )
    }
    if (!best) return null
    return { ...best.track, sure: best.sure, reversed: best.reversed }
  }
}
