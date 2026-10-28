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

/** The size that means every song the other parts let in ("all my YOASOBI"). */
export const EVERY_SONG = 2000

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
 * a song is in if it carries any of `anyTags`, is by any of `artists` or is on
 * any of `albums` (or there are none), and then passes every other part that
 * is set.
 */
export const UnderstandingSchema = z.object({
  /** A name for the playlist, from the words. */
  name: z.string().trim().min(1).max(60),
  anyTags: z.array(z.string()).max(12),
  artists: z.array(z.string()).max(12),
  /** Album names, as the library spells them. */
  albums: z.array(z.string()).max(12),
  noTags: z.array(z.string()).max(12),
  /** 0–1, from the audio analysis. A song not analysed yet does not pass a set range. */
  energy: RangeSchema,
  bpm: RangeSchema,
  /**
   * The years the songs came out, as YouTube Music gives a release's year. A
   * song with no year does not pass a set range.
   */
  year: RangeSchema,
  /** With words, without (instrumental, or no lyrics found), or either. */
  words: z.enum(['with', 'without']).nullable(),
  loved: z.boolean().nullable(),
  /** Only songs played within this many days. */
  playedWithinDays: z.number().int().min(1).max(3650).nullable(),
  /** Leave out songs played within this many days; never played stays in. */
  notPlayedWithinDays: z.number().int().min(1).max(3650).nullable(),
  addedWithinDays: z.number().int().min(1).max(3650).nullable(),
  /** How many songs were asked for, when the words said. */
  size: z.number().int().min(1).max(EVERY_SONG).nullable(),
  /**
   * How long it should play, in minutes, when the words said ("2 hours" is
   * 120). The songs are counted by their own lengths, not an average song's.
   */
  minutes: z.number().int().min(1).max(1440).nullable().default(null),
  /**
   * How the music should sound, in English, for the server's listening model
   * (docs/features/audio-intelligence.md, "How songs sound"): "calm orchestral
   * music with strings and flute". Of the songs the other parts let in, it
   * keeps the ones that sound like it, best first. Null when the words say
   * nothing about it.
   */
  sound: z.string().trim().min(1).max(120).nullable().default(null),
  /**
   * What the words want that the parts above cannot say: "for reading", "sounds
   * like rain". Null when the parts say all of it.
   */
  brief: z.string().max(200).nullable(),
})
export type Understanding = z.infer<typeof UnderstandingSchema>

/** The longest question Ask takes — and so what a search box takes, since Search asks too. */
export const ASK_TEXT_MAX = 500

