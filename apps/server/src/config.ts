import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DEFAULT_DOORMAN_URL } from '@selfmp3/shared'

/**
 * Configuration is read once, validated once, and frozen.
 *
 * A typo in an environment variable fails at boot with a readable message
 * instead of surfacing as `undefined` three layers deep at 2am.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** dist/ -> apps/server -> apps -> repo root. Works from source and from build. */
const REPO_ROOT = path.resolve(HERE, '../../..')

/** A folder name, so not the `self.mp3` of the wordmark: a dot reads as a suffix. */
const APP_DIR_NAME = 'selfmp3'

/**
 * Where your music and your database live, when nothing says otherwise.
 *
 * They used to default to `library/` and `data/` inside the checkout, which
 * made a person's entire collection live in the folder they are told to
 * `git pull` in — and tied it to one clone, so a second checkout or a git
 * worktree came up as an empty library rather than as the same one. It is
 * also the reason an installer cannot simply be bolted on: there is no
 * "the app" to install, only the folder you happened to clone into.
 *
 * So the default is now a place of their own, outside any checkout. Two
 * places, because they are different kinds of thing: the music goes under
 * `~/Music`, where you can open it in Finder and drag things in — the
 * watched folder expects exactly that — and the database and the artwork
 * derived from it go where a Mac keeps application data.
 *
 * **An existing checkout keeps its folders.** If `library/` is already there
 * it is still the library, and nothing moves on its own: a server that
 * silently relocated forty gigabytes of somebody's music at boot would be a
 * far worse bug than the one this fixes. `docs/INSTALL.md` says how to move
 * them deliberately. Docker sets both variables explicitly and is unaffected.
 */
export function defaultDirs({
  repoRoot = REPO_ROOT,
  home = os.homedir(),
  platform = process.platform,
  exists = fs.existsSync,
  profile = process.env['SELFMP3_PROFILE'] ?? '',
}: {
  repoRoot?: string
  home?: string
  platform?: NodeJS.Platform
  exists?: (dir: string) => boolean
  profile?: string
} = {}): { libraryDir: string; dataDir: string } {
  // A profile is a whole separate installation — its own music, its own
  // database, and so its own cloud sign-in, since that lives in the database.
  // It is how you work on the code without the real library being what you
  // work on. `npm run dev` sets it, so the dev server can never be pointed at
  // your own collection by accident.
  const suffix = profileSuffix(profile)

  const inRepo = { libraryDir: path.join(repoRoot, 'library'), dataDir: path.join(repoRoot, 'data') }
  // Only an existing library keeps the old spot, and only for the real one:
  // asking for a profile means asking not to be here. `data/` follows the
  // music, so the database and what it describes are never split across homes.
  if (!suffix && exists(inRepo.libraryDir)) return inRepo

  const dir = APP_DIR_NAME + suffix
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

const DEFAULT_DIRS = defaultDirs()

const BooleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform(value =>
    typeof value === 'boolean' ? value : value === 'true' || value === '1' || value === 'yes',
  )

const ConfigSchema = z.object({
  /** Port the API listens on. */
  port: z.coerce.number().int().min(1).max(65535).default(4600),

  /**
   * Bind address. Defaults to all interfaces because the intended deployment
   * is behind Tailscale, where "all interfaces" still means "only my devices".
   * Set to 127.0.0.1 to restrict to this machine.
   */
  host: z.string().default('0.0.0.0'),

  /** Where the audio files live. */
  libraryDir: z.string().default(DEFAULT_DIRS.libraryDir),

  /** Where the database and derived assets (cover art) live. */
  dataDir: z.string().default(DEFAULT_DIRS.dataDir),

  /** Serve the built web app from the API process (what you want in production). */
  serveWeb: BooleanFromEnv.default(true),
  webDir: z.string().default(path.join(REPO_ROOT, 'apps/web/dist')),

  /**
   * Optional shared secret. Tailscale already restricts who can reach the
   * server, so this is defence in depth rather than the primary control.
   * When set, clients must send `Authorization: Bearer <token>`.
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
   * The doorman this Mac signs in to the cloud through (docs/SYNC.md). Empty
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

function readEnv(): unknown {
  const env = process.env
  return {
    port: env['SELFMP3_PORT'] ?? undefined,
    host: env['SELFMP3_HOST'] ?? undefined,
    libraryDir: env['SELFMP3_LIBRARY_DIR'] ?? undefined,
    dataDir: env['SELFMP3_DATA_DIR'] ?? undefined,
    serveWeb: env['SELFMP3_SERVE_WEB'] ?? undefined,
    webDir: env['SELFMP3_WEB_DIR'] ?? undefined,
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

export const APP_VERSION = '1.0.0'
export const APP_NAME = 'self.mp3'
export { REPO_ROOT }
