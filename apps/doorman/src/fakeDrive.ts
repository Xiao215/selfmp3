import { utf8 } from './encoding.js'
import type { SeenRequest } from './fakeBucket.js'

/**
 * The Google Drive the doorman's tests run against (fakes.ts wires it in):
 * the Drive API v3, in memory, as much of it as drive.ts uses and no more.
 *
 * It answers the way Drive does — files reached by id, names that need not be
 * unique, searches in Drive's own language, uploads in two shapes, ranges —
 * and refuses what Drive would: a request without a live access token, a
 * search it cannot read, an upload whose length is not the one promised. So
 * a test that passes has sent requests Drive would take, not merely requests
 * that look right. A search clause the fake does not know is a 400, which
 * keeps the driver from quietly leaning on something never checked here.
 */

export const DRIVE_HOST = 'www.googleapis.com'
const FOLDER_TYPE = 'application/vnd.google-apps.folder'

interface DriveFile {
  readonly id: string
  name: string
  parents: string[]
  mimeType: string
  appProperties: Record<string, string>
  body: Uint8Array
  md5Checksum: string
  readonly createdTime: string
  modifiedTime: string
  trashed: boolean
}

interface UploadSession {
  /** The file to replace, or null to make one. */
  readonly id: string | null
  readonly details: Details
  readonly contentType: string | null
  readonly length: number | null
  readonly fields: string | null
}

/** What a request says a file is, as far as the fake reads it. */
interface Details {
  readonly name?: unknown
  readonly parents?: unknown
  readonly mimeType?: unknown
  readonly appProperties?: unknown
}

type Clause = (file: DriveFile) => boolean

export class FakeDrive {
  readonly files = new Map<string, DriveFile>()
  readonly requests: SeenRequest[] = []
  /** Files listed per page; Drive's own most is a thousand. */
  pageSize = 1000
  /** Drive asks for fewer requests: everything is answered 403 userRateLimitExceeded. */
  busy = false
  /** The account's Google storage is full: uploads are refused. */
  full = false
  /** An upload is answered with Drive's default few fields, whatever was asked for. */
  terse = false
  /** The clock files are stamped by, a millisecond on for each. */
  #time = Date.parse('2026-09-11T12:00:00Z')
  #ids = 0
  #hashes = 0
  readonly #sessions = new Map<string, UploadSession>()
  readonly #accepts: (accessToken: string) => boolean

  /** `accepts` says whether an access token is one Google gave and still good. */
  constructor(accepts: (accessToken: string) => boolean) {
    this.#accepts = accepts
  }

  /** The file a key names in a library whose root folder is `root`, or null. */
  find(root: string, key: string): DriveFile | null {
    return this.all(root, key)[0] ?? null
  }

  /** Every file a key names, oldest first: more than one when two writes raced. */
  all(root: string, key: string): DriveFile[] {
    const slash = key.indexOf('/')
    const folder =
      slash === -1
        ? root
        : [...this.files.values()].find(
            file =>
              file.mimeType === FOLDER_TYPE &&
              file.parents.includes(root) &&
              file.name === key.slice(0, slash),
          )?.id
    const name = slash === -1 ? key : key.slice(slash + 1)
    return [...this.files.values()].filter(
      file => folder !== undefined && file.parents.includes(folder) && file.name === name,
    )
  }

  text(root: string, key: string): string | null {
    const file = this.find(root, key)
    return file ? new TextDecoder().decode(file.body) : null
  }

