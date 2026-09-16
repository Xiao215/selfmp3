import {
  cleanTitle,
  editDistance,
  type MigrateCandidate,
  type MigrateSourceTrack,
} from '@selfmp3/shared'

/**
 * Deciding which YouTube result is the song.
 *
 * A search for "artist title" returns five videos and the first is wrong
 * often enough to matter: a live version, a fan cover, an 8D edit, a reaction.
 * So each result is scored on how well its title and channel match, how close
 * its length is, and whether it looks like an official upload — and the user
 * sees the number as a coloured badge rather than having to trust it blindly.
 *
 * Pure, so the weighting can be tuned against a table of real cases.
 */

/** What the searcher hands over for one result. */
export interface SearchHit {
  url: string
  title: string
  channel: string
  duration: number
  thumbnail: string | null
}

/** Lower-case, no accents, no punctuation, single spaces. */
export function normalizeForMatch(text: string): string {
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

  const tokensA = new Set(x.split(' '))
  const tokensB = new Set(y.split(' '))
  let shared = 0
  for (const token of tokensA) if (tokensB.has(token)) shared++
  // Containment rather than Jaccard: "get lucky" inside "daft punk get lucky
  // official audio" is a match, and the extra words are handled elsewhere.
  const containment = shared / Math.min(tokensA.size, tokensB.size)
  const jaccard = shared / (tokensA.size + tokensB.size - shared)

  return Math.max(edit, containment * 0.85 + jaccard * 0.15)
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
export function scoreHit(source: MigrateSourceTrack, hit: SearchHit): number {
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
  const text = title * (0.7 + 0.3 * artist)
  const duration = durationScore(source.duration, hit.duration)
  // No length to compare: neither reward nor punish, just lean on the text.
  let score = duration === null ? text : text * (0.75 + 0.25 * duration)

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

/** Rank the results and keep the best few for the user to choose from. */
export function rankCandidates(
  source: MigrateSourceTrack,
  hits: readonly SearchHit[],
  limit = 3,
): MigrateCandidate[] {
  return hits
    .map(hit => ({
      url: hit.url,
      title: hit.title,
      channel: hit.channel,
      duration: hit.duration,
      thumbnail: hit.thumbnail,
      confidence: Math.round(scoreHit(source, hit) * 100) / 100,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit)
}

/** The query sent to YouTube. Artist first: it narrows results better. */
export function searchQuery(source: MigrateSourceTrack): string {
  return [source.artist, cleanTitle(source.title)]
    .filter(part => part.trim())
    .join(' ')
    .trim()
}

/** Is a song close enough to one already in the library to skip it? */
export function isAlreadyInLibrary(
  source: MigrateSourceTrack,
  songs: readonly { title: string; artist: string }[],
): boolean {
  const title = cleanTitle(source.title)
  for (const song of songs) {
    if (similarity(title, cleanTitle(song.title)) < 0.9) continue
    if (!source.artist.trim() || !song.artist.trim()) return true
    if (similarity(source.artist, song.artist) >= 0.75) return true
  }
  return false
}
