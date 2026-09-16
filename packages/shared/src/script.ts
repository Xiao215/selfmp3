import type { LyricsLanguage } from './schemas/lyrics.js'

/**
 * Script detection for lyrics, by Unicode range.
 *
 * Deliberately simple: no language model, no dictionaries. The only question
 * that matters is "which romanizer does this line go through?", and kana is
 * the one unambiguous signal — a line with kana is Japanese, and a song with
 * any kana at all is a Japanese song, kanji included. Han without any kana in
 * the whole song is Chinese.
 */

export type Script = 'han' | 'kana' | 'mixed' | 'latin' | 'none'

// CJK Unified Ideographs, the Extension A block, and the Compatibility block.
const HAN = /[㐀-䶿一-鿿豈-﫿]/
// Hiragana, katakana, and the half-width katakana block. The prolonged sound
// mark (ー) and iteration marks live inside these ranges.
const KANA = /[ぁ-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]/
const LATIN = /[A-Za-zÀ-ɏ]/

/** Dominant script of one line. `mixed` means Han and kana together (Japanese). */
export function detectScript(text: string): Script {
  const han = HAN.test(text)
  const kana = KANA.test(text)
  if (han && kana) return 'mixed'
  if (kana) return 'kana'
  if (han) return 'han'
  if (LATIN.test(text)) return 'latin'
  return 'none'
}

/**
 * Language of a whole song, from its lines.
 *
 * Any kana anywhere makes the song Japanese — a Japanese lyric sheet almost
 * always has at least one particle in kana, whereas a Chinese one never has
 * kana. Han with no kana is Chinese. Neither means there is nothing to do.
 */
export function detectLyricsLanguage(lines: readonly string[]): LyricsLanguage {
  let sawHan = false
  for (const line of lines) {
    if (KANA.test(line)) return 'ja'
    if (!sawHan && HAN.test(line)) sawHan = true
  }
  return sawHan ? 'zh' : 'none'
}

type RomanizerChoice = 'pinyin' | 'romaji' | 'none'

/**
 * Which engine each line goes through, given the song's language.
 *
 * Returns one entry per input line, in order, so the caller can zip the result
 * straight back onto the original lines. A Latin-only line in a Japanese song
 * (an English chorus, say) needs nothing and gets 'none'.
 */
export function planRomanization(
  lines: readonly string[],
  language: LyricsLanguage,
): RomanizerChoice[] {
  return lines.map(line => {
    const script = detectScript(line)
    if (script === 'latin' || script === 'none') return 'none'
    if (language === 'ja') return 'romaji'
    if (language === 'zh') return 'pinyin'
    return 'none'
  })
}

/** True when the query is short but CJK, where two characters is already a word. */
export function isCjkQuery(text: string): boolean {
  return HAN.test(text) || KANA.test(text)
}
