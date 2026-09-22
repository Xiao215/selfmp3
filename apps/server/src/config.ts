import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { DEFAULT_DOORMAN_URL, DEFAULT_SERVER_PORT } from '@selfmp3/shared'
import { loadDotEnv } from './dotenv.js'

/**
 * Configuration is read once, validated once, and frozen.
 *
 * A typo in an environment variable fails at boot with a readable message
 * instead of surfacing as `undefined` three layers deep at 2am.
 */

/** A folder name, so not the `self.mp3` of the wordmark: a dot reads as a suffix. */
const APP_DIR_NAME = 'selfmp3'

/**
 * Where your music and your database live, when nothing says otherwise.
 *
 * A place of their own, outside any checkout, so a `git pull` can never touch
 * your music and every checkout or worktree finds the same library. Two
 * places, because they are different kinds of thing: the music goes under
 * `~/Music`, where you can open it in Finder and drag things in — the
 * watched folder expects exactly that — and the database and the artwork
 * derived from it go where a Mac keeps application data. Docker sets both
 * variables explicitly.
 */
export function defaultDirs({
  home = os.homedir(),
  platform = process.platform,
  profile = process.env['SELFMP3_PROFILE'] ?? '',
}: {
  home?: string
  platform?: NodeJS.Platform
  profile?: string
} = {}): { libraryDir: string; dataDir: string } {
  // A profile is a whole separate installation — its own music, its own
  // database, and so its own cloud sign-in, since that lives in the database.
  // It is how you work on the code without the real library being what you
  // work on. `npm run dev` sets it, so the dev server can never be pointed at
  // your own collection by accident.
  const dir = APP_DIR_NAME + profileSuffix(profile)
  return {
    libraryDir: path.join(home, 'Music', dir),
    dataDir:
      platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', dir)
        : path.join(home, '.local', 'share', dir),
  }
}

/** `dev` → `-dev`, and nothing at all for the real installation. */
function profileSuffix(profile: string): string {
  const safe = profile
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe ? `-${safe.slice(0, 20)}` : ''
}

/**
 * The two folders as the environment settles them: the profile's defaults,
 * unless `SELFMP3_LIBRARY_DIR` / `SELFMP3_DATA_DIR` point elsewhere.
 *
 * Nothing is created here. The server makes the folders in `loadConfig`; the
 * CLI, which copies them for `backup` and reports on them for `doctor`, must
 * answer the same paths without leaving empty folders behind, so both go
 * through this one function. An exported-but-empty variable counts as unset:
 * `mkdir ''` is nobody's intention.
 */
export function resolveDirs(env: NodeJS.ProcessEnv = process.env): {
  libraryDir: string
  dataDir: string
} {
  const defaults = defaultDirs({ profile: env['SELFMP3_PROFILE'] ?? '' })
  return {
    libraryDir: env['SELFMP3_LIBRARY_DIR'] || defaults.libraryDir,
    dataDir: env['SELFMP3_DATA_DIR'] || defaults.dataDir,
  }
}

const BooleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform(value =>
    typeof value === 'boolean' ? value : value === 'true' || value === '1' || value === 'yes',
  )

const ConfigSchema = z.object({
  /** Port the API listens on. */
  port: z.coerce.number().int().min(1).max(65535).default(DEFAULT_SERVER_PORT),

  /**
   * Bind address. Defaults to all interfaces because the addresses those
   * interfaces give it are how a device signed in to the bucket finds this
   * server at all (`services/addresses.ts`); what keeps the rest of the network
   * out is the token, not the bind address. Set to 127.0.0.1 to restrict to
   * this machine, at the cost of importing from anywhere else.
   */
  host: z.string().default('0.0.0.0'),

  /**
   * One more address this server can be reached at, which it cannot work out
   * for itself: a tunnel's hostname, or anything else in front of it.
   *
   * Every address the server publishes into the bucket is one it found on a
   * network interface, which means every one is local and every one is
   * `http://`. A device finds the server by trying them (`reach.ts`), so away
   * from the house there is nothing to try — and a page served over HTTPS may
   * not call an `http://` address at all, so even on the same Wi-Fi the
   * published site can never reach a LAN address. Both of those are why this
   * exists, and why it wants to be an `https://` URL.
   *
   * It is published beside the local ones rather than instead of them: the
   * addresses are raced, so a device at home still takes the fast local route
   * and only a device elsewhere pays for the tunnel.
   */
  publicUrl: z
    .string()
    .trim()
    .url()
    .transform(value => value.replace(/\/+$/, ''))
    .nullable()
    .default(null),

  /** Where the audio files live. `readEnv` always supplies it (`resolveDirs`). */
  libraryDir: z.string().min(1),

  /** Where the database and derived assets (cover art) live. Likewise. */
  dataDir: z.string().min(1),

  /**
   * A token of your own, instead of the one the server makes for itself.
   *
   * Null here does not mean "no token": it means nothing was chosen, and
   * `createContainer` fills it in from the database — made on the first boot
   * that finds none (`repositories/auth.ts`). So this is null only between
   * `loadConfig` and the container, and `container.config.authToken` is the one
   * to read. Clients send it as `Authorization: Bearer <token>`.
   */
  authToken: z.string().min(8).nullable().default(null),

  /** Origins allowed to call the API. Empty means same-origin only. */
  corsOrigins: z
    .string()
    .default('')
    .transform(value =>
      value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    ),

  storageDriver: z.enum(['local', 's3']).default('local'),

  /** Only read when storageDriver is 's3'. */
  s3: z
    .object({
      bucket: z.string().default(''),
      region: z.string().default('auto'),
      endpoint: z.string().default(''),
      accessKeyId: z.string().default(''),
      secretAccessKey: z.string().default(''),
      /** Seconds a presigned stream URL stays valid. */
      signedUrlTtl: z.coerce.number().int().min(60).max(86_400).default(3600),
    })
    .default({}),

  /**
   * The doorman this server signs in to the cloud through (docs/SYNC.md). Empty
   * means none: the bucket can then only be connected directly, with its key.
   */
  doormanUrl: z
    .string()
    .trim()
    .default(DEFAULT_DOORMAN_URL)
    .refine(value => value === '' || /^https?:\/\/[^/]+\/?$/.test(value), {
      message: 'must be an address like https://selfmp3-doorman.you.workers.dev',
    })
    .transform(value => value.replace(/\/+$/, '')),

  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  /** Scan the library folder at boot. Disable for a faster start on huge libraries. */
  scanOnBoot: BooleanFromEnv.default(true),
})