  /** A file put there behind the doorman's back, as a second upload racing the first would. */
  add(parent: string, name: string, body: Uint8Array | string, mimeType = 'text/plain'): string {
    return this.#create(
      { name, parents: [parent], mimeType },
      typeof body === 'string' ? utf8(body) : body,
    ).id
  }

  /**
   * Move a file or folder to the bin, as a person does in Drive: it and all
   * inside it are still there by id, and no longer turn up in a search.
   */
  bin(id: string): void {
    const file = this.files.get(id)
    if (!file) return
    file.trashed = true
    for (const inside of [...this.files.values()]) {
      if (inside.parents.includes(id) && !inside.trashed) this.bin(inside.id)
    }
  }

  /** Every folder marked as a library's root, oldest first. */
  roots(): DriveFile[] {
    return [...this.files.values()].filter(
      file => file.mimeType === FOLDER_TYPE && file.appProperties['selfmp3'] === 'library',
    )
  }

  async handle(incoming: Request): Promise<Response> {
    const url = new URL(incoming.url)
    this.requests.push({ method: incoming.method, url, headers: new Headers(incoming.headers) })

    const token = /^Bearer (.+)$/.exec(incoming.headers.get('authorization') ?? '')?.[1]
    if (!token || !this.#accepts(token)) {
      return driveError(401, 'authError', 'Invalid Credentials')
    }
    if (this.busy) return driveError(403, 'userRateLimitExceeded', 'User rate limit exceeded.')

    const { pathname } = url
    if (pathname === '/upload/drive/v3/files' || pathname.startsWith('/upload/drive/v3/files/')) {
      return this.#upload(incoming, url, pathname.slice('/upload/drive/v3/files'.length + 1))
    }
    if (pathname === '/drive/v3/files') {
      if (incoming.method === 'GET') return this.#search(url.searchParams)
      if (incoming.method === 'POST') {
        const details = (await incoming.json().catch(() => null)) as Details | null
        if (!details) return driveError(400, 'parseError', 'Parse Error')
        const missing = this.#missingParent(details)
        if (missing) return missing
        return json(pick(this.#create(details, new Uint8Array(0)), url.searchParams.get('fields')))
      }
    }
    const id = /^\/drive\/v3\/files\/([^/]+)$/.exec(pathname)?.[1]
    if (id) {
      const file = this.files.get(decodeURIComponent(id))
      if (!file) return driveError(404, 'notFound', `File not found: ${id}.`)
      if (incoming.method === 'DELETE') {
        this.files.delete(file.id)
        return new Response(null, { status: 204 })
      }
      if (incoming.method === 'GET' && url.searchParams.get('alt') === 'media') {
        return media(file, incoming.headers.get('range'))
      }
      if (incoming.method === 'GET') return json(pick(file, url.searchParams.get('fields')))
    }
    return driveError(404, 'notFound', 'Not Found')
  }

  #create(details: Details, body: Uint8Array): DriveFile {
    const stamp = new Date(this.#time++).toISOString()
    const file: DriveFile = {
      id: `1dr-${++this.#ids}_Id`,
      name: typeof details.name === 'string' ? details.name : 'Untitled',
      parents: Array.isArray(details.parents) ? (details.parents as string[]) : ['root'],
      mimeType:
        typeof details.mimeType === 'string' ? details.mimeType : 'application/octet-stream',
      appProperties: {},
      body,
      md5Checksum: `md5${++this.#hashes}`.padEnd(32, '0'),
      createdTime: stamp,
      modifiedTime: stamp,
      trashed: false,
    }
    setProperties(file, details.appProperties)
    this.files.set(file.id, file)
    return file
  }

  #missingParent(details: Details): Response | null {
    const parents = Array.isArray(details.parents) ? (details.parents as string[]) : []
    const gone = parents.find(parent => !this.files.has(parent))
    return gone ? driveError(404, 'notFound', `File not found: ${gone}.`) : null
  }

  #search(params: URLSearchParams): Response {
    const clauses = parseQuery(params.get('q') ?? '', id => this.files.has(id))
    if (clauses instanceof Response) return clauses
    const orderBy = params.get('orderBy')
    if (orderBy !== null && orderBy !== 'name' && orderBy !== 'createdTime') {
      return driveError(400, 'invalid', `Invalid orderBy: ${orderBy}`)
    }
    const found = [...this.files.values()]
      .filter(file => clauses.every(clause => clause(file)))
      .sort((a, b) =>
        orderBy === 'name'
          ? a.name.localeCompare(b.name) || a.createdTime.localeCompare(b.createdTime)
          : a.createdTime.localeCompare(b.createdTime),
      )
    const size = Math.min(Number(params.get('pageSize') ?? '100'), this.pageSize)
    // A token with characters that must survive a query string and a cursor.
    const token = params.get('pageToken')
    const start = token ? Number(/^~!AP\/(\d+)==$/.exec(token)?.[1] ?? Number.NaN) : 0
    if (Number.isNaN(start)) return driveError(400, 'invalid', 'Invalid Value')
    const page = found.slice(start, start + size)
    const fields = params.get('fields') ?? 'files(id,name,mimeType)'
    const inner = /files\(([^)]*)\)/.exec(fields)?.[1] ?? null
    return json({
      ...(start + size < found.length && fields.includes('nextPageToken')
        ? { nextPageToken: `~!AP/${start + size}==` }
        : {}),
      files: page.map(file => pick(file, inner)),
    })
  }

  async #upload(incoming: Request, url: URL, pathId: string): Promise<Response> {
    const kind = url.searchParams.get('uploadType')
    const session = url.searchParams.get('upload_id')
    const fields = url.searchParams.get('fields')
    const target = pathId ? decodeURIComponent(pathId) : null

    if (session !== null) {
      const begun = this.#sessions.get(session)
      if (incoming.method !== 'PUT' || !begun) return driveError(404, 'notFound', 'Not Found')
      const body = new Uint8Array(await incoming.arrayBuffer())
      const sent = incoming.headers.get('content-length')
      if (sent === null || Number(sent) !== body.length || begun.length !== body.length) {
        return driveError(
          400,
          'badRequest',
          'Invalid request. The upload is not the size promised.',
        )
      }
      this.#sessions.delete(session)
      return this.#store(begun.id, begun.details, begun.contentType, body, begun.fields)
    }

    const making = incoming.method === 'POST' && target === null
    const replacing = incoming.method === 'PATCH' && target !== null
    if (!making && !replacing) return driveError(404, 'notFound', 'Not Found')
    if (target !== null && !this.files.has(target)) {
      return driveError(404, 'notFound', `File not found: ${target}.`)
    }

    if (kind === 'resumable') {
      const details = (await incoming.json().catch(() => null)) as Details | null
      if (!details) return driveError(400, 'parseError', 'Parse Error')
      const missing = this.#missingParent(details)
      if (missing) return missing
      if (this.full) return storageFull()
      const length = incoming.headers.get('x-upload-content-length')
      const id = `upl-${this.#sessions.size + 1}-${this.requests.length}`
      this.#sessions.set(id, {
        id: target,
        details,
        contentType: incoming.headers.get('x-upload-content-type'),
        length: length === null ? null : Number(length),
        fields,
      })
      const location = new URL(url)
      location.searchParams.set('upload_id', id)
      return new Response(null, { status: 200, headers: { location: location.toString() } })
    }

    if (kind === 'multipart') {
      const boundary = /boundary=([^;]+)/.exec(incoming.headers.get('content-type') ?? '')?.[1]
      const parts = boundary
        ? splitMultipart(new Uint8Array(await incoming.arrayBuffer()), boundary)
        : null
      const [first, second] = parts ?? []
      if (!first || !second || parts?.length !== 2) {
        return driveError(400, 'badRequest', 'Bad multipart body.')
      }
      let details: Details
      try {
        details = JSON.parse(new TextDecoder().decode(first.body)) as Details
      } catch {
        return driveError(400, 'parseError', 'Parse Error')
      }
      const missing = this.#missingParent(details)
      if (missing) return missing
      return this.#store(target, details, second.contentType, second.body, fields)
    }
    return driveError(400, 'badRequest', `Unknown uploadType: ${kind}`)
  }

  #store(
    id: string | null,
    details: Details,
    contentType: string | null,
    body: Uint8Array,
    fields: string | null,
  ): Response {
    if (this.full) return storageFull()
    if (id === null) {
      const made = this.#create({ ...details, mimeType: details.mimeType ?? contentType }, body)
      return json(pick(made, this.terse ? null : fields))
    }
    const file = this.files.get(id)
    if (!file) return driveError(404, 'notFound', `File not found: ${id}.`)
    file.body = body
    file.md5Checksum = `md5${++this.#hashes}`.padEnd(32, '0')
    file.modifiedTime = new Date(this.#time++).toISOString()
    if (typeof details.mimeType === 'string') file.mimeType = details.mimeType
    else if (contentType) file.mimeType = contentType
    setProperties(file, details.appProperties)
    return json(pick(file, this.terse ? null : fields))
  }
}

