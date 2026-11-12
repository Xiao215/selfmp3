import { DRIVE_FOLDER_NAME, FORMAT_KEY, HASH_NAMED_FOLDERS } from '@selfmp3/shared'
import { z } from 'zod'
import { keep } from './boundedCache.js'
import { fromUtf8, utf8 } from './encoding.js'
import type { GoogleTokens } from './googleTokens.js'
import { discard, readBytes } from './http.js'
import {
  StoreError,
  uploadInit,
  type Fetch,
  type FetchInit,
  type Store,
  type StoredObject,
  type Upload,
  type WriteOptions,
} from './store.js'

/**
 * One account's library in its own Google Drive: the Drive driver of the
 * doorman's `Store` (store.ts), over the Drive API v3.
 *
 * The doorman holds the `drive.file` scope and nothing wider, so it sees only
 * what it made itself: one folder, `self.mp3`, with a folder inside for each
 * of the library's own (`DRIVE_FOLDERS`), and `format.json` beside them. A
 * key's first part names the folder and the rest is the file's name there, so
 * `audio/4f1c….m4a` is the file `4f1c….m4a` in `audio`, and a log file,
 * `log/<device>/<seq>.json`, is the file `<device>/<seq>.json` in `log` —
 * Drive lets a name hold a slash, and one flat folder is one listing.
 *
 * Drive is not S3, and docs/features/storage-providers.md goes through what
 * that costs. In short:
 *
 * - **No paths.** A file is reached by its id, and a name is only something
 *   it has. So every read and write first asks which file in the folder has
 *   the name (`#find`, one call), and each Worker instance remembers the
 *   answer: the library's files never change once written, so an id stays
 *   right until the file is deleted, and a remembered id that turns out gone
 *   is simply asked for again.
 * - **Names are not unique.** Two uploads of one key at the same moment
 *   leave two files. The oldest is the file; `remove` deletes them all, and a
 *   listing names the key once.
 * - **No ETag, no Content-Encoding.** Drive keeps each file's MD5, which is
 *   what S3's ETag is for a plain upload, so a device's conditions are
 *   answered here from what `#find` learned. A snapshot's `gzip` is kept in
 *   the file's `appProperties` and said again on the way out.
 * - **Deleting is for good.** `files.delete` skips the bin, so a removed
 *   song's space comes back at once, with no rule to set as a B2 bucket needs.
 *
 * Every request carries an access token good for an hour, made from the
 * account's sealed refresh token (googleTokens.ts).
 */

/** The folders inside `self.mp3`, by the first part of the keys they hold. */
const DRIVE_FOLDERS = [...HASH_NAMED_FOLDERS, 'snapshots', 'log'] as const
type DriveFolder = (typeof DRIVE_FOLDERS)[number]

/** What a folder is, to Drive: a file of this type. */
const DRIVE_FOLDER_TYPE = 'application/vnd.google-apps.folder'

const FolderIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)

/** What is sealed for a Drive account: the way in, and where its folders are. */
export const DriveTargetSchema = z.object({
  /** Google's, for this account and this app: trades for an hour's access token. */
  refreshToken: z.string().min(1),
  /** The `self.mp3` folder, which holds `format.json` and the folders below. */
  root: FolderIdSchema,
  folders: z.object({
    audio: FolderIdSchema,
    covers: FolderIdSchema,
    lyrics: FolderIdSchema,
    snapshots: FolderIdSchema,
    log: FolderIdSchema,
  }),
})
export type DriveTarget = z.infer<typeof DriveTargetSchema>

/** What Drive said about a file that the doorman uses. */
interface DriveFile {
  readonly id: string
  readonly size: number
  /** Hex, as Drive gives it. Null for a file Drive has not hashed, which none of ours should be. */
  readonly md5: string | null
  readonly modified: string
  readonly type: string
  /** The Content-Encoding the file was uploaded with (`gzip`, a snapshot), or null. */
  readonly encoding: string | null
}

