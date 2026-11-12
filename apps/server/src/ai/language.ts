import { eld } from 'eld/medium'

/**
 * Which language Ask writes back in (docs/features/ai.md, "Reply language"),
 * decided here before the model is called, and named to it after the request,
 * where it reads it last. Left to the model, a request in English behind tens
 * of thousands of tokens of Chinese and Japanese names came back in French one
 * time in four (2026-11-11).
 *
 * Writing systems first: Korean, Chinese and Japanese are told apart by
 * their characters (any kana is Japanese, unless the words have characters
 * only Chinese writes). Words in Latin letters go to a language identifier
 * (`eld`, n-grams over 60 languages), once there are enough of them to
 * tell (`LATIN_SENTENCE`). A library's names say nothing of the language around them
 * ("play 群青 by YOASOBI" is English), so they are taken out first
 * (`withoutNames`).
 */

const HAN = /\p{Script=Han}/gu
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu
const HANGUL = /\p{Script=Hangul}/gu
const LATIN_WORD = /\p{Script=Latin}+/gu
/**
 * Characters a Chinese sentence nearly always has and Japanese writes
 * otherwise, in simplified and traditional, so Chinese around a Japanese name
 * written in kana is still Chinese.
 */
const CHINESE_ONLY = /[的了吗嗎呢吧这這们們么麼让讓听聽没沒说說哪啥]/u
/**
 * The fewest words in Latin letters whose language is told: below it the
 * identifier is too often sure and wrong ("shuffle my queue" is French, "calm
 * piano" Italian), and the request's language comes from elsewhere.
 */
const LATIN_SENTENCE = 4
/** The shortest names taken out: shorter ones are words as often as names. */
const SHORTEST_LATIN_NAME = 4
const SHORTEST_OTHER_NAME = 2

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0

/** The language of words in Latin letters, when the identifier is sure. */
function latinLanguage(text: string): string | null {
  const found = eld.detect(text)
  return found.language && found.isReliable() ? found.language : null
}

/**
 * The language a text is written in, as an ISO 639-1 code, or null when it
 * cannot be told: too short, only names, or nothing but numbers.
 */
export function languageOf(text: string): string | null {
  const latin = text.match(LATIN_WORD) ?? []
  const han = count(text, HAN)
  const kana = count(text, KANA)
  const hangul = count(text, HANGUL)
  const byLatin = latin.length >= LATIN_SENTENCE ? latinLanguage(latin.join(' ')) : null
  if (han + kana + hangul === 0 || byLatin) return byLatin
  if (hangul > han + kana) return 'ko'
  if (han > 0 && CHINESE_ONLY.test(text)) return 'zh'
  if (kana > 0) return 'ja'
  return han > 0 ? 'zh' : 'ko'
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LATIN_EDGE = /\p{Script=Latin}/u

/**
 * The text with the names it holds taken out, longest first, so their
 * language does not count as the words'. A name in Latin letters is taken
 * only as whole words ("Rain" is not taken out of "rainy").
 */
export function withoutNames(text: string, names: Iterable<string>): string {
  const lower = text.toLowerCase()
  const held = [
    ...new Set(
      [...names]
        .map(name => name.trim())
        .filter(name => {
          const latin = LATIN_EDGE.test(name[0] ?? '') || LATIN_EDGE.test(name.at(-1) ?? '')
          return name.length >= (latin ? SHORTEST_LATIN_NAME : SHORTEST_OTHER_NAME)
        })
        .filter(name => lower.includes(name.toLowerCase())),
    ),
  ].sort((a, b) => b.length - a.length)
  let out = text
  for (const name of held) {
    const before = LATIN_EDGE.test(name[0]!) ? '(?<![\\p{L}\\p{N}])' : ''
    const after = LATIN_EDGE.test(name.at(-1)!) ? '(?![\\p{L}\\p{N}])' : ''
    out = out.replace(new RegExp(`${before}${escaped(name)}${after}`, 'giu'), ' ')
  }
  return out
}

const NAMES = new Intl.DisplayNames(['en'], { type: 'language' })

/** A language's name in English, for the model: "English", "Japanese". */
export function languageName(code: string): string {
  try {
    return NAMES.of(code) ?? code
  } catch {
    return code
  }
}

/** Whether a language is written in Chinese, Japanese or Korean characters. */
export function writtenInCJK(code: string): boolean {
  return code === 'zh' || code === 'ja' || code === 'ko'
}

/** The language of a device's locale ("zh-Hans-CN" is zh), when it sent one. */
export function localeLanguage(locale: string | null | undefined): string | null {
  const primary = locale?.split(/[-_]/)[0]?.toLowerCase()
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : null
}