/** `appProperties` as Drive merges them: a null value takes the property away. */
function setProperties(file: DriveFile, given: unknown): void {
  if (typeof given !== 'object' || given === null) return
  for (const [name, value] of Object.entries(given)) {
    if (typeof value === 'string') file.appProperties[name] = value
    else delete file.appProperties[name]
  }
}

/** The file as Drive's JSON, with only the fields asked for (`id,size`), or a default few. */
function pick(file: DriveFile, fields: string | null): Record<string, unknown> {
  const all: Record<string, unknown> = {
    kind: 'drive#file',
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    trashed: file.trashed,
    ...(Object.keys(file.appProperties).length > 0 ? { appProperties: file.appProperties } : {}),
    // A folder has neither a size nor a hash.
    ...(file.mimeType === FOLDER_TYPE
      ? {}
      : { size: String(file.body.length), md5Checksum: file.md5Checksum }),
  }
  const wanted = fields?.split(',').map(field => field.trim()) ?? ['kind', 'id', 'name', 'mimeType']
  return Object.fromEntries(wanted.flatMap(name => (name in all ? [[name, all[name]]] : [])))
}

/**
 * A search, in as much of Drive's language as the doorman speaks: clauses
 * joined by `and`. Anything else is the 400 Drive gives a query it cannot read.
 */