export interface DriveDeps {
  readonly fetch: Fetch
  readonly tokens: GoogleTokens
  /**
   * Files found by name, kept between requests under `<folder id>/<name>`:
   * finding one is a call to Drive, and a song is read by many requests.
   */
  readonly found: Map<string, DriveFile>
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

/** What `#find` asks Drive to say about a file. */
const FILE_FIELDS = 'id,size,md5Checksum,modifiedTime,mimeType,appProperties'

const FoundFileSchema = z.object({
  id: z.string().min(1),
  /** Drive sends an int64 as a string. Absent for a folder. */
  size: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
  md5Checksum: z.string().optional(),
  modifiedTime: z.string().optional(),
  mimeType: z.string().optional(),
  appProperties: z.object({ encoding: z.string().optional() }).optional(),
})

const FoundFilesSchema = z.object({ files: z.array(FoundFileSchema) })

const ListedFilesSchema = z.object({
  nextPageToken: z.string().optional(),
  files: z.array(
    z.object({
      name: z.string(),
      size: z
        .string()
        .regex(/^\d{1,15}$/)
        .optional(),
    }),
  ),
})

/** Drive's own error document: `{ error: { code, message, errors: [{ reason }] } }`. */
const DriveErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
})

/** A thousand names is a few hundred kilobytes of JSON; an error a few hundred bytes. */
const MAX_LISTING_BYTES = 4 * 1024 * 1024
const MAX_ANSWER_BYTES = 64 * 1024

/** As bucket.ts: everything but streaming a song gives up after this long. */
const QUICK_TIMEOUT_MS = 30_000

/** The most files Drive lists in one call. */
const PAGE_SIZE = 1000

/** How much of Drive's own words is repeated. */
const SAID_CHARACTERS = 240

/** Drive's reasons for asking for fewer requests for a while. */
const BUSY_REASONS: ReadonlySet<string> = new Set([
  'userRateLimitExceeded',
  'rateLimitExceeded',
  'dailyLimitExceeded',
  'sharingRateLimitExceeded',
  'downloadQuotaExceeded',
  'backendError',
])

/** Drive's reasons for a token that may not do what was asked. */
const AUTH_REASONS: ReadonlySet<string> = new Set([
  'authError',
  'insufficientPermissions',
  'insufficientFilePermissions',
  'appNotAuthorizedToFile',
  'domainPolicy',
])

/** The folder is gone, or Drive access was taken away: what to do is the same. */
export const DRIVE_RECONNECT = 'Connect Google Drive again in Settings.'

interface SendOptions {
  readonly headers?: Headers
  readonly body?: BodyInit | Upload
  readonly quick?: boolean
}

/** One part of a listing: a folder, and the keys in it that the prefix lets through. */
interface Section {
  readonly folder: string
  /** `audio/`, or nothing for the root. */
  readonly keyPrefix: string
  /** What a name must start with, after the folder's own part of the prefix. */
  readonly nameStarts: string
  /** The one name wanted, for the root, where only `format.json` is the library's. */
  readonly only: string | null
}

export class Drive implements Store {
  readonly #target: DriveTarget
  readonly #deps: DriveDeps

  constructor(target: DriveTarget, deps: DriveDeps) {
    this.#target = target
    this.#deps = deps
  }

