/**
 * Titles as other places write them, made into a song's title.
 *
 * Two jobs share the same noise. Migrate compares a song name from Spotify with
 * a YouTube upload's title, so it strips everything that is not the name —
 * credits and remaster notes included. Importing keeps a video's title as the
 * song's, so it strips only what the video added: "Official Music Video", 【MV】,
 * and the artist written in front.
 */

/** Bracketed noise that download sites and exports add to a title. */
const NOISE_IN_BRACKETS =
  /\s*[([{][^)\]}]*\b(?:official|video|audio|lyric|lyrics|hd|hq|4k|mv|m\/v|visuali[sz]er|remaster|remastered|explicit|clean|radio edit|single version|album version|bonus track|from|soundtrack|ost)\b[^)\]}]*[)\]}]/gi

/** A trailing "- Remastered 2011" / "- Radio Edit" suffix, as Spotify writes it. */
const NOISE_AFTER_DASH =
  /\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?(?:\s+\d{4})?|radio edit|single version|album version|mono|stereo)(?:\s+version)?\s*$/i

/** "feat. X", "ft. X", "featuring X" — with or without brackets. */
const FEATURING = /\s+[([]?(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]?\s*$/i
const FEATURING_INLINE = /\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]/gi

/** A song's name alone, for comparing one source's title with another's. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(NOISE_IN_BRACKETS, '')
    .replace(FEATURING_INLINE, '')
    .replace(FEATURING, '')
    .replace(NOISE_AFTER_DASH, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** An artist without the "- Topic" YouTube gives its auto-generated channels. */
export function cleanArtist(raw: string): string {
  return raw
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// --- a video's title --------------------------------------------------------

/**
 * The words a video adds about itself. A bracket holding nothing else goes; a
 * bracket with anything more — "(Live)", "(Acoustic)", "(From Frozen)" — is
 * part of what the song is, and stays.
 */
const VIDEO_WORDS = new Set([
  'official',
  'music',
  'video',
  'audio',
  'lyric',
  'lyrics',
  'mv',
  'm/v',
  'pv',
  'visualizer',
  'visualiser',
  'hd',
  'hq',
  '4k',
  'youtube',
  '公式',
  '歌詞',
  '歌詞付き',
  'ミュージックビデオ',
])

/** Of those, the ones that say "this is a video" even standing alone at the end. */
const VIDEO_MARKERS = new Set([
  'official',
  'mv',
  'm/v',
  'pv',
  'lyric',
  'lyrics',
  'visualizer',
  'visualiser',
  '公式',
])

const BRACKETS = /\s*[([{【［（｛]([^)\]}】］）｝]*)[)\]}】］）｝]\s*/g
const JAPANESE_QUOTE = /^(.*?)\s*[「『]([^」』]+)[」』](.*)$/
const DASH = /\s+[-–—]\s+/
const BAR = /\s+[|｜]\s+/

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,&+・]+/)
    .filter(Boolean)
}

function allVideoWords(text: string): boolean {
  const list = words(text)
  return list.length > 0 && list.every(word => VIDEO_WORDS.has(word))
}

/** "YOASOBI「アイドル」 Official Music Video" without its last three words. */
function withoutTrailingVideoWords(text: string): string {
  const list = text.trim().split(/\s+/)
  let cut = list.length
  while (cut > 0 && VIDEO_WORDS.has((list[cut - 1] ?? '').toLowerCase())) cut--
  const tail = list.slice(cut).map(word => word.toLowerCase())
  const saysVideo =
    tail.some(word => VIDEO_MARKERS.has(word)) || (tail.includes('music') && tail.includes('video'))
  return saysVideo && cut > 0 ? list.slice(0, cut).join(' ') : text.trim()
}

/** Letters and digits only, lower-cased: how two spellings of a name are compared. */
function bare(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Whether a piece of a title is the channel's name: "YOASOBI" on "Ayase /
 * YOASOBI", "Adele" on "AdeleVEVO", "Official髭男dism" on itself.
 */
function namesChannel(piece: string, channel: string): boolean {
  const a = bare(piece)
  const b = bare(channel.replace(/vevo$/i, ''))
  if (a.length < 2 || b.length < 2) return false
  return a === b || b.includes(a) || a.includes(b)
}

interface TidiedTitle {
  readonly title: string
  /** The artist the title names, when it names one; otherwise keep the channel's. */
  readonly artist: string | null
}

/**
 * A YouTube video's title as a song title: the song's name, and the artist when
 * the title writes it in front.
 *
 * - `YOASOBI「アイドル」Official Music Video` → アイドル, by YOASOBI
 * - `Adele - Hello (Official Music Video)` on AdeleVEVO → Hello, by Adele
 * - `Blinding Lights | Official Video` → Blinding Lights
 *
 * A dash is only read as "artist - title" when one side is the channel's name:
 * a title like `Kenshi Yonezu - Lemon` on 米津玄師's channel is left as it is
 * rather than guessed at. Only for a video's own title — YouTube Music's track
 * names are already clean.
 */
export function tidyVideoTitle(raw: string, channel: string): TidiedTitle {
  const original = raw.replace(/\s+/g, ' ').trim()
  let text = original.replace(BRACKETS, (whole, inside: string) =>
    allVideoWords(inside) ? ' ' : whole,
  )
  text = text.replace(/\s+/g, ' ').trim()

  // "Title | Official Video", "Title | Artist"
  const bar = text.split(BAR)
  if (bar.length >= 2) {
    const kept = bar.filter(
      (part, index) => index === 0 || !(allVideoWords(part) || namesChannel(part, channel)),
    )
    text = kept.join(' | ')
  }

  let artist: string | null = null
  const quoted = JAPANESE_QUOTE.exec(text)
  if (quoted?.[2]?.trim()) {
    const before = (quoted[1] ?? '').trim()
    artist = before && !allVideoWords(before) ? before : null
    text = quoted[2].trim()
  } else {
    const parts = text.split(DASH)
    if (parts.length >= 2) {
      const left = (parts[0] ?? '').trim()
      const right = parts.slice(1).join(' - ').trim()
      if (namesChannel(left, channel)) {
        artist = left
        text = right
      } else if (parts.length === 2 && namesChannel(right, channel)) {
        artist = right
        text = left
      }
    }
  }

  const title = withoutTrailingVideoWords(text)
  return title ? { title, artist } : { title: original, artist: null }
}
