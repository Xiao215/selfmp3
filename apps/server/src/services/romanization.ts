import {
  detectLyricsLanguage,
  parseLyrics,
  planRomanization,
  type LyricLine,
  type RomanizedLyrics,
} from '@selfmp3/shared'
import type { Logger } from '../logger.js'

/**
 * Romanization, fully offline.
 *
 * Chinese goes through pinyin-pro (tone marks, pure JS). Japanese goes through
 * kuroshiro with the kuromoji analyzer, whose dictionary takes a second or two
 * to load — so it is loaded on first use and then kept for the life of the
 * process. Script detection lives in `@selfmp3/shared` and is tested there;
 * this service only wires the engines and keeps the lines aligned.
 */

export interface Romanizers {
  readonly pinyin: (text: string) => string
  readonly romaji: (text: string) => Promise<string>
}

/** Turn a lyrics file into aligned lines, whether it is synced or plain. */
export function toLyricLines(text: string): { synced: boolean; lines: LyricLine[] } {
  const parsed = parseLyrics(text)
  if (parsed.synced) {
    return { synced: true, lines: parsed.lines.map(line => ({ time: line.time, text: line.text })) }
  }
  return { synced: false, lines: parsed.lines.map(line => ({ time: null, text: line })) }
}

export class RomanizationService {
  readonly #logger: Logger
  readonly #romanizers: Romanizers | null
  #pinyin: ((text: string) => string) | null = null
  #kuroshiro: Promise<(text: string) => Promise<string>> | null = null

  constructor(logger: Logger, romanizers?: Romanizers) {
    this.#logger = logger.child('romanize')
    this.#romanizers = romanizers ?? null
  }

  async #loadPinyin(): Promise<(text: string) => string> {
    if (this.#romanizers) return this.#romanizers.pinyin
    if (!this.#pinyin) {
      const { pinyin } = await import('pinyin-pro')
      // `nonZh: 'consecutive'` passes Latin words through untouched; the
      // whitespace collapse tidies the double spaces it leaves around them.
      this.#pinyin = text =>
        pinyin(text, { toneType: 'symbol', nonZh: 'consecutive' })
          .replace(/\s+/g, ' ')
          .trim()
    }
    return this.#pinyin
  }

  /** Loaded once, shared by every caller — including concurrent ones. */
  #loadKuroshiro(): Promise<(text: string) => Promise<string>> {
    if (this.#romanizers) return Promise.resolve(this.#romanizers.romaji)
    if (!this.#kuroshiro) {
      const startedAt = Date.now()
      this.#kuroshiro = (async () => {
        const [{ default: Kuroshiro }, { default: Analyzer }] = await Promise.all([
          import('kuroshiro'),
          import('kuroshiro-analyzer-kuromoji'),
        ])
        const kuroshiro = new Kuroshiro.default()
        await kuroshiro.init(new Analyzer())
        this.#logger.info('japanese dictionary loaded', { ms: Date.now() - startedAt })
        return (text: string) =>
          kuroshiro.convert(text, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })
      })()
      // A failed load must not poison every later request.
      this.#kuroshiro.catch(() => {
        this.#kuroshiro = null
      })
    }
    return this.#kuroshiro
  }

  /** Start loading the Japanese dictionary now so the first lookup is instant. */
  warmUp(): void {
    void this.#loadKuroshiro().catch((error: unknown) => {
      this.#logger.warn('could not preload japanese dictionary', {
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }

  /**
   * Romanize a whole lyrics text. Output lines are 1:1 with the input lines:
   * same order, same timestamps; lines that need nothing get an empty string.
   */
  async romanize(text: string): Promise<RomanizedLyrics> {
    const { synced, lines } = toLyricLines(text)
    const texts = lines.map(line => line.text)
    const language = detectLyricsLanguage(texts)
    const plan = planRomanization(texts, language)

    const pinyin = plan.includes('pinyin') ? await this.#loadPinyin() : null
    // A dictionary that fails to load degrades to "no romaji" rather than an
    // error: the lyrics themselves are still worth showing.
    const romaji = plan.includes('romaji')
      ? await this.#loadKuroshiro().catch((error: unknown) => {
          this.#logger.warn('japanese romanization unavailable', {
            message: error instanceof Error ? error.message : String(error),
          })
          return null
        })
      : null

    const romanized = await Promise.all(
      lines.map(async (line, index) => {
        const choice = plan[index]
        let out = ''
        if (choice === 'pinyin' && pinyin) out = pinyin(line.text)
        else if (choice === 'romaji' && romaji) out = (await romaji(line.text)).trim()
        return { time: line.time, text: line.text, romanized: out }
      }),
    )

    return { language, synced, lines: romanized }
  }
}