  /**
   * One call to Drive per page. A prefix that spans folders — the empty one,
   * the whole library — goes through them in key order, a folder to a page at
   * least, and the cursor says which folder it is in: `<index>.<Drive's token>`.
   * Within a folder the order is Drive's own by name, which for the names the
   * library uses (digits and lower-case letters) is the order of the keys.
   */
  async list(
    prefix: string,
    cursor: string | null,
  ): Promise<{ objects: StoredObject[]; cursor: string | null }> {
    const sections = this.#sections(prefix)
    const at = parseCursor(cursor, sections.length)
    const section = sections[at.index]
    if (!section) return { objects: [], cursor: null }

    const query = new URLSearchParams({
      q: section.only
        ? `${inFolder(section.folder)} and name = ${quoted(section.only)} and trashed = false`
        : `${inFolder(section.folder)} and mimeType != ${quoted(DRIVE_FOLDER_TYPE)} and trashed = false`,
      fields: 'nextPageToken,files(name,size)',
      orderBy: 'name',
      pageSize: String(PAGE_SIZE),
      spaces: 'drive',
    })
    if (at.token) query.set('pageToken', at.token)
    const response = await this.#send('GET', `${DRIVE_API}/files?${query.toString()}`, {
      quick: true,
    })
    if (!response.ok) throw await explain(response, 'folder')
    const bytes = await readBytes(response.body, MAX_LISTING_BYTES)
    const page =
      bytes.length < MAX_LISTING_BYTES ? ListedFilesSchema.safeParse(parseJson(bytes)) : null
    if (!page?.success) {
      throw new StoreError('other', 'Google Drive answered a listing with something else.')
    }

    const objects: StoredObject[] = []
    const seen = new Set<string>()
    for (const file of page.data.files) {
      // Two files of one name are one key: the second is a write that raced the first.
      if (!file.name.startsWith(section.nameStarts) || seen.has(file.name)) continue
      seen.add(file.name)
      objects.push({ key: section.keyPrefix + file.name, size: Number(file.size ?? '0') })
    }
    const token = page.data.nextPageToken
    const next = token
      ? `${at.index}.${token}`
      : at.index + 1 < sections.length
        ? `${at.index + 1}.`
        : null
    return { objects, cursor: next }
  }

  async read(key: string, limit: number): Promise<Uint8Array | null> {
    const response = await this.#media(key, new Headers(), true)
    if (!response) return null
    if (!response.response.ok) throw await explain(response.response, 'file')
    return readBytes(response.response.body, limit)
  }

  /**
   * Bytes in hand go up in one call (a multipart upload: what the file is,
   * then the file); a stream in two (a resumable upload: Drive is told what
   * is coming, then sent it), since only that takes a body of any size without
   * the doorman reading it. Either follows the call that looks for a file
   * already under the key, which is then replaced rather than joined by a twin.
   */
  async write(key: string, body: Upload, options: WriteOptions): Promise<void> {
    const place = this.#place(key)
    const [existing] = await this.#findAll(place)
    const details = {
      mimeType: options.contentType,
      // Null clears what an earlier upload of the key said.
      appProperties: { encoding: options.contentEncoding ?? null },
      ...(existing ? {} : { name: place.name, parents: [place.folder] }),
    }
    const method = existing ? 'PATCH' : 'POST'
    const path = existing ? `/files/${encodeURIComponent(existing.id)}` : '/files'
    const fields = `fields=${encodeURIComponent(FILE_FIELDS)}`

    let response: Response
    if (body instanceof Uint8Array) {
      const boundary = `selfmp3-${crypto.randomUUID()}`
      const headers = new Headers({ 'content-type': `multipart/related; boundary=${boundary}` })
      response = await this.#send(
        method,
        `${DRIVE_UPLOAD_API}${path}?uploadType=multipart&${fields}`,
        { headers, body: multipart(boundary, details, options.contentType, body), quick: true },
      )
    } else {
      const begun = await this.#send(
        method,
        `${DRIVE_UPLOAD_API}${path}?uploadType=resumable&${fields}`,
        {
          headers: new Headers({
            'content-type': 'application/json; charset=UTF-8',
            'x-upload-content-type': options.contentType,
            'x-upload-content-length': String(body.length),
          }),
          body: JSON.stringify(details),
          quick: true,
        },
      )
      if (!begun.ok) throw await explain(begun, 'folder')
      await discard(begun)
      const session = begun.headers.get('location')
      if (!session || !session.startsWith(`${DRIVE_UPLOAD_API}/`)) {
        throw new StoreError('other', 'Google Drive did not say where to send the file.')
      }
      response = await this.#send('PUT', session, {
        headers: new Headers({ 'content-type': options.contentType }),
        body,
      })
    }
    if (!response.ok) throw await explain(response, 'folder')

    const written = FoundFileSchema.safeParse(
      parseJson(await readBytes(response.body, MAX_ANSWER_BYTES)),
    )
    if (written.success) keep(this.#deps.found, cacheKey(place), fileFrom(written.data))
    else this.#deps.found.delete(cacheKey(place))
  }

  async remove(key: string): Promise<void> {
    const place = this.#place(key)
    const files = await this.#findAll(place)
    this.#deps.found.delete(cacheKey(place))
    for (const file of files) {
      const response = await this.#send(
        'DELETE',
        `${DRIVE_API}/files/${encodeURIComponent(file.id)}`,
        { quick: true },
      )
      if (response.status !== 404 && !response.ok) throw await explain(response, 'file')
      await discard(response)
    }
  }

  /**
   * What Drive knows of the file answers a HEAD and a device's conditions
   * without the file being read at all; only a GET that is still wanted after
   * them asks for the bytes, with the device's Range.
   */
  async fetchObject(
    method: 'GET' | 'HEAD',
    key: string,
    forward: Headers,
  ): Promise<Response | null> {
    const file = await this.#find(this.#place(key))
    if (!file) return null
    const etag = file.md5 ? `"${file.md5}"` : null
    const headers = describe(file, etag)

    const unlessMatch = forward.get('if-none-match')
    if (unlessMatch !== null && etag !== null && namesTag(unlessMatch, etag)) {
      return new Response(null, { status: 304, headers })
    }
    const onlyIfMatch = forward.get('if-match')
    if (onlyIfMatch !== null && !(etag !== null && namesTag(onlyIfMatch, etag))) {
      return new Response(null, { status: 412, headers })
    }
    if (method === 'HEAD') {
      headers.set('content-length', String(file.size))
      return new Response(null, { status: 200, headers })
    }

    const asked = new Headers()
    const range = forward.get('range')
    const ifRange = forward.get('if-range')
    // A range is only good for the file the device began with, which it names
    // by the tag or, as a phone's own downloader may, by the date.
    const sameFile =
      ifRange === null || ifRange === etag || ifRange === headers.get('last-modified')
    if (range !== null && sameFile) asked.set('range', range)

    const found = await this.#media(key, asked, false)
    if (!found) return null
    const { response } = found
    if (response.status === 416) {
      await discard(response)
      headers.set('content-range', response.headers.get('content-range') ?? `bytes */${file.size}`)
      return new Response(null, { status: 416, headers })
    }
    if (response.status !== 200 && response.status !== 206) {
      throw await explain(response, 'file')
    }
    // The file may have been found again under a new id: say what is true of this one.
    const sent = found.file === file ? headers : describe(found.file, etagOf(found.file))
    const contentRange = response.headers.get('content-range')
    if (contentRange !== null) sent.set('content-range', contentRange)
    // Worked out, not Drive's own: were Google to compress the bytes on their
    // way here, the runtime would hand them on inflated under a length that
    // was the compressed one's.
    sent.set(
      'content-length',
      String(response.status === 206 ? rangeLength(contentRange) : found.file.size),
    )
    return new Response(response.body, { status: response.status, headers: sent })
  }

  /**
   * The file's bytes from Drive, and what was known of it when they were asked
   * for. An id remembered from before may be a file since deleted — and
   * perhaps written again, under a new id — so a 404 for a remembered id is
   * looked for once more by name before the file is called missing.
   */
  async #media(
    key: string,
    headers: Headers,
    quick: boolean,
  ): Promise<{ response: Response; file: DriveFile } | null> {
    const place = this.#place(key)
    for (const fresh of [false, true]) {
      const remembered = this.#deps.found.has(cacheKey(place))
      const file = await this.#find(place)
      if (!file) return null
      const response = await this.#send(
        'GET',
        `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`,
        { headers, quick },
      )
      if (response.status !== 404) return { response, file }
      await discard(response)
      this.#deps.found.delete(cacheKey(place))
      if (fresh || !remembered) return null
    }
    return null
  }

  /** The file under a key, from memory or from Drive, or null when there is none. */
  async #find(place: Place): Promise<DriveFile | null> {
    const remembered = this.#deps.found.get(cacheKey(place))
    if (remembered) return remembered
    const [file] = await this.#findAll(place)
    if (!file) return null
    keep(this.#deps.found, cacheKey(place), file)
    return file
  }

  /** Every file in the folder with the name, oldest first: the first is the file. */
  async #findAll(place: Place): Promise<DriveFile[]> {
    const query = new URLSearchParams({
      q: `${inFolder(place.folder)} and name = ${quoted(place.name)} and trashed = false`,
      fields: `files(${FILE_FIELDS})`,
      orderBy: 'createdTime',
      pageSize: '10',
      spaces: 'drive',
    })
    const response = await this.#send('GET', `${DRIVE_API}/files?${query.toString()}`, {
      quick: true,
    })
    if (!response.ok) throw await explain(response, 'folder')
    const found = FoundFilesSchema.safeParse(
      parseJson(await readBytes(response.body, MAX_ANSWER_BYTES)),
    )
    if (!found.success) {
      throw new StoreError('other', 'Google Drive answered a search with something else.')
    }
    return found.data.files.map(fileFrom)
  }

  /**
   * A request to Drive with the account's access token. A token Drive no
   * longer takes (401) is forgotten and made again, once: tokens last an hour
   * and an instance can hold one a moment too long.
   */
  async #send(method: string, url: string, options: SendOptions = {}): Promise<Response> {
    const { refreshToken } = this.#target
    for (const again of [false, true]) {
      const headers = new Headers(options.headers)
      headers.set('authorization', `Bearer ${await this.#deps.tokens.access(refreshToken)}`)
      const init: FetchInit = { method, headers, redirect: 'manual', cache: 'no-store' }
      if (options.quick) init.signal = AbortSignal.timeout(QUICK_TIMEOUT_MS)
      const { body } = options
      if (typeof body === 'string') init.body = body
      else if (body !== undefined) Object.assign(init, uploadInit(body as Upload, headers))

      let response: Response
      try {
        response = await this.#deps.fetch(url, init)
      } catch {
        throw new StoreError('network', 'Could not reach Google Drive.')
      }
      // A stream cannot be sent twice; its 401 is explained as it is.
      const resendable =
        body === undefined || typeof body === 'string' || body instanceof Uint8Array
      if (response.status !== 401 || again || !resendable) return response
      await discard(response)
      await this.#deps.tokens.forget(refreshToken)
    }
    throw new StoreError('auth', `Google Drive refused self.mp3. ${DRIVE_RECONNECT}`)
  }

  #place(key: string): Place {
    const slash = key.indexOf('/')
    if (slash === -1) return { folder: this.#target.root, name: key }
    const folder = this.#folder(key.slice(0, slash))
    if (!folder) throw new StoreError('other', 'That file has no folder in Google Drive.')
    return { folder, name: key.slice(slash + 1) }
  }

  #folder(name: string): string | null {
    return isDriveFolder(name) ? this.#target.folders[name] : null
  }

  /** The folders a prefix reaches, in the order their keys sort. */
  #sections(prefix: string): Section[] {
    const all: Section[] = [
      ...DRIVE_FOLDERS.map(name => ({
        folder: this.#target.folders[name],
        keyPrefix: `${name}/`,
        nameStarts: '',
        only: null,
      })),
      { folder: this.#target.root, keyPrefix: '', nameStarts: '', only: FORMAT_KEY },
    ].sort((a, b) => ((a.keyPrefix || FORMAT_KEY) < (b.keyPrefix || FORMAT_KEY) ? -1 : 1))
    return all.flatMap(section => {
      const first = section.keyPrefix || FORMAT_KEY
      if (first.startsWith(prefix)) return [section]
      if (section.keyPrefix && prefix.startsWith(section.keyPrefix)) {
        return [{ ...section, nameStarts: prefix.slice(section.keyPrefix.length) }]
      }
      return []
    })
  }
}

