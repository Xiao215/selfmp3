import { z } from 'zod'
import { IdSchema } from './common.js'

/**
 * Lyrics+ — romanization, translation and lyric search.
 *
 * Every derived form of a song's lyrics is returned as lines aligned 1:1 with
 * the original: same order, same count, same timestamps. The client never has
 * to re-match anything, it just renders line N under line N.
 */

/** A lyric line with its timestamp, or null when the lyrics are unsynced. */
export const LyricLineSchema = z.object({
  time: z.number().nullable(),
  text: z.string(),
})
export type LyricLine = z.infer<typeof LyricLineSchema>

export const RomanizedLineSchema = LyricLineSchema.extend({
  /** Empty when the line needed no romanization (already Latin, or blank). */
  romanized: z.string(),
})
export type RomanizedLine = z.infer<typeof RomanizedLineSchema>

/** What the song was detected as, which decides the romanization engine. */
export const LyricsLanguageSchema = z.enum(['zh', 'ja', 'none'])
export type LyricsLanguage = z.infer<typeof LyricsLanguageSchema>

export const RomanizedLyricsSchema = z.object({
  language: LyricsLanguageSchema,
  synced: z.boolean(),
  lines: z.array(RomanizedLineSchema),
})
export type RomanizedLyrics = z.infer<typeof RomanizedLyricsSchema>

export const TranslationProviderSchema = z.enum(['none', 'anthropic', 'openai'])
export type TranslationProvider = z.infer<typeof TranslationProviderSchema>

/** BCP-47-ish, free text on purpose: 'en', 'zh', 'ja', 'pt-BR' all work. */
export const TranslationLangSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[a-zA-Z][a-zA-Z-]*$/, 'language must look like "en" or "zh-TW"')

export const TranslatedLineSchema = LyricLineSchema.extend({
  translation: z.string(),
})
export type TranslatedLine = z.infer<typeof TranslatedLineSchema>

export const TranslatedLyricsSchema = z.object({
  lang: z.string(),
  provider: TranslationProviderSchema,
  synced: z.boolean(),
  lines: z.array(TranslatedLineSchema),
})
export type TranslatedLyrics = z.infer<typeof TranslatedLyricsSchema>

/** One hit from lyric search: the song plus the matching line, pre-split for highlighting. */
export const LyricsSearchHitSchema = z.object({
  songId: IdSchema,
  title: z.string(),
  artist: z.string(),
  hasArt: z.boolean(),
  line: z.string(),
  /** `before + match + after === line`; `match` is what to highlight. */
  before: z.string(),
  match: z.string(),
  after: z.string(),
})
export type LyricsSearchHit = z.infer<typeof LyricsSearchHitSchema>

export const LyricsSearchResponseSchema = z.object({
  hits: z.array(LyricsSearchHitSchema),
})
export type LyricsSearchResponse = z.infer<typeof LyricsSearchResponseSchema>

/** Providers that need an API key. Keys are write-only from the client's point of view. */
export const SecretProviderSchema = z.enum(['anthropic', 'openai'])
export type SecretProvider = z.infer<typeof SecretProviderSchema>

export const SecretsStatusSchema = z.object({
  anthropic: z.object({ hasKey: z.boolean() }),
  openai: z.object({ hasKey: z.boolean() }),
})
export type SecretsStatus = z.infer<typeof SecretsStatusSchema>

export const SetSecretSchema = z.object({
  provider: SecretProviderSchema,
  /** Null (or empty) clears the key. */
  key: z.string().trim().max(512).nullable(),
})
export type SetSecret = z.infer<typeof SetSecretSchema>

export const SaveLyricsSchema = z.object({
  text: z.string().max(100_000),
})
export type SaveLyrics = z.infer<typeof SaveLyricsSchema>
