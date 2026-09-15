import { z } from 'zod'
import { CoverToneSchema } from './song.js'
import { HLC_PATTERN } from '../hlc.js'
import { SongSortFieldSchema, SortDirectionSchema } from './common.js'
import { SignInCodeSchema } from './doorman.js'
import { SongFeaturesSchema } from './audioFeatures.js'
import { PlaylistKindSchema } from './playlist.js'
import {
  BoolRuleSchema,
  DateRuleSchema,
  FeatureRuleSchema,
  KeyRuleSchema,
  NumberRuleSchema,
  TextRuleSchema,
} from './smart.js'

/**
 * The cloud bucket's contract — see docs/SYNC.md.
 *
 * Everything here is read by devices that did not write it, possibly years
 * later, possibly running an older build. So the rules are stricter than for
 * the HTTP API: every key a snapshot names is checked against the exact shape
 * a key may have, and a bucket whose format is newer than this build
 * understands is refused rather than half-read.
 */

/** Bumped when the bucket layout changes in a way an older build cannot read. */
export const CLOUD_FORMAT = 1

/** A song, tag or playlist's identity everywhere outside one device's database. */
export const UidSchema = z.string().regex(/^[0-9a-f]{32}$/, 'not a uid')
export type Uid = z.infer<typeof UidSchema>

/** Who wrote a snapshot or a log: `mac-3f9a1c2e`, `iphone-0b7d44a1`. */
export const CloudDeviceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/, 'not a device id')

/** When a change was made, from a hybrid logical clock (hlc.ts). */
export const HlcSchema = z.string().regex(HLC_PATTERN, 'not a clock stamp')

/**
 * For each field some change has set, the stamp of the change that set it
 * last (docs/SYNC.md). A change whose stamp is later replaces the value; an
 * earlier one arriving late loses. Only fields a change ever touched have one,
 * so most things carry none at all.
 */
const StampsSchema = z.record(z.string(), HlcSchema)

/** `format.json`, at the top of the bucket. */
export const CloudFormatSchema = z.object({
  app: z.literal('self.mp3'),
  format: z.number().int().positive(),
  createdAt: z.string(),
  createdBy: z.string(),
})
export type CloudFormat = z.infer<typeof CloudFormatSchema>

/**
 * A file in the bucket, named by the SHA-256 of its bytes. Keys are relative
 * to the bucket's prefix. The pattern is the whole of what a key may be, so a
 * snapshot from anywhere can never point a device at some other path.
 */
const fileKey = (folder: string) =>
  z.string().regex(new RegExp(`^${folder}/[0-9a-f]{64}\\.[a-z0-9]{1,5}$`), `not a ${folder} key`)

export const CloudAudioSchema = z.object({
  key: fileKey('audio'),
  size: z.number().int().nonnegative(),
  mime: z.string(),
})
export type CloudAudio = z.infer<typeof CloudAudioSchema>

export const CloudCoverSchema = z.object({
  key: fileKey('covers'),
  size: z.number().int().nonnegative(),
})
export type CloudCover = z.infer<typeof CloudCoverSchema>

export const CloudLyricsSchema = z.object({
  key: fileKey('lyrics'),
  size: z.number().int().nonnegative(),
  kind: z.enum(['plain', 'synced']),
  /**
   * The words' romanized lines — romaji or pinyin, one per line of the text,
   * empty where a line needs none — as a JSON array beside them. Made on the
   * server, which has the dictionaries, so every device shows what the server's own
   * lyrics answer carries. Null when the words are not Chinese or Japanese.
   */
  romanized: fileKey('lyrics').nullable(),
})
export type CloudLyrics = z.infer<typeof CloudLyricsSchema>

export const CloudSongSchema = z.object({
  uid: UidSchema,
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  albumArtist: z.string(),
  trackNo: z.number().int().nullable(),
  year: z.number().int().nullable(),
  /** Seconds. Zero means "unknown". */
  duration: z.number().nonnegative(),
  audio: CloudAudioSchema,
  cover: CloudCoverSchema.nullable(),
  /** The cover's colour, as the server picked it (schemas/song.ts). Absent from older snapshots. */
  coverTone: CoverToneSchema.nullable().optional(),
  lyrics: CloudLyricsSchema.nullable(),
  /**
   * The song's motion curve (schemas/motion.ts), as JSON in `lyrics/`: how loud
   * it is and where the hits are, for the visuals on a device that cannot
   * listen live. Null or absent until the server has analysed the song, and
   * absent from older snapshots.
   */
  motion: fileKey('lyrics').nullable().optional(),
  instrumental: z.boolean(),
  loved: z.boolean(),
  playCount: z.number().int().nonnegative(),
  skipCount: z.number().int().nonnegative(),
  lastPlayedAt: z.string().nullable(),
  addedAt: z.string(),
  sourceUrl: z.string().nullable(),
  tagUids: z.array(UidSchema),
  features: SongFeaturesSchema.nullable(),
  /** Per field: title, artist, loved, … */
  stamps: StampsSchema.optional(),
  /** Per tag, whether it was last put on the song or taken off. */
  tagStamps: StampsSchema.optional(),
})
export type CloudSong = z.infer<typeof CloudSongSchema>