/**
 * How the doorman knows its own folder again: a mark only it can see, kept
 * with the folder, so renaming or moving the folder in Drive loses nothing.
 */
const LIBRARY_MARK = { key: 'selfmp3', value: 'library' } as const

const FoldersSchema = z.object({
  files: z.array(z.object({ id: FolderIdSchema, name: z.string().optional() })),
})

/**
 * The `self.mp3` folder in an account's Drive and the folders inside it,
 * found or made: what connecting Google Drive keeps (driveConnect.ts).
 *
 * An account that connected before finds its folder again by the mark, with
 * the library still in it, so disconnecting and connecting again — or
 * connecting from a second device — never starts a second library. Of two
 * folders with the mark, or two of one name inside, the oldest is the one.
 */
export async function prepareDrive(refreshToken: string, deps: DriveDeps): Promise<DriveTarget> {
  const send = async (method: string, url: string, body?: unknown): Promise<unknown> => {
    const headers = new Headers({
      authorization: `Bearer ${await deps.tokens.access(refreshToken)}`,
    })
    const init: FetchInit = {
      method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(QUICK_TIMEOUT_MS),
    }
    if (body !== undefined) {
      headers.set('content-type', 'application/json; charset=UTF-8')
      init.body = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await deps.fetch(url, init)
    } catch {
      throw new StoreError('network', 'Could not reach Google Drive.')
    }
    if (!response.ok) throw await explain(response, 'folder')
    return parseJson(await readBytes(response.body, MAX_ANSWER_BYTES))
  }
  const folders = async (q: string): Promise<z.infer<typeof FoldersSchema>['files']> => {
    const query = new URLSearchParams({
      q: `${q} and mimeType = ${quoted(DRIVE_FOLDER_TYPE)} and trashed = false`,
      fields: 'files(id,name)',
      orderBy: 'createdTime',
      pageSize: '100',
      spaces: 'drive',
    })
    const found = FoldersSchema.safeParse(
      await send('GET', `${DRIVE_API}/files?${query.toString()}`),
    )
    if (!found.success) {
      throw new StoreError('other', 'Google Drive answered a search with something else.')
    }
    return found.data.files
  }
  const make = async (details: Record<string, unknown>): Promise<string> => {
    const made = z.object({ id: FolderIdSchema }).safeParse(
      await send('POST', `${DRIVE_API}/files?fields=id`, {
        ...details,
        mimeType: DRIVE_FOLDER_TYPE,
      }),
    )
    if (!made.success) throw new StoreError('other', 'Google Drive did not make the folder.')
    return made.data.id
  }

  const [marked] = await folders(
    `appProperties has { key=${quoted(LIBRARY_MARK.key)} and value=${quoted(LIBRARY_MARK.value)} }`,
  )
  const root =
    marked?.id ??
    (await make({
      name: DRIVE_FOLDER_NAME,
      appProperties: { [LIBRARY_MARK.key]: LIBRARY_MARK.value },
    }))

  const inside = marked ? await folders(inFolder(root)) : []
  const ids = await Promise.all(
    DRIVE_FOLDERS.map(
      async name =>
        inside.find(folder => folder.name === name)?.id ?? make({ name, parents: [root] }),
    ),
  )
  const [audio = '', covers = '', lyrics = '', snapshots = '', log = ''] = ids
  return { refreshToken, root, folders: { audio, covers, lyrics, snapshots, log } }
}

