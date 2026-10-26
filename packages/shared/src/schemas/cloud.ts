import { z } from 'zod'
import { CoverToneSchema } from './song.js'
import { HLC_PATTERN } from '../hlc.js'
import { HASH_FILE_NAME } from '../doormanWire.js'
import { HueSchema, IdSchema } from './common.js'
import { DoormanStorageSchema, SignInAttemptSchema, SignInCodeSchema } from './doorman.js'
import { AudioFeaturesSchema } from './audioFeatures.js'
import { ArtistNamesSchema } from './artist.js'
import {
  BoolRuleSchema,
  DateRuleSchema,
  FeatureRuleSchema,
  KeyRuleSchema,
  NumberRuleSchema,
  TextRuleSchema,
  smartRulesShape,
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
  z.string().regex(new RegExp(`^${folder}/${HASH_FILE_NAME}$`), `not a ${folder} key`)

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

/**
 * An artist's picture (the server's services/artistBackdrops.ts), in both the
 * shapes it is drawn in: the banner behind their page, and the portrait cut
 * square from it for the round face beside their name. Both are pictures named
 * by their hash, so they go in `covers/` beside the songs' — a folder of its
 * own would need every doorman redeployed before a device could read it — and
 * a device keeps them the way it keeps a cover.
 */
export const CloudArtistSchema = z.object({
  /** The artist as `artistKey` writes them: what a device looks a name up by. */
  artist: z.string().min(1),
  banner: CloudCoverSchema,
  portrait: CloudCoverSchema,
})
export type CloudArtist = z.infer<typeof CloudArtistSchema>

/**
 * The names an artist also goes by (`ArtistNamesSchema`), for search. Filled
 * in by the server from MusicBrainz, changed by anyone (`artistNamed`); the
 * latest change wins.
 */
export const CloudArtistNamesSchema = z.object({
  /** The artist as `artistKey` writes them. */
  artist: z.string().min(1),
  names: ArtistNamesSchema,
  /** `names`: the stamp of the change that set them. */
  stamps: StampsSchema.optional(),
})
export type CloudArtistNames = z.infer<typeof CloudArtistNamesSchema>

/**
 * Many pictures in one file (the server's services/coverPacks.ts), so a
 * device that has none of them reads a few files instead of one per picture:
 * every read is one of the bucket's daily allowance, and a library's covers
 * one by one were half of it. The pictures are each still in the bucket on
 * their own, under the key they are listed by here; a pack is only the
 * cheaper way to fetch many at once.
 *
 * The file is the pictures' bytes end to end, in the order listed, and
 * nothing else: a picture starts where the ones before it end. Named by its
 * own hash, in `covers/` with the `pack` extension, which the doorman's key
 * rule already allows. A pack may still hold pictures the library has since
 * let go of; a device keeps only those it names.
 */
export const CloudCoverPackSchema = z.object({
  key: fileKey('covers'),
  size: z.number().int().nonnegative(),
  /** Each picture's key and size, in the order the file holds them. */
  covers: z.array(z.tuple([fileKey('covers'), z.number().int().nonnegative()])).min(1),
})
export type CloudCoverPack = z.infer<typeof CloudCoverPackSchema>

/**
 * Every song's sound vector, in one file (the server's sound/pack.ts), keyed
 * inside by each song's audio key. Made on the server, the one device with the
 * listening model, and kept in the bucket so a server that starts again from
 * the bucket takes the vectors back instead of hearing every song again.
 */
export const CloudSoundSchema = z.object({
  /** The model that heard them: a vector from one means nothing to another. */
  model: z.string().min(1),
  key: fileKey('lyrics'),
  size: z.number().int().nonnegative(),
})
export type CloudSound = z.infer<typeof CloudSoundSchema>

/**
 * Where every heard song sits on the sound map (docs/features/sound-map.md),
 * as one small file beside the vectors it was folded from
 * (`lyrics/<sha256>.map`, shared soundMap.ts). Made on the server whenever
 * the vectors change, and read by a device once a change.
 */
export const CloudSoundMapSchema = z.object({
  key: fileKey('lyrics'),
  size: z.number().int().nonnegative(),
})
export type CloudSoundMap = z.infer<typeof CloudSoundMapSchema>

/**
 * One month of the library's plays, as one file in the bucket beside the
 * words (`lyrics/<sha256>.plays`, a `CloudPlaysFile`). A snapshot says how
 * often a song was played; these say when, which is what Stats is made of,
 * so a server's database holds no history the bucket does not
 * (docs/features/shared-server.md).
 */
export const CloudPlaysSchema = z.object({
  /** `YYYY-MM`, in UTC, as the plays are stamped. */
  month: z.string().regex(/^\d{4}-\d{2}$/, 'not a month'),
  key: fileKey('lyrics'),
  size: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
})
export type CloudPlays = z.infer<typeof CloudPlaysSchema>

/**
 * What a month's file holds: each play as `[song uid, played at, ms played,
 * completed, play id]`, `played at` as SQLite's UTC `YYYY-MM-DD HH:MM:SS`.
 * The id is what makes reading the same play twice count it once.
 */
export const CloudPlaysFileSchema = z.object({
  format: z.literal(1),
  month: CloudPlaysSchema.shape.month,
  plays: z.array(
    z.tuple([UidSchema, z.string(), z.number().int().nonnegative(), z.boolean(), z.string()]),
  ),
})
export type CloudPlaysFile = z.infer<typeof CloudPlaysFileSchema>

export const CloudLyricsSchema = z.object({
  /** The words file (`wordsKey`): the text and its romanized lines, as one read. */
  key: fileKey('lyrics'),
  size: z.number().int().nonnegative(),
  kind: z.enum(['plain', 'synced']),
})
export type CloudLyrics = z.infer<typeof CloudLyricsSchema>

/**
 * What a words file holds (`wordsKey`): the lyric text, as a sidecar holds it,
 * and its romanized lines — romaji or pinyin, one per line of the text, empty
 * where a line needs none. Made on the server, which has the dictionaries, so
 * every device shows what the server's own lyrics answer carries. `romanized`
 * is null when the words are not Chinese or Japanese.
 */
export const CloudWordsSchema = z.object({
  text: z.string(),
  romanized: z.array(z.string()).nullable(),
})
export type CloudWords = z.infer<typeof CloudWordsSchema>

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
  /** The cover's colour, as the server picked it (schemas/song.ts). Null until it has read the cover. */
  coverTone: CoverToneSchema.nullable(),
  lyrics: CloudLyricsSchema.nullable(),
  /**
   * The song's motion curve (schemas/motion.ts), as JSON in `lyrics/`: how loud
   * it is and where the hits are, for the visuals on a device that cannot
   * listen live. Null until the server has analysed the song and put it up.
   */
  motion: fileKey('lyrics').nullable(),
  instrumental: z.boolean(),
  loved: z.boolean(),
  playCount: z.number().int().nonnegative(),
  lastPlayedAt: z.string().nullable(),
  addedAt: z.string(),
  sourceUrl: z.string().nullable(),
  tagUids: z.array(UidSchema),
  /** How the song sounds, as the server's analyser measured it (schemas/audioFeatures.ts). Null until it has. */
  audioFeatures: AudioFeaturesSchema.nullable(),
  /** Per field: title, artist, loved, … */
  stamps: StampsSchema.optional(),
  /** Per tag, whether it was last put on the song or taken off. */
  tagStamps: StampsSchema.optional(),
})
export type CloudSong = z.infer<typeof CloudSongSchema>