export const CloudTagSchema = z.object({
  uid: UidSchema,
  name: z.string(),
  hue: z.number().int().min(0).max(359),
  /** Per field: name, hue. */
  stamps: StampsSchema.optional(),
})
export type CloudTag = z.infer<typeof CloudTagSchema>

/**
 * Smart rules as they travel. Identical to `SmartRulesSchema` except that a
 * tag rule names its tag by uid: an integer tag id means nothing on any
 * device but the one whose database handed it out.
 */
export const CloudTagRuleSchema = z.object({
  field: z.literal('tag'),
  op: z.enum(['has', 'notHas']),
  tagUid: UidSchema,
})
export type CloudTagRule = z.infer<typeof CloudTagRuleSchema>

export const CloudSmartRuleSchema = z.union([
  TextRuleSchema,
  CloudTagRuleSchema,
  NumberRuleSchema,
  DateRuleSchema,
  BoolRuleSchema,
  FeatureRuleSchema,
  KeyRuleSchema,
])
export type CloudSmartRule = z.infer<typeof CloudSmartRuleSchema>

export const CloudSmartRulesSchema = z.object({
  match: z.enum(['all', 'any']),
  rules: z.array(CloudSmartRuleSchema),
  orderBy: SongSortFieldSchema,
  order: SortDirectionSchema,
  limit: z.number().int().min(1).nullable(),
})
export type CloudSmartRules = z.infer<typeof CloudSmartRulesSchema>

export const CloudPlaylistSchema = z.object({
  uid: UidSchema,
  name: z.string(),
  description: z.string(),
  kind: PlaylistKindSchema,
  /** Null for a manual playlist. */
  rules: CloudSmartRulesSchema.nullable(),
  pinned: z.boolean(),
  /**
   * In order. For a smart playlist, the songs its rules matched when the
   * snapshot was written — so a device that cannot evaluate rules still shows
   * the playlist as it stands.
   */
  songUids: z.array(UidSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Per field: name, description, rules, pinned, and `order` for the last reorder. */
  stamps: StampsSchema.optional(),
  /** Per song, whether it was last added to the playlist or taken out. */
  songStamps: StampsSchema.optional(),
})
export type CloudPlaylist = z.infer<typeof CloudPlaylistSchema>

/**
 * A link some device asked to import, and how it went (docs/SYNC.md). Only a
 * device that can fetch — the server, with yt-dlp — works on it; what it says
 * here is how every device, the one that asked included, finds out.
 */
export const CloudImportSchema = z.object({
  uid: UidSchema,
  url: z.string(),
  /** The device that asked, and when. */
  requestedBy: z.string(),
  requestedAt: z.string(),
  /**
   * `waiting` until a device that can fetch has looked at it, `working` while
   * its songs download, then `done` (with the songs it added), `failed` (with
   * why) or `cancelled`.
   */
  state: z.enum(['waiting', 'working', 'done', 'failed', 'cancelled']),
  /** What the link turned out to be: a song's title, or a playlist's. */
  title: z.string().nullable(),
  songUids: z.array(UidSchema),
  error: z.string().nullable(),
  updatedAt: z.string(),
})
export type CloudImport = z.infer<typeof CloudImportSchema>

/**
 * Where the server that writes the snapshots can be reached directly, for what
 * only it can do: reading a link, and playing a song before it is imported.
 * The addresses are the ones it listens on; a device tries them and talks to
 * the first that answers. Only whoever can read the bucket sees this, and the
 * token is the one every device of theirs already carries to that server.
 */
export const CloudServerSchema = z.object({
  addresses: z.array(z.string().url()).max(16),
  token: z.string().nullable(),
})
export type CloudServer = z.infer<typeof CloudServerSchema>

/**
 * The whole library at one moment: `snapshots/<time>-<device>.json`.
 *
 * Lists only songs whose audio is in the bucket. A song still uploading is not
 * in the library yet as far as any other device is concerned.
 */
export const CloudSnapshotSchema = z.object({
  format: z.number().int().positive(),
  writtenAt: z.string(),
  writtenBy: CloudDeviceIdSchema,
  /**
   * For each device, the last of its log files already folded into this
   * snapshot. A device reading it replays only the files after these.
   */
  upTo: z.record(z.string(), z.number().int().nonnegative()).default({}),
  songs: z.array(CloudSongSchema),
  tags: z.array(CloudTagSchema),
  playlists: z.array(CloudPlaylistSchema),
  /**
   * Tags made twice under one name, on two devices before either heard of
   * the other: the second uid, and the tag it was folded into. A late change
   * that names the second uid still finds its tag.
   */
  aliases: z.record(UidSchema, UidSchema).optional(),
  /** Links asked for from any device in the last week, and how each went. */
  imports: z.array(CloudImportSchema).optional(),
  /** How to reach the server that wrote this, when a device is near enough to. */
  server: CloudServerSchema.optional(),
})
export type CloudSnapshot = z.infer<typeof CloudSnapshotSchema>

// --- The server's own API for managing its connection to the bucket ------------

/**
 * Connecting to a bucket. For B2 the region is worked out from the endpoint,
 * so the four things the bucket's page and the key dialog show are enough.
 */
export const CloudConnectSchema = z.object({
  endpoint: z.string().trim().min(1).max(300),
  region: z.string().trim().max(64).optional(),
  bucket: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/, 'not a bucket name'),
  /** The folder inside the bucket everything goes under. */
  prefix: z
    .string()
    .trim()
    .max(100)
    .regex(
      /^[a-zA-Z0-9._-]*(\/[a-zA-Z0-9._-]+)*$/,
      'letters, digits, dots, dashes and slashes only',
    )
    .default('selfmp3'),
  keyId: z.string().trim().min(1).max(200),
  applicationKey: z.string().trim().min(1).max(200),
})
export type CloudConnect = z.infer<typeof CloudConnectSchema>