export const DescribeRequestSchema = z.object({
  text: z.string().trim().min(1).max(ASK_TEXT_MAX),
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

/** A smart request's own name, chosen by the device: how it asks after the request, or stops it. */
export const AskTicketSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)

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
  /**
   * What else made the songs fewer than what fit, in plain words: the line
   * the listening drew, resting songs set aside, a size nobody asked for, or
   * why none were chosen. Never silent: an answer shorter than it could be says so.
   */
  notes: z.array(z.string()),
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

/** The longest line a turn's answer is told back in. */
export const ASK_ANSWERED_MAX = 2000
/** The most earlier turns a follow-up is asked after: a longer conversation sends its newest. */
export const ASK_BEFORE_MAX = 8
/** The most songs an answer's object carries back, in its order. */
export const ASK_OBJECT_SONGS = 200
/** The most cards one reply holds. */
export const ASK_CARDS_MAX = 4
/** The most answers a question back offers. */
export const ASK_CLARIFY_OPTIONS = 3

/**
 * A handle names something an answer showed, for the rest of the conversation
 * (AGENT-DESIGN 2.1): `t3.2` is the third turn's second card. The device gives
 * it, from where the turn stands on its page, so it stays the same however
 * many turns are sent after it.
 */
export const AskHandleSchema = z.string().regex(/^t\d{1,3}\.\d{1,2}$/)
export type AskHandle = z.infer<typeof AskHandleSchema>

/** What an answer showed, as an object a follow-up can name. */
export const AskObjectKindSchema = z.enum([
  'songs',
  'together',
  'find',
  'library',
  'stats',
  'explore',
  'playlistSongs',
  'tagChanges',
  'nameChanges',
  'copies',
])
export type AskObjectKind = z.infer<typeof AskObjectKindSchema>

/**
 * Something an earlier answer showed, sent back by the device so a follow-up
 * can act on it by its handle ("play the 3rd one", "add these to gym", "why
 * is 大海 in here"): the server keeps no conversation, and the device already
 * holds the server's ids. `songIds` are the songs in the order shown, `why`
 * each one's reason where the answer gave one, in the same order.
 */
export const AskObjectSchema = z.object({
  handle: AskHandleSchema,
  kind: AskObjectKindSchema,
  /** Its name or a few words on what it is ("Rainy day", "5 tag changes"). */
  label: z.string().max(120),
  songIds: z.array(IdSchema).max(ASK_OBJECT_SONGS),
  why: z.array(z.string().max(140).nullable()).max(ASK_OBJECT_SONGS).default([]),
  /** The playlist it is about, for a playlist's songs. */
  playlist: z.string().max(120).nullable().default(null),
  /** What a song list was offered for: to play now, to keep, or after the song playing. */
  lead: z.enum(['play', 'save', 'next']).nullable().default(null),
  /** The song a list sounds like, when it was asked to (`like`), by the server's id. */
  like: IdSchema.nullable().default(null),
  /** What a song list understood, as it stands now: what a change to it starts from. */
  understanding: UnderstandingSchema.nullable().default(null),
})
export type AskObject = z.infer<typeof AskObjectSchema>

/**
 * One turn of an Ask conversation: what was asked, what the answer shown for
 * it said — its words, or a line the device writes for a list or a review
 * ("Showed 12 songs (“…”)") — and what it showed, by handle.
 */
export const AskTurnSchema = z.object({
  asked: z.string().trim().min(1).max(ASK_TEXT_MAX),
  answered: z.string().trim().max(ASK_ANSWERED_MAX),
  objects: z.array(AskObjectSchema).max(ASK_CARDS_MAX).default([]),
})
export type AskTurn = z.infer<typeof AskTurnSchema>
export type AskTurnInput = z.input<typeof AskTurnSchema>

/**
 * Where the asking device is: the song playing, what "this" means (A8), and
 * the answer on its screen, what "these" means — the field's "↳ these songs",
 * null once it is let go.
 */
export const AskContextSchema = z.object({
  playing: IdSchema.nullable().default(null),
  screen: AskHandleSchema.nullable().default(null),
})
export type AskContext = z.infer<typeof AskContextSchema>

/**
 * The Search box's Ask (docs/features/ai.md, "S1"): one request, routed to one
 * of a few things the app can already do, and answered as a proposal.
 */
export const AskRequestSchema = z.object({
  text: z.string().trim().min(1).max(ASK_TEXT_MAX),
  context: AskContextSchema.default({ playing: null, screen: null }),
  /** Names this request, so the device can ask how it is going (`AskProgress`). */
  ticket: AskTicketSchema.optional(),
  /**
   * The conversation before this, first turn first, when `text` follows up on
   * an answer: each thing asked with what was shown for it. `text` is what is
   * answered; these are what it is said after.
   */
  before: z.array(AskTurnSchema).max(ASK_BEFORE_MAX).default([]),
})
export type AskRequest = z.infer<typeof AskRequestSchema>

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
  /** An album's own order: by album, then track number. */
  'track',
])
export type AskSort = z.infer<typeof AskSortSchema>

export const AskOrderSchema = z.enum(['asc', 'desc'])
export type AskOrder = z.infer<typeof AskOrderSchema>

export const AskStatsRangeSchema = z.enum(['7d', '30d', '90d', '365d', 'all'])
export type AskStatsRange = z.infer<typeof AskStatsRangeSchema>

/** A song's names: what Tidy up renames, and what a change asked for may touch. */
export const TidyNameSchema = z.enum(['title', 'artist', 'album', 'albumArtist'])
export type TidyName = z.infer<typeof TidyNameSchema>

/**
 * A song field Tidy up may change: its names, and the year and cover a
 * catalogue fills in where they are missing.
 */
export const TidyFieldSchema = z.enum([...TidyNameSchema.options, 'year', 'cover'])
export type TidyField = z.infer<typeof TidyFieldSchema>