export const CloudTagSchema = z.object({
  uid: UidSchema,
  name: z.string(),
  hue: HueSchema,
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

export const CloudSmartRuleSchema = z.discriminatedUnion('field', [
  TextRuleSchema,
  CloudTagRuleSchema,
  NumberRuleSchema,
  DateRuleSchema,
  BoolRuleSchema,
  FeatureRuleSchema,
  KeyRuleSchema,
])
export type CloudSmartRule = z.infer<typeof CloudSmartRuleSchema>

export const CloudSmartRulesSchema = smartRulesShape(CloudSmartRuleSchema)
export type CloudSmartRules = z.infer<typeof CloudSmartRulesSchema>

const CloudPlaylistBaseSchema = z.object({
  uid: UidSchema,
  name: z.string(),
  description: z.string(),
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

/** As `PlaylistSchema`: a manual playlist has no rules, a live one always has a set. */
export const CloudPlaylistSchema = z.discriminatedUnion('kind', [
  CloudPlaylistBaseSchema.extend({ kind: z.literal('manual'), rules: z.null() }),
  CloudPlaylistBaseSchema.extend({ kind: z.literal('live'), rules: CloudSmartRulesSchema }),
])
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
 * The uid behind each song id in one library — its half of the translation
 * between two of them.
 *
 * Every device numbers the bucket's songs its own way: the server has its
 * database's ids, and a device reading the snapshot hands out ids of its own as
 * uids arrive. So an answer from the server — a play in the stats, a song to
 * look metadata up for — names a song this device has never heard of under that
 * number. The uid is the one name both know it by, and this is the table that
 * turns one side's numbers into the other's. Both answer it: the server from
 * its database, a cloud library from its snapshot.
 */
export const CloudUidsSchema = z.object({
  songs: z.array(z.object({ id: IdSchema, uid: UidSchema })),
})
export type CloudUids = z.infer<typeof CloudUidsSchema>

/**
 * Where the server that writes the snapshots can be reached directly, for what
 * only it can do: reading a link, and playing a song before it is imported.
 * The addresses are the ones it listens on; a device tries them and talks to
 * the first that answers. Only whoever can read the bucket sees this, and the
 * token is the one every device of theirs already carries to that server.
 */
export const CloudServerSchema = z.object({
  /**
   * The server's own name for itself, which its `/api/health` answers with
   * (`HealthSchema.serverId`). An address is only where *a* server might be:
   * `http://localhost:4600` on the computer you develop on is the development
   * server, not this one, and a Wi-Fi address on someone else's Wi-Fi is
   * someone else's. A device takes an address only when what answers there
   * says this id (`packages/client/src/connection/reach.ts`).
   */
  id: z.string().min(1),
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
  upTo: z.record(z.string(), z.number().int().nonnegative()),
  songs: z.array(CloudSongSchema),
  tags: z.array(CloudTagSchema),
  playlists: z.array(CloudPlaylistSchema),
  /** Every artist of the library's songs the server has a picture for. */
  artists: z.array(CloudArtistSchema),
  /** The names artists also go by, for search. */
  artistNames: z.array(CloudArtistNamesSchema),
  /**
   * The library's Chinese and Japanese titles, artists and albums, each as it
   * is written and in Latin letters — pinyin, romaji, or both for a name in
   * characters alone, which could be either — so search finds 周杰伦 typed as
   * "zhou jie lun". Made on the server, which has the dictionaries; a name it
   * has not spelt yet is simply not in it.
   */
  spellings: z.record(z.string(), z.array(z.string())),
  /**
   * The covers and artists' pictures, packed a few megabytes to a file, for a
   * device filling its covers from nothing. Empty before the server first packs.
   */
  coverPacks: z.array(CloudCoverPackSchema),
  /** How every song sounds, as the server heard it; null before it has heard any. */
  sound: CloudSoundSchema.nullable(),
  /** Where each heard song sits on the sound map; absent before a server first made one. */
  soundMap: CloudSoundMapSchema.optional(),
  /** When each song was played, a file a month; absent before a server first sent any. */
  plays: z.array(CloudPlaysSchema).optional(),
  /**
   * Tags made twice under one name, on two devices before either heard of
   * the other: the second uid, and the tag it was folded into. A late change
   * that names the second uid still finds its tag.
   */
  aliases: z.record(UidSchema, UidSchema).optional(),
  /**
   * Songs folded into another copy of themselves (`songMerged`): the extra
   * copy's uid, and the song it went into. A late play, tag or playlist place
   * that names the extra copy lands on the song kept.
   */
  merged: z.record(UidSchema, UidSchema).optional(),
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
export const CloudSignInSchema = z.object({ attempt: SignInAttemptSchema })
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
  signInNeedsCode: z.boolean(),
  /** A bucket is in use: connected directly, or belonging to the signed-in account. */
  connected: z.boolean(),
  /** Where it is connected to. The key itself is never sent back. */
  target: DoormanStorageSchema.nullable(),
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
    /** Songs in the library. */
    total: z.number().int().nonnegative(),
    /** Of those, songs whose audio is in the bucket; the rest are still uploading. */
    inCloud: z.number().int().nonnegative(),
  }),
  /** Everything in the bucket that this server knows of. */
  bytesInCloud: z.number().int().nonnegative(),
  lastSyncAt: z.string().nullable(),
  lastSnapshotAt: z.string().nullable(),
  lastError: z.string().nullable(),
})
export type CloudStatus = z.infer<typeof CloudStatusSchema>