/**
 * Turn a refusal into a message that says what to do about it. `what` is
 * what a 404 means here: a folder the request was made in, or the file itself.
 */
async function explain(response: Response, what: 'folder' | 'file'): Promise<StoreError> {
  const parsed = DriveErrorSchema.safeParse(
    parseJson(await readBytes(response.body, MAX_ANSWER_BYTES)),
  )
  const reason = parsed.success ? (parsed.data.error.errors?.[0]?.reason ?? null) : null
  const message = parsed.success ? (parsed.data.error.message?.trim() ?? '') : ''
  const said = (message || reason || `it answered ${response.status}`).slice(0, SAID_CHARACTERS)
  const { status } = response

  if (reason === 'storageQuotaExceeded' || reason === 'teamDriveFileLimitExceeded') {
    return new StoreError(
      'full',
      'Your Google storage is full. Free some space, or get more at one.google.com/storage.',
    )
  }
  if (status === 429 || status >= 500 || (reason !== null && BUSY_REASONS.has(reason))) {
    return new StoreError('busy', `Google Drive is busy: ${said}`)
  }
  if (status === 401 || (reason !== null && AUTH_REASONS.has(reason))) {
    return new StoreError('auth', `Google Drive refused self.mp3 (${said}). ${DRIVE_RECONNECT}`)
  }
  if (status === 404 && what === 'folder') {
    return new StoreError(
      'missing',
      `The self.mp3 folder is no longer in your Google Drive. ${DRIVE_RECONNECT}`,
    )
  }
  return new StoreError('other', `Google Drive: ${said}`)
}