/**
 * A4 · Tidy up: one change to approve — a field, what it is, what it would
 * be, and every song (server ids) where it is exactly that. `by` says whether
 * it was found without a guess — a plain rule, or a music catalogue's own name
 * for the recording — or is the model's guess.
 *
 * Every value is text, as `tidyValue` reads it off a song: a year is its
 * digits, and a cover is the address of the picture to take. A field filled
 * in where it was missing goes from ''.
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
  /**
   * What the model told them about what was asked, in their language: which
   * song it took them to mean and why it stays as it is, when it changes
   * nothing. Null for a checkup, or when it had nothing to add.
   */
  reply: z.string().nullable(),
  /**
   * A checkup's count of the songs missing an album, a year or a cover, each
   * and in all, which "Fill in what's missing" looks up. Null for anything but
   * a checkup.
   */
  gaps: z
    .object({
      songs: z.number().int().nonnegative(),
      album: z.number().int().nonnegative(),
      year: z.number().int().nonnegative(),
      cover: z.number().int().nonnegative(),
    })
    .nullable(),
})
export type TidyResult = z.infer<typeof TidyResultSchema>

/**
 * A song in the library more than once (A4, "Copies"): the copy kept, the
 * extra copies to delete (server ids), and why they are one recording. `by`
 * is `rule` only when nothing tells them apart — the same names, album and
 * length — and `model` when the model judged it.
 */
export const TidyCopySchema = z.object({
  key: z.string(),
  keep: IdSchema,
  songIds: z.array(IdSchema).min(1),
  why: z.string(),
  by: z.enum(['rule', 'model']),
})
export type TidyCopy = z.infer<typeof TidyCopySchema>

export const CopiesResultSchema = z.object({
  copies: z.array(TidyCopySchema),
  /** How many songs were looked at. */
  looked: z.number().int().nonnegative(),
  /** What could not be done, in words. */
  note: z.string().nullable(),
})
export type CopiesResult = z.infer<typeof CopiesResultSchema>

/**
 * A9 · the rows of an import's review, for the model to read their names
 * (`POST /api/ai/import/names`): what each row is called now and how long it
 * is, and the name of the list they came in, which often says what they are.
 */
export const ImportNamesRequestSchema = z.object({
  list: z.string().trim().max(300).nullable().default(null),
  rows: z
    .array(
      z.object({
        title: z.string().max(300),
        artist: z.string().max(300).default(''),
        album: z.string().max(300).default(''),
        duration: z.number().nonnegative().default(0),
      }),
    )
    .min(1)
    .max(300),
})
export type ImportNamesRequest = z.input<typeof ImportNamesRequestSchema>

/**
 * The names the model would give the rows that look wrong, each by its place
 * in the request, with why. Every word in them is one of the row's own or the
 * list's, so a suggestion reorders and trims but never makes a name up.
 */
export const ImportNamesSchema = z.object({
  suggestions: z.array(
    z.object({
      row: z.number().int().nonnegative(),
      title: z.string(),
      artist: z.string(),
      album: z.string(),
      why: z.string(),
    }),
  ),
})
export type ImportNames = z.infer<typeof ImportNamesSchema>

/**
 * What can be done to the music playing on the asking device: the next song
 * or the one before, this one from its start, pause or carry on, or one song
 * already in Up next, by its place there.
 */
export const AskPlaybackOpSchema = z.enum([
  'next',
  'previous',
  'restart',
  'pause',
  'resume',
  'upNext',
])
export type AskPlaybackOp = z.infer<typeof AskPlaybackOpSchema>

/**
 * One card of an Ask reply (`AskReply`): one thing the answer shows or
 * proposes, each with its own button.
 */