function parseQuery(q: string, exists: (id: string) => boolean): Clause[] | Response {
  const clauses: Clause[] = []
  const invalid = (): Response => driveError(400, 'invalid', 'Invalid Value')
  const text = (quoted: string): string => quoted.replace(/\\(['\\])/g, '$1')
  const STRING = "'((?:[^'\\\\]|\\\\.)*)'"

  let rest = q
  const property = new RegExp(`appProperties has \\{ key=${STRING} and value=${STRING} \\}`)
  const marked = property.exec(rest)
  if (marked) {
    const [whole, key = '', value = ''] = marked
    clauses.push(file => file.appProperties[text(key)] === text(value))
    rest = rest.replace(whole, 'true')
  }
  for (const clause of rest.split(' and ')) {
    let match: RegExpExecArray | null
    if (clause === 'true') continue
    if (clause === 'trashed = false') {
      clauses.push(file => !file.trashed)
    } else if ((match = new RegExp(`^${STRING} in parents$`).exec(clause))) {
      const parent = text(match[1] ?? '')
      // Drive answers a search inside a folder that is not there with a 404.
      if (!exists(parent)) return driveError(404, 'notFound', `File not found: ${parent}.`)
      clauses.push(file => file.parents.includes(parent))
    } else if ((match = new RegExp(`^name = ${STRING}$`).exec(clause))) {
      const name = text(match[1] ?? '')
      clauses.push(file => file.name === name)
    } else if ((match = new RegExp(`^mimeType (=|!=) ${STRING}$`).exec(clause))) {
      const [, operator, type = ''] = match
      clauses.push(file => (file.mimeType === text(type)) === (operator === '='))
    } else {
      return invalid()
    }
  }
  return clauses
}

/** A file's bytes, whole or the range asked for, as `alt=media` sends them. */
function media(file: DriveFile, range: string | null): Response {
  if (file.mimeType === FOLDER_TYPE) {
    return driveError(
      403,
      'fileNotDownloadable',
      'Only files with binary content can be downloaded.',
    )
  }
  const size = file.body.length
  const base = { 'content-type': file.mimeType }
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    const first = match?.[1] ? Number(match[1]) : null
    const last = match?.[2] ? Number(match[2]) : null
    const start = first ?? (last !== null ? Math.max(size - last, 0) : Number.NaN)
    const end = first !== null && last !== null ? Math.min(last, size - 1) : size - 1
    if (!match || Number.isNaN(start) || start > end || start >= size) {
      return new Response(
        JSON.stringify({ error: { code: 416, message: 'Requested range not satisfiable' } }),
        { status: 416, headers: { 'content-range': `bytes */${size}` } },
      )
    }
    const part = file.body.slice(start, end + 1)
    return new Response(part, {
      status: 206,
      headers: {
        ...base,
        'content-length': String(part.length),
        'content-range': `bytes ${start}-${end}/${size}`,
      },
    })
  }
  return new Response(file.body, {
    status: 200,
    headers: { ...base, 'content-length': String(size) },
  })
}

interface Part {
  readonly contentType: string | null
  readonly body: Uint8Array
}

/** The parts of a `multipart/related` body, each with its own type. */
function splitMultipart(body: Uint8Array, boundary: string): Part[] | null {
  // Latin-1 keeps one character a byte, so an index in the text is one in the bytes.
  const text = new TextDecoder('latin1').decode(body)
  const marker = `--${boundary}`
  const parts: Part[] = []
  let at = text.indexOf(marker)
  while (at !== -1) {
    const begin = at + marker.length
    if (text.startsWith('--', begin)) return parts
    const next = text.indexOf(`\r\n${marker}`, begin)
    const headersEnd = text.indexOf('\r\n\r\n', begin)
    if (next === -1 || headersEnd === -1 || headersEnd > next) return null
    const contentType = /content-type: ?([^\r\n]+)/i.exec(text.slice(begin, headersEnd))?.[1]
    parts.push({ contentType: contentType ?? null, body: body.slice(headersEnd + 4, next) })
    at = next + 2
  }
  return null
}

function storageFull(): Response {
  return driveError(
    403,
    'storageQuotaExceeded',
    "The user's Drive storage quota has been exceeded.",
  )
}

function driveError(status: number, reason: string, message: string): Response {
  return json(
    { error: { code: status, message, errors: [{ domain: 'global', reason, message }] } },
    status,
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  })
}
