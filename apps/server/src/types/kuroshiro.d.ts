/**
 * Minimal typings for kuroshiro, which ships none. Only the surface this
 * server uses is declared; both packages are CommonJS with a `default` export.
 */

declare module 'kuroshiro' {
  export interface KuroshiroConvertOptions {
    to?: 'hiragana' | 'katakana' | 'romaji'
    mode?: 'normal' | 'spaced' | 'okurigana' | 'furigana'
    romajiSystem?: 'nippon' | 'passport' | 'hepburn'
    delimiter_start?: string
    delimiter_end?: string
  }

  export interface KuroshiroAnalyzer {
    init(): Promise<void>
    parse(text: string): Promise<unknown[]>
  }

  export interface Kuroshiro {
    init(analyzer: KuroshiroAnalyzer): Promise<void>
    convert(text: string, options?: KuroshiroConvertOptions): Promise<string>
  }

  // Babel-compiled CJS: `module.exports = { default: Kuroshiro }`.
  const exported: { default: new () => Kuroshiro }
  export default exported
}

declare module 'kuroshiro-analyzer-kuromoji' {
  import type { KuroshiroAnalyzer } from 'kuroshiro'

  // Unlike kuroshiro itself, this one is `module.exports = Analyzer` directly.
  const exported: new (options?: { dictPath?: string }) => KuroshiroAnalyzer
  export default exported
}
