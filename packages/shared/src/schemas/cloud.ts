import { z } from 'zod'
import { SongSortFieldSchema, SortDirectionSchema } from './common.js'
import { SongFeaturesSchema } from './features.js'
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
  lyrics: CloudLyricsSchema.nullable(),
  instrumental: z.boolean(),
  loved: z.boolean(),
  playCount: z.number().int().nonnegative(),
  skipCount: z.number().int().nonnegative(),
  lastPlayedAt: z.string().nullable(),
  addedAt: z.string(),
  sourceUrl: z.string().nullable(),
  tagUids: z.array(UidSchema),
  features: SongFeaturesSchema.nullable(),
})
export type CloudSong = z.infer<typeof CloudSongSchema>

export const CloudTagSchema = z.object({
  uid: UidSchema,
  name: z.string(),
  hue: z.number().int().min(0).max(359),
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
})
export type CloudPlaylist = z.infer<typeof CloudPlaylistSchema>

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
   * For each device, the last log entry already folded into this snapshot.
   * Empty until the change log exists (milestone 2).
   */
  upTo: z.record(z.string(), z.number().int().nonnegative()).default({}),
  songs: z.array(CloudSongSchema),
  tags: z.array(CloudTagSchema),
  playlists: z.array(CloudPlaylistSchema),
})
export type CloudSnapshot = z.infer<typeof CloudSnapshotSchema>

// --- The Mac's own API for managing its connection to the bucket ------------

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
 * Start signing this Mac in with Google through the doorman. The browser
 * makes the attempt id, opens the doorman's sign-in page with it straight
 * away (a window opened after an await is a popup, and gets blocked), and
 * tells the Mac, which waits for Google to finish and keeps the session.
 */
export const CloudSignInSchema = z.object({
  attempt: z.string().regex(/^[0-9a-f]{32}$/, 'not a sign-in attempt'),
})
export type CloudSignIn = z.infer<typeof CloudSignInSchema>

export const CloudAccountSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
})
export type CloudAccount = z.infer<typeof CloudAccountSchema>

export const CloudStatusSchema = z.object({
  /**
   * The doorman this Mac signs in through, or null when none is set up — then
   * the only way in is connecting a bucket directly with its key.
   */
  doormanUrl: z.string().nullable(),
  /** The Google account signed in through the doorman. */
  account: CloudAccountSchema.nullable(),
  /** Waiting for Google to finish a sign-in started from this Mac. */
  signingIn: z.boolean(),
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
  /** This Mac's name in the bucket. */
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
    /** Songs whose file is on this Mac. */
    total: z.number().int().nonnegative(),
    /** Of those, songs whose audio is in the bucket. */
    inCloud: z.number().int().nonnegative(),
  }),
  /** Everything this Mac has uploaded that is still in the bucket. */
  bytesInCloud: z.number().int().nonnegative(),
  lastSyncAt: z.string().nullable(),
  lastSnapshotAt: z.string().nullable(),
  lastError: z.string().nullable(),
})
export type CloudStatus = z.infer<typeof CloudStatusSchema>
