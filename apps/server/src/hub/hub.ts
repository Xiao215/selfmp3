import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Request, Router } from 'express'
import {
  HUB_LIBRARY_HEADER,
  messageOf,
  plural,
  type CloudServer,
  type DoormanMe,
} from '@selfmp3/shared'
import { libraryApi } from '../app.js'
import { CloudError } from '../bucket/store.js'
import { DoormanClient } from '../bucket/doorman.js'
import type { Config } from '../config.js'
import { createContainer, type Container } from '../container.js'
import { HttpError } from '../http/errors.js'
import { isLocalRequest } from '../http/local.js'
import { tokenOf } from '../http/middleware.js'
import type { Logger } from '../logger.js'
import { publishedAddresses } from '../services/addresses.js'
import { YtThrottleService } from '../services/ytThrottle.js'
import { createShared, FileThrottleStore, type SharedServices } from '../shared.js'
import { startContainer } from '../start.js'
import { HubRegistry, type HubEntry } from './registry.js'

/**
 * A server working for every account that asks it to
 * (docs/features/shared-server.md).
 *
 * Each account's library is a workspace: a whole `Container` of its own,
 * under `<data>/accounts/<id>/`, publishing to that account's bucket through
 * the grant the account gave this server. A request finds its workspace by the
 * token it carries, which is the workspace's own and reached the device in its
 * bucket's snapshot — so a device talks to its library here exactly as it
 * talked to a server of its own, and never to anyone else's.
 *
 * With a folder for a bucket (`SELFMP3_CLOUD_DIR`: the dev profile, the verify
 * lanes) there are no accounts to work for: the hub holds one library, in the
 * data folder itself, as the server always did.
 */

interface Workspace {
  /** The entry in `hub.json`; null for the one library of a folder bucket. */
  readonly entry: HubEntry | null
  readonly container: Container
  readonly api: Router
}

export class Hub {
  readonly config: Config
  readonly logger: Logger
  readonly shared: SharedServices
  readonly #doorman: DoormanClient | null
  readonly #registry: HubRegistry | null
  readonly #workspaces = new Map<string, Workspace>()
  readonly #byToken = new Map<string, Workspace>()
  /** Joins under way, by account, so two taps make one workspace. */
  readonly #joining = new Map<string, Promise<CloudServer>>()
  /** Looks at a grant the doorman asked for, under way, by workspace (`check`). */
  readonly #checking = new Set<string>()
  /** When each workspace's grant was last looked at for one, by workspace. */
  readonly #checkedAt = new Map<string, number>()
  #stopped = false

  constructor(config: Config, logger: Logger, doorman?: DoormanClient | null) {
    this.config = config
    this.logger = logger
    // First: a data folder this server cannot work in stops it before anything opens.
    this.#registry = config.cloudDir === null ? new HubRegistry(config.dataDir) : null
    this.#doorman =
      doorman !== undefined
        ? doorman
        : config.doormanUrl
          ? new DoormanClient(config.doormanUrl)
          : null
    this.shared = createShared(
      config,
      logger,
      config.cloudDir === null
        ? new YtThrottleService(new FileThrottleStore(config.dataDir, logger), () =>
            this.#anySignedInToYouTube(),
          )
        : null,
    )
  }

