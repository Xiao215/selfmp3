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

/** A bound of a 0–1, bpm or year range; either end may be open. */
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
  /**
   * The years the songs came out, as YouTube Music gives a release's year. A
   * song with no year does not pass a set range. Defaults open, so the parts
   * an older app sends back still read.
   */
  year: RangeSchema.default({ min: null, max: null }),
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
   * How long it should play, in minutes, when the words said ("2 hours" is
   * 120). The songs are counted by their own lengths, not an average song's.
   */
  minutes: z.number().int().min(1).max(1440).nullable().default(null),
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

/**
 * An answer changed after it was given: "10 首", "不要动漫的" (docs/features/ai.md,
 * "Change it"). The filters as they stand and the songs shown come along, so
 * what the change does not touch stays.
 */
export const RefineRequestSchema = z.object({
  /** What was first asked. */
  text: z.string().trim().min(1).max(500),
  understanding: UnderstandingSchema,
  /** What to change, in their words. */
  change: z.string().trim().min(1).max(300),
  /** The songs shown now, by the server's ids, in their order. */
  shown: z.array(IdSchema).max(2000).default([]),
  /** Names this request, so the device can ask how it is going (`AskProgress`). */
  ticket: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
})
export type RefineRequest = z.infer<typeof RefineRequestSchema>

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

/** What a tag change does: songs gain or lose the tag, or the tag itself is renamed, merged or deleted. */
export const TagChangeOpSchema = z.enum(['add', 'remove', 'rename', 'merge', 'delete'])
export type TagChangeOp = z.infer<typeof TagChangeOpSchema>

/**
 * One change to the tags, to approve (docs/features/ai.md, "Tags"). `by` says
 * whether the library's own tagging found it or the model judged it.
 */
export const TagChangeSchema = z.object({
  key: z.string(),
  op: TagChangeOpSchema,
  /** The tag, by its name: one of yours, or for an add, one that would be made. */
  tag: z.string(),
  /** An add whose tag does not exist yet. */
  isNew: z.boolean(),
  /** A rename's new name, or the tag a merge goes into; null otherwise. */
  to: z.string().nullable(),
  /** An add's or a remove's songs, by the server's ids; empty for the rest. */
  songIds: z.array(IdSchema),
  /** Who the songs are by, biggest first: "周杰倫 76, 薛之谦 12, +8 more". */
  who: z.string(),
  why: z.string(),
  by: z.enum(['rule', 'model']),
})
export type TagChange = z.infer<typeof TagChangeSchema>

export const TagReviewSchema = z.object({
  changes: z.array(TagChangeSchema),
  /** How many songs were looked at. */
  looked: z.number().int().nonnegative(),
  /** What was asked for, or null for the untagged songs' pass. */
  asked: z.string().nullable(),
  /** Songs it would not guess for, and why. */
  unsure: z.array(z.object({ songIds: z.array(IdSchema), who: z.string(), why: z.string() })),
  /** Set when something was left out: the model could not be asked, or there was too much. */
  note: z.string().nullable(),
})
export type TagReview = z.infer<typeof TagReviewSchema>

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
  /**
   * What was said before this, first ask first, when `text` follows up on an
   * answer ("only the albums"): the request is all of it together.
   */
  before: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
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

/** What songs can be put in order by, for a playlist's sort and a library question. */
export const AskSortSchema = z.enum([
  'energy',
  'bpm',
  'year',
  'title',
  'artist',
  'addedAt',
  'duration',
  'plays',
  'lastPlayed',
])
export type AskSort = z.infer<typeof AskSortSchema>

export const AskOrderSchema = z.enum(['asc', 'desc'])
export type AskOrder = z.infer<typeof AskOrderSchema>

export const AskStatsRangeSchema = z.enum(['7d', '30d', '90d', '365d', 'all'])
export type AskStatsRange = z.infer<typeof AskStatsRangeSchema>

/** A song field Tidy up may change. */
export const TidyFieldSchema = z.enum(['title', 'artist', 'album', 'albumArtist'])
export type TidyField = z.infer<typeof TidyFieldSchema>

/**
 * A4 · Tidy up: one change to approve — a field, what it is, what it would
 * be, and every song (server ids) where it is exactly that. `by` says whether
 * it was found without a guess — a plain rule, or a music catalogue's own name
 * for the recording — or is the model's guess.
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
  /** What could not be done, in words: the model unreachable, a name the library lacks. */
  note: z.string().nullable(),
  /** What was asked for ("give the 原神音乐 songs their Chinese names"), or null for a checkup. */
  asked: z.string().nullable(),
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
  /** Tags put on or taken off songs, renamed, merged or deleted, as changes to approve. */
  z.object({ kind: z.literal('tags'), review: TagReviewSchema }),
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
  /**
   * Playlists to delete or one to rename, as a proposal to approve: the
   * playlists meant, by their exact names (matched on the server, so a
   * misspelling still finds them and nothing invented is ever named).
   */
  z.object({
    kind: z.literal('playlists'),
    op: z.enum(['delete', 'rename']),
    names: z.array(z.string()).min(1),
    /** A rename's new name. */
    newName: z.string().nullable(),
    /** Names asked about that match no playlist. */
    unknown: z.array(z.string()),
  }),
  /**
   * Songs added to or taken out of one manual playlist, or its songs put in a
   * new order. `songs` is who goes in or out, with why when the model chose
   * them; for a sort it is every song in the new order.
   */
  z.object({
    kind: z.literal('playlistSongs'),
    /** The playlist's exact name. */
    playlist: z.string(),
    op: z.enum(['add', 'remove', 'sort']),
    songs: z.array(DescribePickSchema),
    /** What chose the songs, for an add or a remove. */
    understanding: UnderstandingSchema.nullable(),
    /** Chosen by the filters alone, or judged by the model. */
    by: z.enum(['rule', 'model']),
    sortBy: AskSortSchema.nullable(),
    order: AskOrderSchema,
    /** Tags or artists the words named that this library does not have. */
    unknown: z.array(z.string()),
  }),
  /**
   * A question about what is in the library, answered from it in code: how
   * many, how long, who they are by, and the songs (the first of them, in the
   * order asked for).
   */
  z.object({
    kind: z.literal('library'),
    understanding: UnderstandingSchema,
    unknown: z.array(z.string()),
    show: z.enum(['count', 'songs', 'artists', 'albums', 'tags']),
    count: z.number().int().nonnegative(),
    seconds: z.number().nonnegative(),
    songIds: z.array(IdSchema),
    sortBy: AskSortSchema.nullable(),
    order: AskOrderSchema,
    /** Who, which albums and which tags the songs are in, most songs first. */
    artists: z.array(z.object({ label: z.string(), count: z.number().int() })),
    albums: z.array(z.object({ label: z.string(), count: z.number().int() })),
    tags: z.array(z.object({ label: z.string(), count: z.number().int() })),
  }),
  z.object({ kind: z.literal('open'), place: AskPlaceSchema, say: z.string() }),
  /**
   * Not something the box can do, and what to do instead: `try` is requests
   * it can do that come closest, each one press away.
   */
  z.object({ kind: z.literal('none'), say: z.string(), try: z.array(z.string()).default([]) }),
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
