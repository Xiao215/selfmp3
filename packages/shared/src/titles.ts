/**
 * Titles as other places write them, made into a song's title.
 *
 * Two jobs share the same noise. Finding a song on YouTube by its name compares
 * a Spotify or 网易云 song name with a YouTube one, so it strips everything that is not the name —
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

/**
 * An artist without the channel suffixes YouTube leaves on a name: "- Topic"
 * on an auto-generated channel, "VEVO" on a label's.
 */
export function cleanArtist(raw: string): string {
  return raw
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
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
/*
 * "Title | Artist", and its fullwidth twin.
 *
 * The ASCII bar needs a space either side: `AC|DC` is a band, not two pieces.
 * The fullwidth one does not, because in Japanese and Chinese titles it is
 * written tight — "…Tides｜Genshin Impact" — and requiring spaces meant the
 * channel name stayed glued to the title on exactly the titles this library is
 * full of.
 */
const BAR = /\s*｜\s*|\s+\|\s+/

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
 * Whether a piece of a title is just the artist's name, as the channel gives it.
 *
 * The channel may say more than the piece does — "Ayase / YOASOBI" for a title
 * that says "YOASOBI" — so a piece contained in the channel counts.
 *
 * The other way round does not, and used to. A piece that merely *contains* the
 * channel's name was read as being it, so "Jade Moon Upon a Sea of Clouds -
 * Disc 1: Glazed Moon Over the Tides｜Genshin Impact" made the entire disc name
 * the artist and threw the real title away — three discs arriving as three
 * songs called the same thing. A sentence with the artist's name somewhere in
 * it is not the artist's name.
 */
function namesChannel(piece: string, channel: string): boolean {
  const a = bare(piece)
  const b = bare(channel.replace(/vevo$/i, ''))
  if (a.length < 2 || b.length < 2) return false
  return a === b || b.includes(a)
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
  const parts = text.split(BAR)
  if (parts.length >= 2) {
    const kept = parts.filter(
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

// --- names as the library keeps them ----------------------------------------

/** Chinese, Japanese or Korean letters. */
export const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** A credit as the names it lists, split only where a list is: "A, B", "A、B". */
export function creditList(credit: string): string[] {
  return credit
    .split(/\s*[,，、]\s*/)
    .map(name => name.trim())
    .filter(Boolean)
}

/** "薛之谦, 薛之谦, 薛之谦" → "薛之谦": each name once, the first spelling kept. */
export function withoutRepeats(credit: string): string {
  const names: string[] = []
  for (const name of creditList(credit)) {
    if (!names.some(other => other.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  return names.length === creditList(credit).length ? credit : names.join(', ')
}

/**
 * "オリオン - Orion" → "オリオン": a name in Chinese, Japanese or Korean, then
 * its English after a dash. Only that shape: "Love - Live" and "夜 - 朝" stay.
 */
export function withoutTranslation(title: string): string {
  // A featured artist after the translation is part of the name: kept.
  const featuring = /\s*[(（](?:feat\.?|ft\.?|with)\s[^)）]*[)）]$/iu.exec(title)
  const named = featuring ? title.slice(0, featuring.index) : title
  const match = /^(.+?)\s+[-–—]\s+(.+)$/u.exec(named)
  if (!match) return title
  const [, original, after] = match
  if (!CJK.test(original!) || CJK.test(after!) || !/[a-z]/i.test(after!)) return title
  return `${original!.trim()}${featuring ? ` ${featuring[0].trim()}` : ''}`
}

/** What a song was used for, as Chinese and Japanese uploads write it after the name. */
const USE_WORDS =
  /主题曲|主題曲|插曲|片头曲|片尾曲|推广曲|宣传曲|印象曲|角色曲|概念曲|原声|配乐|主題歌|挿入歌|エンディング|オープニング|イメージソング|\b(?:OST|theme song|opening|ending|insert song)\b/iu

/** Where it was used: a work in quotes, or the kind of work. */
const USE_PLACE =
  /《[^》]+》|「[^」]+」|『[^』]+』|电视剧|電視劇|电影|電影|网游|手游|游戏|遊戲|动画|動畫|アニメ|ドラマ|映画|ゲーム/u

/** A bracketed note at the very end of a title, and what it holds. */
const LAST_NOTE = /\s*[(（【[]([^)）】\]]*)[)）】\]]\s*$/u

/**
 * "有点甜 (《萌三国》网游主题曲|《微微一笑很倾城》电视剧插曲)" → "有点甜": a note
 * after the name saying where the song was used — a theme for this game, an
 * insert song in that drama. Only a note that names both the use and the work,
 * or the kind of work: "(Live)", "(Acoustic)" and "(From Frozen)" are what the
 * song is, and stay.
 */
export function withoutUseNote(title: string): string {
  const match = LAST_NOTE.exec(title)
  if (!match || match.index === 0) return title
  const note = match[1] ?? ''
  if (!USE_WORDS.test(note) || !USE_PLACE.test(note)) return title
  return title.slice(0, match.index).trim() || title
}