/**
 * Start signing this server in with Google through the doorman. The browser
 * makes the attempt id, opens the doorman's sign-in page with it straight
 * away (a window opened after an await is a popup, and gets blocked), and
 * tells the server, which waits for Google to finish and keeps the session.
 */
export const CloudSignInSchema = z.object({
  attempt: z.string().regex(/^[0-9a-f]{32}$/, 'not a sign-in attempt'),
})
export type CloudSignIn = z.infer<typeof CloudSignInSchema>

/** The code the doorman showed once Google signed you in (doorman.ts): what claims the session. */
export const CloudSignInCodeSchema = z.object({ code: SignInCodeSchema })
export type CloudSignInCode = z.infer<typeof CloudSignInCodeSchema>

export const CloudAccountSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
})
export type CloudAccount = z.infer<typeof CloudAccountSchema>

export const CloudStatusSchema = z.object({
  /**
   * The doorman this server signs in through, or null when none is set up — then
   * the only way in is connecting a bucket directly with its key.
   */
  doormanUrl: z.string().nullable(),
  /** The Google account signed in through the doorman. */
  account: CloudAccountSchema.nullable(),
  /** Waiting for Google to finish a sign-in started from this server. */
  signingIn: z.boolean(),
  /** Google has finished; the code it showed is wanted, to claim the session. */
  signInNeedsCode: z.boolean().default(false),
  /** A bucket is in use: connected directly, or belonging to the signed-in account. */
  connected: z.boolean(),
  /** Where it is connected to. The key itself is never sent back. */
  target: z
    .object({
      endpoint: z.string(),
      region: z.string(),
      bucket: z.string(),
      prefix: z.string(),
      /** The first few characters of the key id, to tell two keys apart. */
      keyIdHint: z.string(),
    })
    .nullable(),
  /** This server's name in the bucket. */
  deviceId: z.string().nullable(),
  state: z.enum(['off', 'idle', 'syncing', 'error']),
  /** Files being uploaded in the current pass. */
  progress: z
    .object({
      done: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      current: z.string().nullable(),
    })
    .nullable(),
  songs: z.object({
    /** Songs whose file is on this server. */
    total: z.number().int().nonnegative(),
    /** Of those, songs whose audio is in the bucket. */
    inCloud: z.number().int().nonnegative(),
  }),
  /** Everything this server has uploaded that is still in the bucket. */
  bytesInCloud: z.number().int().nonnegative(),
  lastSyncAt: z.string().nullable(),
  lastSnapshotAt: z.string().nullable(),
  lastError: z.string().nullable(),
})
export type CloudStatus = z.infer<typeof CloudStatusSchema>