interface Place {
  readonly folder: string
  readonly name: string
}

function cacheKey(place: Place): string {
  return `${place.folder}/${place.name}`
}

function isDriveFolder(name: string): name is DriveFolder {
  return (DRIVE_FOLDERS as readonly string[]).includes(name)
}

/** `'<id>' in parents`, for a search: the files directly in a folder. */
function inFolder(id: string): string {
  return `${quoted(id)} in parents`
}

/** A string in Drive's search language: single quotes, with `\` and `'` escaped. */
function quoted(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function fileFrom(found: z.infer<typeof FoundFileSchema>): DriveFile {
  return {
    id: found.id,
    size: Number(found.size ?? '0'),
    md5: found.md5Checksum ?? null,
    modified: found.modifiedTime ?? '',
    type: found.mimeType ?? 'application/octet-stream',
    encoding: found.appProperties?.encoding ?? null,
  }
}

function etagOf(file: DriveFile): string | null {
  return file.md5 ? `"${file.md5}"` : null
}

/** What a bucket would say of the file in its headers, from what Drive keeps. */
function describe(file: DriveFile, etag: string | null): Headers {
  const headers = new Headers({ 'content-type': file.type, 'accept-ranges': 'bytes' })
  if (etag !== null) headers.set('etag', etag)
  if (file.encoding !== null) headers.set('content-encoding', file.encoding)
  const modified = Date.parse(file.modified)
  if (!Number.isNaN(modified)) headers.set('last-modified', new Date(modified).toUTCString())
  return headers
}

/** Whether an If-Match or If-None-Match names the tag: `*`, or one of a list, weak or not. */
function namesTag(condition: string, etag: string): boolean {
  return condition
    .split(',')
    .map(each => each.trim().replace(/^W\//, ''))
    .some(each => each === '*' || each === etag)
}

/** The bytes in `bytes 0-99/1234`: a hundred. */
function rangeLength(contentRange: string | null): number {
  const match = /^bytes (\d+)-(\d+)\//.exec(contentRange ?? '')
  return match ? Number(match[2]) - Number(match[1]) + 1 : 0
}

/** `<index>.<token>`, as `list` writes it. Anything else starts from the beginning. */
function parseCursor(cursor: string | null, sections: number): { index: number; token: string } {
  const match = /^(\d{1,2})\.(.*)$/s.exec(cursor ?? '')
  const index = match ? Number(match[1]) : 0
  if (cursor !== null && (!match || index >= sections)) {
    throw new StoreError('other', 'That is not a cursor from a listing.')
  }
  return { index, token: match?.[2] ?? '' }
}

/** A multipart upload's body: what the file is, as JSON, then its bytes. */
function multipart(
  boundary: string,
  details: unknown,
  contentType: string,
  bytes: Uint8Array,
): Uint8Array {
  const head = utf8(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(details)}\r\n--${boundary}\r\ncontent-type: ${contentType}\r\n\r\n`,
  )
  const tail = utf8(`\r\n--${boundary}--`)
  const body = new Uint8Array(head.length + bytes.length + tail.length)
  body.set(head, 0)
  body.set(bytes, head.length)
  body.set(tail, head.length + bytes.length)
  return body
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(fromUtf8(bytes))
  } catch {
    return null
  }
}