export const AskCardSchema = z.discriminatedUnion('kind', [
  /** Songs to play now or keep: Describe's answer, and which of the two the words led with. */
  z.object({
    kind: z.literal('songs'),
    /** play: now; save: a playlist; next: after the song playing, in Up next (A8). */
    lead: z.enum(['play', 'save', 'next']),
    describe: DescribeResultSchema,
    /** The song they asked for music like, by the server's id: a change to the list keeps it. */
    like: IdSchema.nullable().default(null),
  }),
  /**
   * Listening with friends: a room to open, or songs for the room the device
   * is in — the device decides which, since only it knows. `describe` is the
   * songs the words asked for, or null for just the room.
   */
  z.object({ kind: z.literal('together'), describe: DescribeResultSchema.nullable() }),
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
  /** Song names worth fixing, or what is missing filled in, as changes to approve. */
  z.object({ kind: z.literal('tidy'), tidy: TidyResultSchema }),
  /** Songs in the library more than once, each extra copy to delete. */
  z.object({ kind: z.literal('copies'), copies: CopiesResultSchema }),
  /** A way they want things done from now on, to save for every Ask after. */
  z.object({ kind: z.literal('remember'), note: z.string() }),
  /**
   * Music to import: the albums or songs 网易云 lists for what was asked, each
   * with its link for Import and how many of its songs are in the library.
   */
  z.object({
    kind: z.literal('getMusic'),
    words: z.string(),
    items: z.array(
      z.object({
        kind: z.enum(['album', 'song']),
        title: z.string(),
        artist: z.string(),
        url: z.string(),
        cover: z.string().nullable(),
        tracks: z.number().int().nonnegative(),
        have: z.number().int().nonnegative(),
      }),
    ),
  }),
  /**
   * An open question looked into with tools: the answer in words, the songs it
   * is about (server ids), and what to search a catalogue for when it is about
   * music they don't have.
   */
  z.object({
    kind: z.literal('explore'),
    say: z.string(),
    songIds: z.array(IdSchema),
    get: z.string().nullable(),
  }),
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
    /**
     * When a model judged the songs by meaning: how many it read of how many
     * the filters let in. Fewer read than let in makes `count` an estimate,
     * scaled up from them. Null when the filters alone counted.
     */
    judged: z
      .object({ songs: z.number().int().nonnegative(), of: z.number().int().nonnegative() })
      .nullable(),
    songIds: z.array(IdSchema),
    sortBy: AskSortSchema.nullable(),
    order: AskOrderSchema,
    /** Who, which albums and which tags the songs are in, most songs first (a song counts for everyone it is by). */
    artists: z.array(z.object({ label: z.string(), count: z.number().int() })),
    albums: z.array(z.object({ label: z.string(), count: z.number().int() })),
    tags: z.array(z.object({ label: z.string(), count: z.number().int() })),
    /** How many different artists, albums and tags there are among them, past those listed. */
    distinct: z.object({
      artists: z.number().int().nonnegative(),
      albums: z.number().int().nonnegative(),
      tags: z.number().int().nonnegative(),
    }),
  }),
  z.object({ kind: z.literal('open'), place: AskPlaceSchema, say: z.string() }),
  /**
   * The music playing, controlled ("skip this song", "play the last song in
   * Up next"). The one answer the device carries out as it arrives, rather
   * than proposing: it is what the buttons beside the music already do, and
   * the device says what it did. `place` is which song in Up next for
   * `upNext`, 1 the first and -1 the last, and null for the rest; the device
   * counts it in its own Up next, which the server never sees.
   */
  z.object({
    kind: z.literal('playback'),
    op: AskPlaybackOpSchema,
    place: z.number().int().nullable(),
  }),
  /**
   * A question back, when the words could mean things that would be answered
   * differently: `options` are answers to it, in their words, each asked as
   * the next turn when pressed. Always the reply's only card.
   */
  z.object({
    kind: z.literal('clarify'),
    question: z.string(),
    options: z.array(z.string()).max(ASK_CLARIFY_OPTIONS),
  }),
])
export type AskCard = z.infer<typeof AskCardSchema>

/**
 * What Ask answers (AGENT-DESIGN 2.4): a few words of its own, and the cards,
 * in the order the request asked for them ("10 calm songs, then tag them 夜"
 * is a songs card and a tags card). Each card is named by `t{turn}.{card}`
 * for the rest of the conversation, 1 for the first card. A `clarify` card
 * stands alone: a question back is not asked beside an answer.
 */
export const AskReplySchema = z
  .object({
    /** Its own words above the cards, or null when the cards say it all. */
    say: z.string().nullable(),
    cards: z.array(AskCardSchema).min(1).max(ASK_CARDS_MAX),
  })
  .refine(reply => reply.cards.length === 1 || reply.cards.every(card => card.kind !== 'clarify'), {
    message: 'A question back is the only card of its reply',
    path: ['cards'],
  })
export type AskReply = z.infer<typeof AskReplySchema>

/**
 * How an Ask is going: its stages so far, the last one still running unless
 * done. Once it is done, what it came to, for a device whose connection
 * closed while it waited (a phone sent to the background): the server goes on
 * without it for a while and keeps the outcome under the ticket.
 */
export const AskProgressSchema = z.object({
  steps: z.array(z.object({ text: z.string(), done: z.boolean() })),
  /** False for a ticket the server has not seen or has let go of: nothing will come of it. */
  known: z.boolean(),
  /** Finished, one way or the other. */
  done: z.boolean(),
  /** The reply, when finished and asked for with `answer=1`. */
  answer: AskReplySchema.nullable(),
  /** Why it failed, said as an error response would say it. */
  failed: z.object({ status: z.number().int(), error: z.string(), code: z.string() }).nullable(),
})
export type AskProgress = z.infer<typeof AskProgressSchema>

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