export type Config = Readonly<z.infer<typeof ConfigSchema>>

/**
 * Where a file waits before it belongs to the library: yt-dlp writes its
 * downloads here, and analysis fetches object-storage files here so ffmpeg has
 * a real path. Named once so the two never end up looking in different folders.
 */
export function stagingDir(config: Pick<Config, 'dataDir'>): string {
  return path.join(config.dataDir, 'incoming')
}

function readEnv(): unknown {
  const env = process.env
  return {
    port: env['SELFMP3_PORT'] ?? undefined,
    host: env['SELFMP3_HOST'] ?? undefined,
    publicUrl: env['SELFMP3_PUBLIC_URL'] || undefined,
    // Resolved here rather than as schema defaults so a profile set by `.env`
    // (read just before this) chooses the folders too, not only one exported.
    ...resolveDirs(env),
    authToken: env['SELFMP3_AUTH_TOKEN'] ?? undefined,
    corsOrigins: env['SELFMP3_CORS_ORIGINS'] ?? undefined,
    storageDriver: env['SELFMP3_STORAGE_DRIVER'] ?? undefined,
    s3: {
      bucket: env['SELFMP3_S3_BUCKET'] ?? undefined,
      region: env['SELFMP3_S3_REGION'] ?? undefined,
      endpoint: env['SELFMP3_S3_ENDPOINT'] ?? undefined,
      accessKeyId: env['SELFMP3_S3_ACCESS_KEY_ID'] ?? undefined,
      secretAccessKey: env['SELFMP3_S3_SECRET_ACCESS_KEY'] ?? undefined,
      signedUrlTtl: env['SELFMP3_S3_SIGNED_URL_TTL'] ?? undefined,
    },
    doormanUrl: env['SELFMP3_DOORMAN_URL'] ?? undefined,
    logLevel: env['SELFMP3_LOG_LEVEL'] ?? undefined,
    scanOnBoot: env['SELFMP3_SCAN_ON_BOOT'] ?? undefined,
  }
}

/** Strip undefined so zod applies its defaults rather than seeing an explicit undefined. */
function prune(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (inner === undefined) continue
    const cleaned = prune(inner)
    if (cleaned === undefined) continue
    if (typeof cleaned === 'object' && cleaned !== null && Object.keys(cleaned).length === 0) {
      continue
    }
    out[key] = cleaned
  }
  return out
}

export function loadConfig(): Config {
  // This machine's `.env`, from this checkout or the main one, under whatever
  // the shell already set (dotenv.ts).
  loadDotEnv()
  const parsed = ConfigSchema.safeParse(prune(readEnv()))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid configuration:\n${issues}`)
  }

  const config = parsed.data

  if (config.storageDriver === 's3' && !config.s3.bucket) {
    throw new Error('SELFMP3_STORAGE_DRIVER=s3 requires SELFMP3_S3_BUCKET to be set')
  }

  for (const dir of [config.libraryDir, config.dataDir, path.join(config.dataDir, 'covers')]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return Object.freeze(config)
}

/**
 * The version in `package.json`, read once. `createRequire` rather than a JSON
 * import so the same line works from `src/` under tsx and from `dist/` after a
 * build, without an import attribute the bundler would have to understand.
 */
export const APP_VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version
export const APP_NAME = 'self.mp3'

/**
 * What this server calls itself when it asks a public database for something.
 * lrclib and MusicBrainz both ask for a contact URL in the User-Agent so they
 * can reach whoever is hammering them, so it is the repository, named once.
 */
export const USER_AGENT = `${APP_NAME}/${APP_VERSION} (personal music library; https://github.com/Xiao215/selfmp3)`
