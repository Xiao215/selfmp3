import { z } from 'zod'
import { WrappedRangeSchema } from './wrapped.js'
import { IdSchema } from './common.js'

/**
 * Smart features (docs/features/ai.md): what a device asks the server and what
 * comes back.
 *
 * Songs travel as the server's ids, like the stats, and the device lines them
 * up with its own (`useServerSongIds`). Tags travel by name: a name is unique
 * in every library, case aside, so it means the same tag on both sides without
 * a translation of its own.
 */

/** A bound of a 0–1 or bpm range; either end may be open. */
export const RangeSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
})
export type Range = z.infer<typeof RangeSchema>

/**
 * What a description was understood as, in parts a person can see and take
 * away one at a time.
 *
 * Places widen and everything else narrows (the rule from combining tags):
 * a song is in if it carries any of `anyTags` or is by any of `artists` (or
 * there are neither), and then passes every other part that is set.
 */
export const UnderstandingSchema = z.object({
  /** A name for the playlist, from the words. */
  name: z.string().trim().min(1).max(60),
  anyTags: z.array(z.string()).max(12),
  artists: z.array(z.string()).max(12),
  noTags: z.array(z.string()).max(12),
  /** 0–1, from the audio analysis. A song not analysed yet does not pass a set range. */
  energy: RangeSchema,
  bpm: RangeSchema,
  /** With words, without (instrumental, or no lyrics found), or either. */
  words: z.enum(['with', 'without']).nullable(),
  loved: z.boolean().nullable(),
  /** Only songs played within this many days. */
  playedWithinDays: z.number().int().min(1).max(3650).nullable(),
  /** Leave out songs played within this many days; never played stays in. */
  notPlayedWithinDays: z.number().int().min(1).max(3650).nullable(),
  addedWithinDays: z.number().int().min(1).max(3650).nullable(),
  /** How many songs were asked for, when the words said. */
  size: z.number().int().min(1).max(200).nullable(),
  /**
   * What the words want that the parts above cannot say: "for reading", "sounds
   * like rain". Null when the parts say all of it.
   */
  brief: z.string().max(200).nullable(),
})
export type Understanding = z.infer<typeof UnderstandingSchema>

export const DescribeRequestSchema = z.object({
  text: z.string().trim().min(1).max(500),
  /**
   * Given when the parts were changed on the device: the words are not read
   * again, the songs are only picked again from what the parts now let in.
   */
  understanding: UnderstandingSchema.nullable().default(null),
  /**
   * Songs to pick around: an answer's Different songs (docs/features/lists.md)
   * sends the ones it showed. Where nothing else fits they may come back.
   */
  avoid: z.array(IdSchema).max(2000).default([]),
})
export type DescribeRequest = z.infer<typeof DescribeRequestSchema>

export const DescribePickSchema = z.object({
  songId: IdSchema,
  /** A few words on why it fits; null when every song that fit was taken. */
  why: z.string().nullable(),
})
export type DescribePick = z.infer<typeof DescribePickSchema>

export const DescribeResultSchema = z.object({
  understanding: UnderstandingSchema,
  /** How many songs the parts let in, before any picking. */
  fit: z.number().int().nonnegative(),
  /** Parts taken away because together they let nothing in, in plain words. */
  loosened: z.array(z.string()),
  /** Tags or artists the words named that this library does not have. */
  unknown: z.array(z.string()),
  picks: z.array(DescribePickSchema),
})
export type DescribeResult = z.infer<typeof DescribeResultSchema>

export const TagSuggestionSchema = z.object({
  /** An existing tag's name, or the name of a tag that would be made. */
  tag: z.string(),
  isNew: z.boolean(),
  songIds: z.array(IdSchema).min(1),
  /** Who the songs are by, shortest first: "周杰倫 76, 薛之谦 12, +8 more". */
  who: z.string(),
  why: z.string(),
  /** Read off the library's own tagging, or judged by the model. */
  from: z.enum(['library', 'model']),
})
export type TagSuggestion = z.infer<typeof TagSuggestionSchema>

export const TagSuggestionsSchema = z.object({
  /** Songs without a tag when this was worked out. */
  untagged: z.number().int().nonnegative(),
  suggestions: z.array(TagSuggestionSchema),
  /** Songs it would not guess for, and why. */
  unsure: z.array(z.object({ songIds: z.array(IdSchema), who: z.string(), why: z.string() })),
})
export type TagSuggestions = z.infer<typeof TagSuggestionsSchema>

/**
 * The Search box's Ask (docs/features/ai.md, "S1"): one request, routed to one
 * of a few things the app can already do, and answered as a proposal.
 */
export const AskRequestSchema = z.object({
  text: z.string().trim().min(1).max(500),
  /** The song playing on the asking device, by the server's id: what "this" means (A8). */
  playing: IdSchema.nullable().default(null),
  /** Names this request, so the device can ask how it is going (`AskProgress`). */
  ticket: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
})
export type AskRequest = z.infer<typeof AskRequestSchema>

