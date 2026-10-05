import { pinyin } from 'pinyin-pro'
import { cleanTitle, editDistance, type ImportFound } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { ListedTrack } from './trackLists.js'
import type { ProbedTrack, SearchHit } from './ytdlp.js'
import type { YouTubeMusicLists } from './youtubeMusicLists.js'

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
 * The scoring is pure, so the weighting can be tuned against a table of real
 * cases.
 */

/** At or above this a match is taken without a second thought. */
const SURE = 0.7
/** Below this the best answer is not the song at all. */
const FOUND = 0.4
/** What being YouTube Music's first answer adds; see `bestMatch`. */
const FIRST = 0.08
/** Songs looked up at once. */
const CONCURRENCY = 4

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

/** 0–1 similarity: the better of edit similarity and token overlap. */
export function similarity(a: string, b: string): number {
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
 * `similarity(a, b) >= threshold`, the same answer, cheaply.
 *
 * The full edit distance is most of `similarity`'s cost, and a duplicate check
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

/** The word half of `similarity`. */
function overlap(wordsA: ReadonlySet<string>, wordsB: ReadonlySet<string>): number {
  let shared = 0
  for (const word of wordsA) if (wordsB.has(word)) shared++
  // Containment rather than Jaccard: "get lucky" inside "daft punk get lucky
  // official audio" is a match, and the extra words are handled elsewhere.
  const containment = shared / Math.min(wordsA.size, wordsB.size)
  const jaccard = shared / (wordsA.size + wordsB.size - shared)
  return containment * 0.85 + jaccard * 0.15
}

/** Words that mean "this is not the studio recording". */
const PENALTIES: readonly { pattern: RegExp; weight: number }[] = [
  { pattern: /\blive\b/i, weight: 0.3 },
  { pattern: /\bcover\b/i, weight: 0.35 },
  { pattern: /\bremix\b/i, weight: 0.3 },
  { pattern: /\breaction\b/i, weight: 0.6 },
  { pattern: /\breacts?\b/i, weight: 0.6 },
  { pattern: /\b8d\b/i, weight: 0.55 },
  { pattern: /\bsped ?up\b/i, weight: 0.55 },
  { pattern: /\bslowed\b/i, weight: 0.55 },
  { pattern: /\bnightcore\b/i, weight: 0.55 },
  { pattern: /\bkaraoke\b/i, weight: 0.4 },
  { pattern: /\binstrumental\b/i, weight: 0.35 },
  { pattern: /\bacoustic\b/i, weight: 0.2 },
  { pattern: /\btutorial\b/i, weight: 0.5 },
  { pattern: /\bmashup\b/i, weight: 0.35 },
  { pattern: /\b(?:1|2|3|5|10) hours?\b/i, weight: 0.5 },
  { pattern: /\bloop\b/i, weight: 0.3 },
  { pattern: /\bextended\b/i, weight: 0.15 },
  { pattern: /\btrailer\b/i, weight: 0.4 },
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

/**
 * Score one result. The video title is split on its dashes so "Daft Punk -
 * Get Lucky" is compared part by part against the artist and the title, and
 * the artist is also looked for in the channel name.
 */
export function scoreHit(source: ListedTrack, hit: SearchHit): number {
  const sourceTitle = cleanTitle(source.title)
  const sourceArtist = source.artist
  const videoTitle = cleanTitle(hit.title)
  const channel = hit.channel.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '')
  const parts = videoTitle.split(/\s+[-–—|:]\s+|\s*[–—]\s*|\s+"|"\s*/).filter(part => part.trim())

  let title = similarity(sourceTitle, videoTitle)
  for (const part of parts) title = Math.max(title, similarity(sourceTitle, part))

  let artist: number
  if (!sourceArtist.trim()) {
    artist = 0.6
  } else {
    artist = similarity(sourceArtist, channel)
    for (const part of parts) artist = Math.max(artist, similarity(sourceArtist, part))
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
  for (const penalty of PENALTIES) {
    if (penalty.pattern.test(hit.title) && !penalty.pattern.test(sourceText))
      score -= penalty.weight
  }

  // A result twice as long as the song is a compilation whatever the title says.
  if (source.duration > 0 && hit.duration > source.duration * 2 + 30) score -= 0.3

  return Math.min(1, Math.max(0, score))
}

/** The best of YouTube Music's answers for a song, with how well it matched; null for none worth having. */
export function bestMatch(
  source: ListedTrack,
  results: readonly ProbedTrack[],
): { track: ProbedTrack; confidence: number } | null {
  let best: { track: ProbedTrack; confidence: number } | null = null
  for (const [rank, track] of results.entries()) {
    const score = scoreHit(source, {
      url: track.url,
      title: track.title,
      channel: track.artist,
      duration: track.duration,
      thumbnail: track.thumbnail,
    })
    /*
     * YouTube Music's own first answer gets a little more trust: it knows an
     * artist by every name they go by. 陈奕迅 is "Eason Chan" in its answers,
     * which no comparison of the two names can see, and its first answer for
     * "陈奕迅 孤勇者" is his.
     */
    const confidence = Math.round(Math.min(1, score + (rank === 0 ? FIRST : 0)) * 100) / 100
    if (!best || confidence > best.confidence) best = { track, confidence }
  }
  return best && best.confidence >= FOUND ? best : null
}

/** The query sent to YouTube. Artist first: it narrows results better. */
export function searchQuery(source: ListedTrack): string {
  return [source.artist, cleanTitle(source.title)]
    .filter(part => part.trim())
    .join(' ')
    .trim()
}

export class YouTubeMatcher {
  readonly #lists: Pick<YouTubeMusicLists, 'songs'>
  readonly #logger: Logger

  constructor(deps: { lists: Pick<YouTubeMusicLists, 'songs'>; logger: Logger }) {
    this.#lists = deps.lists
    this.#logger = deps.logger.child('youtube-match')
  }

  /** Each song found on YouTube Music, in order; null where nothing good enough came back. */
  async find(tracks: readonly ListedTrack[]): Promise<(ImportFound | null)[]> {
    const found: (ImportFound | null)[] = tracks.map(() => null)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < tracks.length) {
        const index = next++
        found[index] = await this.#one(tracks[index] as ListedTrack)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tracks.length) }, worker))
    return found
  }

  async #one(source: ListedTrack): Promise<ImportFound | null> {
    const results = await this.#lists.songs(searchQuery(source))
    if (!results) {
      this.#logger.debug('YouTube Music did not answer', { title: source.title })
      return null
    }
    const best = bestMatch(source, results)
    if (!best) return null
    return { ...best.track, sure: best.confidence >= SURE }
  }
}