  /** Open every library this server works for and set it going. */
  start(): void {
    if (!this.#registry) {
      this.#add(null, createContainer(this.config, { shared: this.shared, logger: this.logger }))
      return
    }
    for (const entry of this.#registry.all()) this.#open(entry)
    this.logger.info(`working for ${plural(this.#workspaces.size, 'library', 'libraries')}`)
  }

  /** The libraries open, for the server's page and the log. */
  workspaces(): readonly Workspace[] {
    return [...this.#workspaces.values()]
  }

  /**
   * The library a request is for: the one whose token it carries. A request
   * from this machine with none goes to the library it names by id
   * (`HUB_LIBRARY_HEADER`: the server's page and the `selfmp3` command, which
   * read the ids from `GET /api/hub`), else to the only library, when there is
   * only one — an extension pointed at localhost, on a machine nobody else
   * uses — and to none when there are several, since there is no telling
   * whose it meant. Naming one is no more than the token-less request to the
   * only library already is: whoever is at this machine can read `hub.json`.
   *
   * A map lookup rather than a timing-safe comparison: the tokens are 256
   * random bits, and how long a hash table takes to miss says nothing useful
   * about any of them.
   */
  resolve(req: Request): Workspace | null {
    const token = tokenOf(req)
    if (token !== null) return this.#byToken.get(token) ?? null
    if (!isLocalRequest(req)) return null
    const named = req.get(HUB_LIBRARY_HEADER)
    if (named) return this.#workspaces.get(named) ?? null
    if (this.#workspaces.size === 1) return this.#workspaces.values().next().value ?? null
    return null
  }

  /** Where this server can be reached, as a snapshot names it. */
  addresses(): string[] {
    return publishedAddresses(this.config.host, this.config.port, this.config.publicUrl).map(
      address => address.url,
    )
  }

  /**
   * An account asking this server to work for it, with a device's doorman
   * session (`POST /api/hub/join`). Answers with what the device needs to talk
   * to its library here at once, before any snapshot names this server.
   */
  async join(session: string): Promise<CloudServer> {
    if (!this.#registry || !this.#doorman) {
      throw HttpError.conflict(
        this.#registry
          ? 'This server has no doorman to check who you are with.'
          : 'This server’s bucket is a folder on its own disk; it works for no accounts.',
      )
    }
    const me = await this.#askDoorman(() => this.#doorman!.me(session))
    const account = me.account
    if (!account) throw new HttpError(502, 'The doorman is too old to say who you are.', 'doorman')
    if (!me.storage) {
      throw HttpError.conflict('Connect your storage first: this server works in your bucket.')
    }
    const known = this.#registry.byAccount(account)
    if (known && this.#workspaces.has(known.id)) {
      if (await this.#grantHolds(known)) return this.answer(known)
      // Taken back a moment ago, and not noticed yet (an idle workspace looks
      // every ten minutes): answering its token would hand the device a
      // library about to be let go. Let it go now, and join afresh.
      this.#leave(known, 'its grant was taken back')
    }

    const pending = this.#joining.get(account)
    if (pending) return pending
    const joining = this.#makeWorkspace(session, account, me).finally(() =>
      this.#joining.delete(account),
    )
    this.#joining.set(account, joining)
    return joining
  }

  /**
   * The doorman saying a grant was taken back (`POST /api/hub/check`): the
   * workspace holding it looks at it now, instead of at its next look at the
   * bucket, up to ten minutes on, and lets the library go if the doorman
   * refuses it.
   *
   * Nothing in the notice is taken on trust. It names a grant and nothing
   * else, anyone can send one, and all it does is make the server ask the
   * doorman with the grant's own token a little sooner. A grant no workspace
   * holds is ignored without asking anyone. One that is held is looked at no
   * more than once every `CHECK_GAP_MS`: notices that come sooner are folded
   * into the look under way. If the grant still holds, it is looked at once
   * more a minute on, since the doorman's copies of its sessions can take
   * that long to agree that one ended (apps/doorman/src/kv.ts).
   */
  check(grant: string): void {
    if (!this.#registry || !this.#doorman || this.#stopped) return
    const entry = this.#holding(grant)
    if (!entry || this.#checking.has(entry.id)) return
    this.#checking.add(entry.id)
    void this.#lookAgain(entry.id, grant)
      .catch((error: unknown) => {
        this.logger.warn('could not look at a grant again', { message: messageOf(error) })
      })
      .finally(() => this.#checking.delete(entry.id))
  }

  async #lookAgain(id: string, grant: string): Promise<void> {
    const since = Date.now() - (this.#checkedAt.get(id) ?? -Infinity)
    if (since < CHECK_GAP_MS) await pause(CHECK_GAP_MS - since)
    for (const wait of [0, CHECK_AGAIN_MS]) {
      if (wait > 0) await pause(wait)
      // Let go, joined again behind a new grant, or the server stopping meanwhile.
      const entry = this.#holding(grant)
      if (!entry || this.#stopped) return
      this.#checkedAt.set(id, Date.now())
      if (!(await this.#grantHolds(entry))) {
        if (this.#holding(grant) === entry) this.#leave(entry, 'its grant was taken back')
        return
      }
    }
  }

  /** The open workspace's entry that holds this grant, if one does. */
  #holding(grant: string): HubEntry | null {
    for (const { entry } of this.#workspaces.values()) {
      if (entry?.grant.id === grant) return entry
    }
    return null
  }

  /**
   * An account's library let go, once its grant was taken back (Settings ›
   * Account › Computers › Remove, on any device, which ends the grant at the
   * doorman): the workspace closed and its folders deleted. Nothing is lost
   * by it — the folders were a copy of the bucket.
   */
  #leave(entry: HubEntry, reason: string): void {
    if (!this.#registry) return
    this.#close(entry.id)
    this.#registry.remove(entry.id)
    fs.rmSync(path.join(this.config.dataDir, 'accounts', entry.id), {
      recursive: true,
      force: true,
    })
    fs.rmSync(path.join(this.config.libraryDir, entry.id), { recursive: true, force: true })
    this.logger.info('let a library go', { workspace: entry.id, email: entry.email, reason })
  }

  /** Every library's background work stopped; databases still open. */
  stop(): void {
    this.#stopped = true
    for (const workspace of this.#workspaces.values()) workspace.container.stop()
    void this.shared.close()
  }

  close(): void {
    this.stop()
    for (const workspace of this.#workspaces.values()) workspace.container.close()
    this.#workspaces.clear()
    this.#byToken.clear()
  }

  async #makeWorkspace(session: string, account: string, me: DoormanMe): Promise<CloudServer> {
    const registry = this.#registry!
    const doorman = this.#doorman!
    const made = await this.#askDoorman(() => doorman.grant(session, this.#name()))
    const grant = { token: made.token, id: made.grant.id }
    // An account already in the registry with no workspace open: one whose
    // workspace could not be opened when it joined (`#open` below threw),
    // joining again. The same workspace, token and all, with the new grant,
    // rather than a second entry for one account.
    const known = registry.byAccount(account)
    const entry = known
      ? registry.update(known.id, { grant, email: me.email })
      : registry.add({ account, email: me.email, grant })
    this.#open(entry, me)
    this.logger.info('a library joined', { workspace: entry.id, email: me.email })
    return this.answer(entry)
  }

  /** What a device talks to one library here with: which server, where, and the library's token. */
  answer(entry: HubEntry): CloudServer {
    return { id: this.shared.serverId, addresses: this.addresses(), token: entry.token }
  }

  /** One workspace's container made, its session in place, and set going. */
  #open(entry: HubEntry, me?: DoormanMe): Workspace {
    const config = workspaceConfig(this.config, entry)
    const container = createContainer(config, {
      shared: this.shared,
      logger: this.logger.child(entry.id.slice(0, 6)),
      sessionEnded: () => this.#sessionEnded(entry.id),
    })
    const grant = entry.grant
    const saved = container.cloudRepo.doormanSession()
    if (this.config.doormanUrl && saved?.token !== grant.token) {
      container.cloudRepo.saveDoormanSession({
        url: this.config.doormanUrl,
        token: grant.token,
        email: me?.email ?? entry.email,
        name: me?.name ?? null,
        picture: me?.picture ?? null,
        storage: me?.storage ?? null,
      })
    }
    return this.#add(entry, container)
  }

  #add(entry: HubEntry | null, container: Container): Workspace {
    const workspace: Workspace = { entry, container, api: libraryApi(container) }
    this.#workspaces.set(entry?.id ?? 'local', workspace)
    this.#byToken.set(container.config.authToken, workspace)
    startContainer(container)
    return workspace
  }

  #close(id: string): void {
    const workspace = this.#workspaces.get(id)
    if (!workspace) return
    this.#workspaces.delete(id)
    this.#byToken.delete(workspace.container.config.authToken)
    workspace.container.close()
  }

  /**
   * The doorman no longer takes a workspace's grant. Asked once more, so a
   * hiccup is not taken for the account leaving; refused again, the library
   * is let go.
   */
  #sessionEnded(id: string): void {
    const workspace = this.#workspaces.get(id)
    const entry = workspace?.entry
    if (!entry || !this.#doorman || this.#stopped) return
    void this.#doorman.me(entry.grant.token).then(
      () => undefined,
      (error: unknown) => {
        if (!(error instanceof CloudError && error.kind === 'auth')) return
        try {
          this.#leave(entry, 'its grant was taken back')
        } catch (failure) {
          this.logger.warn('could not let a library go', { message: messageOf(failure) })
        }
      },
    )
  }

  /** Whether the doorman still takes a workspace's grant; a hiccup is not taken for no. */
  async #grantHolds(entry: HubEntry): Promise<boolean> {
    try {
      await this.#doorman!.me(entry.grant.token)
      return true
    } catch (error) {
      return !(error instanceof CloudError && error.kind === 'auth')
    }
  }

  /** What a grant names this server: its public address, else the first it listens on. */
  #name(): { server: string; name: string } {
    return {
      server: this.config.publicUrl ?? this.addresses()[0] ?? `http://${os.hostname()}`,
      name: os.hostname(),
    }
  }

  /** The doorman's refusal of a device's session is the device's to fix: 401, not 500. */
  async #askDoorman<T>(ask: () => Promise<T>): Promise<T> {
    try {
      return await ask()
    } catch (error) {
      if (error instanceof CloudError) {
        if (error.kind === 'auth') throw HttpError.unauthorized('sign in again, then try once more')
        if (error.kind === 'missing') throw HttpError.conflict(error.message)
        throw new HttpError(502, error.message, 'doorman')
      }
      throw error
    }
  }

  /** Whether any library here asks YouTube signed in, which widens the machine's budget. */
  #anySignedInToYouTube(): boolean {
    for (const workspace of this.#workspaces.values()) {
      if (workspace.container.settings.get().ytCookieSource !== 'none') return true
    }
    return false
  }
}

/** The least time between two looks at one workspace's grant that a notice asks for (`Hub.check`). */
const CHECK_GAP_MS = 5_000

/** How long after a look that found the grant holding to look once more. */
const CHECK_AGAIN_MS = 65_000

/** A wait that does not keep the process alive by itself. */
function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms).unref())
}

/** A workspace's configuration: the server's, in folders of its own, with its own token. */
function workspaceConfig(config: Config, entry: HubEntry): Config {
  const dataDir = path.join(config.dataDir, 'accounts', entry.id)
  const libraryDir = path.join(config.libraryDir, entry.id)
  for (const dir of [dataDir, libraryDir, path.join(dataDir, 'covers')]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return Object.freeze({ ...config, dataDir, libraryDir, authToken: entry.token })
}