/** How an Ask is going: its stages so far, the last one still running unless done. */
export const AskProgressSchema = z.object({
  steps: z.array(z.object({ text: z.string(), done: z.boolean() })),
})
export type AskProgress = z.infer<typeof AskProgressSchema>

/** The places an answer can send you to, when the answer is "that is over there". */
export const AskPlaceSchema = z.enum([
  'import',
  'stats',
  'tags',
  'library',
  'playlists',
  'settings',
])
export type AskPlace = z.infer<typeof AskPlaceSchema>

export const AskStatsRangeSchema = z.enum(['7d', '30d', '90d', '365d', 'all'])
export type AskStatsRange = z.infer<typeof AskStatsRangeSchema>

/** A song field Tidy up may change. */
export const TidyFieldSchema = z.enum(['title', 'artist', 'album', 'albumArtist'])
export type TidyField = z.infer<typeof TidyFieldSchema>

/**
 * A4 · Tidy up: one change to approve — a field, what it is, what it would
 * be, and every song (server ids) where it is exactly that. `by` says whether
 * a plain rule found it or the model did.
 */
export const TidyChangeSchema = z.object({
  key: z.string(),
  field: TidyFieldSchema,
  from: z.string(),
  to: z.string(),
  why: z.string(),
  by: z.enum(['rule', 'model']),
  songIds: z.array(IdSchema).min(1),
})
export type TidyChange = z.infer<typeof TidyChangeSchema>

export const TidyResultSchema = z.object({
  changes: z.array(TidyChangeSchema),
  /** How many songs were looked at. */
  looked: z.number().int().nonnegative(),
  /** Set when the model could not be asked: what is missing, in words. */
  note: z.string().nullable(),
})
export type TidyResult = z.infer<typeof TidyResultSchema>

export const AskAnswerSchema = z.discriminatedUnion('kind', [
  /** Songs to play now or keep: Describe's answer, and which of the two the words led with. */
  z.object({
    kind: z.literal('songs'),
    /** play: now; save: a playlist; next: after the song playing, in Up next (A8). */
    lead: z.enum(['play', 'save', 'next']),
    describe: DescribeResultSchema,
  }),
  /** A song you half remember: the few that fit what you said, each with why. */
  z.object({
    kind: z.literal('find'),
    terms: z.array(z.string()),
    picks: z.array(DescribePickSchema),
  }),
  /** One tag for many songs; `already` of them carry it now. */
  z.object({
    kind: z.literal('tag'),
    tag: z.string(),
    isNew: z.boolean(),
    understanding: UnderstandingSchema,
    songIds: z.array(IdSchema),
    already: z.number().int().nonnegative(),
  }),
  /** A question about your listening, answered from the plays, never written by the model. */
  z.object({
    kind: z.literal('stats'),
    range: AskStatsRangeSchema,
    about: z.enum(['songs', 'artists', 'tags', 'totals']),
    plays: z.number().int().nonnegative(),
    minutes: z.number().nonnegative(),
    items: z.array(
      z.object({
        label: z.string(),
        plays: z.number().int().nonnegative(),
        songId: IdSchema.nullable(),
      }),
    ),
  }),
  /** Song names worth fixing, as changes to approve. */
  z.object({ kind: z.literal('tidy'), tidy: TidyResultSchema }),
  z.object({ kind: z.literal('open'), place: AskPlaceSchema, say: z.string() }),
  /** Not something the box can do, and what to do instead. */
  z.object({ kind: z.literal('none'), say: z.string() }),
])
export type AskAnswer = z.infer<typeof AskAnswerSchema>

/**
 * Settings › Smart features: where the server asks a model, and with which.
 * `address` is the endpoint without its key or any credentials in it, and null
 * when smart features are off.
 */
export const AiSetupSchema = z.object({
  address: z.string().nullable(),
  models: z.object({ fast: z.string(), smart: z.string() }),
})
export type AiSetup = z.infer<typeof AiSetupSchema>

/** Why the model did not answer, as `LlmError` names it on the server. */
export const AiFailureSchema = z.enum(['off', 'unreachable', 'busy', 'refused', 'invalid'])
export type AiFailure = z.infer<typeof AiFailureSchema>

/**
 * One small call through the same door the features use, JSON schema and all:
 * how long it took, or why it failed in words and in the endpoint's own.
 */
export const AiCheckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), model: z.string(), ms: z.number().nonnegative() }),
  z.object({
    ok: z.literal(false),
    failure: AiFailureSchema,
    message: z.string(),
    detail: z.string(),
  }),
])
export type AiCheck = z.infer<typeof AiCheckSchema>

/**
 * A5 · the Report in a few sentences. Every number in them is one of the
 * report's; `dropped` counts the sentences left out for saying one that is not.
 */
export const WrittenReportSchema = z.object({
  range: WrappedRangeSchema,
  sentences: z.array(z.string()),
  dropped: z.number().int().nonnegative(),
})
export type WrittenReport = z.infer<typeof WrittenReportSchema>
