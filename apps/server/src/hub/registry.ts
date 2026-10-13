import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { DoormanAccountSchema } from '@selfmp3/shared'

/**
 * Who this server works for: `<data>/hub.json` (docs/features/shared-server.md).
 *
 * The one thing a server keeps that it cannot get back from a bucket. Each
 * entry is one library's workspace — its folder under `<data>/accounts/`, the
 * account it is for, the token its devices are given, and the grant it reaches
 * the account's bucket with. Everything in the workspace's folder is a cache
 * of that bucket; this file is what says whose.
 *
 * The token lives here rather than in the workspace's database so that a
 * folder deleted and rebuilt from the bucket answers to the same token its
 * devices already hold.
 */

export const WorkspaceIdSchema = z.string().regex(/^[0-9a-f]{16}$/, 'not a workspace id')

const GrantSchema = z.object({
  /** The doorman session the account gave this server. */
  token: z.string().min(1),
  /** Its id in the account's list of grants; null for a device's session, before it was swapped. */
  id: z.string().nullable(),
})
export type HubGrant = z.infer<typeof GrantSchema>

const EntrySchema = z.object({
  id: WorkspaceIdSchema,
  /** The doorman's id for the account; null until it has said (a library from before). */
  account: DoormanAccountSchema.nullable(),
  /** For the log and the server's page; the account's own word for itself. */
  email: z.string().nullable(),
  /** What every device of the account sends: published in its snapshots. */
  token: z.string().min(16),
  grant: GrantSchema.nullable(),
  joinedAt: z.string().datetime(),
})
export type HubEntry = z.infer<typeof EntrySchema>

const FileSchema = z.object({
  format: z.literal(1),
  workspaces: z.array(EntrySchema),
})

const FILE = 'hub.json'

export class HubRegistry {
  readonly #file: string
  #entries: HubEntry[]

  constructor(dataDir: string) {
    this.#file = path.join(dataDir, FILE)
    this.#entries = read(this.#file)
  }

  /** Whether the file exists at all: a server from before has none yet. */
  static exists(dataDir: string): boolean {
    return fs.existsSync(path.join(dataDir, FILE))
  }

  all(): readonly HubEntry[] {
    return this.#entries
  }

  byId(id: string): HubEntry | null {
    return this.#entries.find(entry => entry.id === id) ?? null
  }

  byAccount(account: string): HubEntry | null {
    return this.#entries.find(entry => entry.account === account) ?? null
  }

  /** A new entry, kept at once. */
  add(fields: Omit<HubEntry, 'id' | 'joinedAt' | 'token'> & { token?: string }): HubEntry {
    const entry: HubEntry = {
      id: crypto.randomBytes(8).toString('hex'),
      joinedAt: new Date().toISOString(),
      ...fields,
      token: fields.token ?? newToken(),
    }
    this.#entries = [...this.#entries, entry]
    this.#write()
    return entry
  }

  update(id: string, fields: Partial<Omit<HubEntry, 'id'>>): HubEntry {
    const entry = this.byId(id)
    if (!entry) throw new Error(`no workspace ${id}`)
    const next = { ...entry, ...fields }
    this.#entries = this.#entries.map(candidate => (candidate.id === id ? next : candidate))
    this.#write()
    return next
  }

  remove(id: string): void {
    this.#entries = this.#entries.filter(entry => entry.id !== id)
    this.#write()
  }

  /** Written whole, to a temporary file first: a crash mid-write must not lose who joined. */
  #write(): void {
    const data: z.infer<typeof FileSchema> = { format: 1, workspaces: this.#entries }
    const temporary = `${this.#file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, this.#file)
  }
}

/**
 * The file as it is. One that is there and cannot be read stops the server:
 * starting over with nobody would leave every account's devices holding a
 * token nothing answers to, and the grants with it.
 */
function read(file: string): HubEntry[] {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const parsed = FileSchema.safeParse(JSON.parse(text))
  if (!parsed.success) {
    throw new Error(`${file} is not a list of workspaces this server can read; fix or move it`)
  }
  return parsed.data.workspaces
}

/** As the one server's own token always was (repositories/auth.ts). */
function newToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}
