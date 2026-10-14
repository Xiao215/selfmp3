import {
  DOORMAN_ERROR,
  type DoormanErrorCode,
  MemberPictureSchema,
  RoomFilePartSchema,
  RoomIdSchema,
  RoomMemberNameSchema,
  RoomSongSchema,
  ShareActionSchema,
  ShareDocSchema,
  ShareNameSchema,
  applyShareAction,
  isRoomRefusal,
  newShareDoc,
  shareAsked,
  shareGone,
  shareKeptUntil,
  shareLends,
  shareOpened,
  sharePlayed,
  shareSummary,
  shareView,
  SHARE_MAX_SONGS,
  type RoomRefusal,
  type ShareDoc,
} from '@selfmp3/shared'
import { z } from 'zod'
import { secureHex } from './encoding.js'
import { keyOf } from './room.js'

/**
 * One share link: a Durable Object per link id
 * (docs/features/share-links.md; the rules are packages/shared's
 * shareLink.ts).
 *
 * It keeps the link, its key, whose bucket its songs are lent from, and which
 * signed-in accounts opened it — the last two never sent to anyone. Anyone
 * holding the key may play it while it lasts; once it ends it lends only its
 * covers, for its card, and when the card's ninety days are up the alarm
 * forgets it entirely.
 *
 * Only the Worker talks to it (shareRoutes.ts), over plain requests to
 * `https://share/...`, having checked whatever needs a session; it says whose
 * session it was in `sub`.
 */

interface Secrets {
  /** What a link carries besides its id. */
  readonly key: string
  /** The account that sent it, whose bucket its songs are in. */
  readonly owner: string
  /** The signed-in accounts that opened it: the ones whose lists it is in. */
  readonly openers: readonly string[]
  /** Ask id → the account that asked, when it was signed in. */
  readonly askSubs: Readonly<Record<string, string>>
  /** The devices that opened it signed out, so a guest is counted once however often they look. */
  readonly visitors?: readonly string[]
}

/** What a link needs from the runtime. */
interface ShareRuntime {
  readonly storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    deleteAll(): Promise<void>
    setAlarm(when: number): Promise<void>
  }
  now(): number
}

/** The most signed-out devices one link remembers; past that, each opening counts. */
const MAX_VISITORS = 500

/** How often a play moves its last-played time on: storage is written at most this often. */
const PLAYED_EVERY_MS = 10 * 60 * 1000

const SubSchema = z.string().min(1)
const MaybeSubSchema = z.string()

const CreateSchema = z.object({
  id: z.string(),
  sub: SubSchema,
  name: ShareNameSchema,
  kind: z.enum(['song', 'list']),
  you: RoomMemberNameSchema,
  picture: MemberPictureSchema.nullable(),
  songs: z.array(RoomSongSchema).min(1).max(SHARE_MAX_SONGS),
})

const OpenSchema = z.object({
  key: z.string(),
  sub: MaybeSubSchema,
  /** The signed-in opener's name, as the sender's list says who opened it. */
  name: RoomMemberNameSchema.nullable(),
  /** A signed-out device's own id for itself, so it is one guest. */
  visitor: z
    .string()
    .regex(/^[\w-]{1,64}$/)
    .nullable(),
})
const AskSchema = z.object({
  key: z.string(),
  sub: MaybeSubSchema,
  name: RoomMemberNameSchema,
})
const PlayedSchema = z.object({ entry: RoomIdSchema, fromStart: z.boolean() })
const GoneSchema = z.object({ entry: RoomIdSchema })
const ActSchema = z.object({ sub: SubSchema, action: ShareActionSchema })

/** Which bucket, and which key in it: what the Worker reads a lent file by. */
export const ShareFileSchema = z.object({ sub: z.string(), key: z.string() })

const REFUSED: Readonly<Record<RoomRefusal['refused'], DoormanErrorCode>> = {
  forbidden: DOORMAN_ERROR.shareForbidden,
  missing: DOORMAN_ERROR.shareMissing,
  full: DOORMAN_ERROR.shareInvalid,
  ended: DOORMAN_ERROR.shareEnded,
  invalid: DOORMAN_ERROR.shareInvalid,
}

const STATUS: Readonly<Record<RoomRefusal['refused'], number>> = {
  forbidden: 403,
  missing: 404,
  full: 409,
  ended: 410,
  invalid: 400,
}

function answer(status: number, code: DoormanErrorCode, error: string): Response {
  return Response.json({ error, code }, { status })
}

const MISSING = (): Response =>
  answer(404, DOORMAN_ERROR.shareMissing, 'no such link; it may have been forgotten')
const WRONG_KEY = (): Response =>
  answer(403, DOORMAN_ERROR.shareForbidden, 'that is not this link’s key')

export class Share {
  readonly #runtime: ShareRuntime
  readonly #newId: () => string

  constructor(runtime: ShareRuntime, ids: { readonly newId?: () => string } = {}) {
    this.#runtime = runtime
    this.#newId = ids.newId ?? (() => secureHex(6))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'POST /create':
          return await this.#create(CreateSchema.parse(await request.json()))
        case 'POST /open':
          return await this.#open(OpenSchema.parse(await request.json()))
        case 'GET /peek':
          return await this.#peek(url.searchParams.get('k') ?? '')
        case 'GET /summary':
          return await this.#summary(SubSchema.parse(url.searchParams.get('sub')))
        case 'GET /file':
          return await this.#file(url)
        case 'POST /played':
          return await this.#played(PlayedSchema.parse(await request.json()))
        case 'POST /gone':
          return await this.#gone(GoneSchema.parse(await request.json()))
        case 'POST /ask':
          return await this.#ask(AskSchema.parse(await request.json()))
        case 'POST /act':
          return await this.#act(ActSchema.parse(await request.json()))
        default:
          return answer(404, DOORMAN_ERROR.notFound, 'no such endpoint')
      }
    } catch (error) {
      if (error instanceof z.ZodError)
        return answer(400, DOORMAN_ERROR.badRequest, 'that is not a link request')
      throw error
    }
  }

  /** Ninety days after it ended, it is forgotten; until then the alarm waits for that. */
  async alarm(): Promise<void> {
    const doc = await this.#doc()
    if (!doc) return this.#runtime.storage.deleteAll()
    const until = shareKeptUntil(doc)
    if (this.#runtime.now() >= until) return this.#runtime.storage.deleteAll()
    return this.#runtime.storage.setAlarm(until)
  }

  async #create(input: z.infer<typeof CreateSchema>): Promise<Response> {
    if (await this.#doc()) return answer(409, DOORMAN_ERROR.shareTaken, 'that link exists')
    const now = this.#runtime.now()
    const doc = newShareDoc({
      id: input.id,
      name: input.name,
      kind: input.kind,
      from: { name: input.you, picture: input.picture },
      songs: input.songs.map(song => ({ id: this.#newId(), song })),
      now,
    })
    const secrets: Secrets = { key: secureHex(8), owner: input.sub, openers: [], askSubs: {} }
    await this.#save(doc, secrets)
    await this.#runtime.storage.setAlarm(shareKeptUntil(doc))
    return Response.json(this.#viewOf(doc, secrets, input.sub))
  }

  /** Opened with its key: counted for its sender, and remembered as one of yours. */
  async #open(input: z.infer<typeof OpenSchema>): Promise<Response> {
    const found = await this.#found()
    if (!found) return MISSING()
    const { doc, secrets } = found
    if (input.key !== secrets.key) return WRONG_KEY()
    const sub = input.sub || null
    if (sub === secrets.owner) return Response.json(this.#viewOf(doc, secrets, sub))
    const visitors = secrets.visitors ?? []
    const seen = !sub && input.visitor !== null && visitors.includes(input.visitor)
    const opened = seen ? doc : shareOpened(doc, sub ? input.name : null)
    const openers =
      sub && !secrets.openers.includes(sub) ? [...secrets.openers, sub] : secrets.openers
    const next: Secrets = {
      ...secrets,
      openers,
      visitors:
        !sub && input.visitor !== null && !seen
          ? [...visitors, input.visitor].slice(-MAX_VISITORS)
          : visitors,
    }
    if (opened !== doc || openers !== secrets.openers || next.visitors !== visitors) {
      await this.#save(opened, next)
    }
    return Response.json(this.#viewOf(opened, next, sub))
  }

  /**
   * `GET /peek?k=`: the link as a chat app's preview reads it, for its card
   * (linkPage.ts). Nobody opened it, so nothing is counted or written.
   */
  async #peek(key: string): Promise<Response> {
    const found = await this.#found()
    if (!found) return MISSING()
    if (key !== found.secrets.key) return WRONG_KEY()
    return Response.json(this.#viewOf(found.doc, found.secrets, null))
  }

  /** The link in a list: its sender's, or of someone who opened it signed in. */
  async #summary(sub: string): Promise<Response> {
    const found = await this.#found()
    if (!found) return MISSING()
    const { doc, secrets } = found
    if (sub !== secrets.owner && !secrets.openers.includes(sub)) {
      return answer(403, DOORMAN_ERROR.shareForbidden, 'that link is not one of yours')
    }
    return Response.json(
      shareSummary(doc, {
        key: secrets.key,
        yours: sub === secrets.owner,
        asked: this.#asked(secrets, sub),
        now: this.#runtime.now(),
      }),
    )
  }

  /** `GET /file?k=&entry=&part=`: whose bucket, and which key, while the link lends it. */
  async #file(url: URL): Promise<Response> {
    const found = await this.#found()
    if (!found) return MISSING()
    const { doc, secrets } = found
    if ((url.searchParams.get('k') ?? '') !== secrets.key) return WRONG_KEY()
    const part = RoomFilePartSchema.safeParse(url.searchParams.get('part'))
    const entryId = url.searchParams.get('entry') ?? ''
    const entry = doc.entries.find(candidate => candidate.id === entryId)
    if (!part.success || !entry) {
      return answer(404, DOORMAN_ERROR.shareMissing, 'that song is not in this link')
    }
    if (!shareLends(doc, entry.id, part.data, this.#runtime.now())) {
      return answer(410, DOORMAN_ERROR.shareEnded, 'this link has ended')
    }
    const key = keyOf(entry.song, part.data)
    if (!key) return answer(404, DOORMAN_ERROR.shareMissing, 'that song has no such file')
    return Response.json({ sub: secrets.owner, key })
  }

  async #played(input: z.infer<typeof PlayedSchema>): Promise<Response> {
    const found = await this.#found()
    if (!found) return MISSING()
    const { doc, secrets } = found
    const now = this.#runtime.now()
    // A song is fetched in pieces: only a fresh play, or the first piece in a
    // while, is worth writing down.
    if (!input.fromStart && doc.playedAt !== null && now - doc.playedAt < PLAYED_EVERY_MS) {
      return new Response(null, { status: 204 })
    }
    const next = sharePlayed(doc, now, input.fromStart)
    if (next !== doc) await this.#save(next, secrets)
    return new Response(null, { status: 204 })
  }

  /** A song's file is not in its sender's bucket any more. */
  async #gone(input: z.infer<typeof GoneSchema>): Promise<Response> {
    const found = await this.#found()
    if (!found) return MISSING()
    const next = shareGone(found.doc, input.entry, this.#runtime.now())
    if (next !== found.doc) await this.#save(next, found.secrets)
    return new Response(null, { status: 204 })
  }

  async #ask(input: z.infer<typeof AskSchema>): Promise<Response> {
    const found = await this.#found()
    if (!found) return MISSING()
    const { doc, secrets } = found
    if (input.key !== secrets.key) return WRONG_KEY()
    const sub = input.sub || null
    if (sub === secrets.owner) {
      return answer(400, DOORMAN_ERROR.shareInvalid, 'it is your own link; share it again instead')
    }
    // A signed-in person asking twice is one ask, whatever name they give.
    const before = sub
      ? Object.entries(secrets.askSubs).find(([, held]) => held === sub)?.[0]
      : undefined
    const id = before ?? this.#newId()
    const earlier = before ? { ...doc, asks: doc.asks.filter(ask => ask.id !== before) } : doc
    const asked = shareAsked(earlier, { id, name: input.name }, this.#runtime.now())
    if (isRoomRefusal(asked)) return this.#refusal(asked)
    const kept = new Set(asked.asks.map(ask => ask.id))
    const askSubs = Object.fromEntries(
      Object.entries({ ...secrets.askSubs, ...(sub ? { [id]: sub } : {}) }).filter(([askId]) =>
        kept.has(askId),
      ),
    )
    const next = { ...secrets, askSubs }
    await this.#save(asked, next)
    return Response.json(this.#viewOf(asked, next, sub, true))
  }

  async #act(input: z.infer<typeof ActSchema>): Promise<Response> {
    const found = await this.#found()
    if (!found) return MISSING()
    const { doc, secrets } = found
    const owner = input.sub === secrets.owner
    if (input.action.type === 'forget') {
      if (owner) {
        await this.#runtime.storage.deleteAll()
        return new Response(null, { status: 204 })
      }
      if (!secrets.openers.includes(input.sub)) return new Response(null, { status: 204 })
      await this.#save(doc, {
        ...secrets,
        openers: secrets.openers.filter(other => other !== input.sub),
      })
      return new Response(null, { status: 204 })
    }
    if (!owner) return answer(403, DOORMAN_ERROR.shareForbidden, 'only its sender can do that')
    const next = applyShareAction(doc, input.action, this.#runtime.now())
    if (isRoomRefusal(next)) return this.#refusal(next)
    // Shared again: the asks it answered have nobody behind them any more.
    const answered =
      input.action.type === 'renew' || input.action.type === 'dismiss'
        ? {
            ...secrets,
            askSubs: Object.fromEntries(
              Object.entries(secrets.askSubs).filter(([id]) =>
                next.asks.some(ask => ask.id === id),
              ),
            ),
          }
        : secrets
    await this.#save(next, answered)
    if (input.action.type === 'renew') await this.#runtime.storage.setAlarm(shareKeptUntil(next))
    return Response.json(this.#viewOf(next, answered, input.sub))
  }

  #asked(secrets: Secrets, sub: string | null): boolean {
    return sub !== null && Object.values(secrets.askSubs).includes(sub)
  }

  #viewOf(doc: ShareDoc, secrets: Secrets, sub: string | null, asked = false) {
    return shareView(doc, {
      key: secrets.key,
      yours: sub !== null && sub === secrets.owner,
      asked: asked || this.#asked(secrets, sub),
      now: this.#runtime.now(),
    })
  }

  #refusal(refused: RoomRefusal): Response {
    return answer(STATUS[refused.refused], REFUSED[refused.refused], refused.message)
  }

  async #found(): Promise<{ doc: ShareDoc; secrets: Secrets } | null> {
    const stored = await this.#runtime.storage.get<unknown>('doc')
    const parsed = ShareDocSchema.safeParse(stored)
    const secrets = await this.#runtime.storage.get<Secrets>('secrets')
    if (!parsed.success || !secrets) return null
    // Past its card's days, it is as good as forgotten even before the alarm comes.
    if (this.#runtime.now() >= shareKeptUntil(parsed.data)) return null
    return { doc: parsed.data, secrets }
  }

  async #doc(): Promise<ShareDoc | null> {
    return (await this.#found())?.doc ?? null
  }

  async #save(doc: ShareDoc, secrets: Secrets): Promise<void> {
    await this.#runtime.storage.put('doc', doc)
    await this.#runtime.storage.put('secrets', secrets)
  }
}

/**
 * The Durable Object class, exported from index.ts by the name wrangler.toml
 * binds (`ShareLink`).
 */
export class ShareObject {
  readonly #share: Share

  constructor(state: DurableObjectState) {
    this.#share = new Share({
      storage: {
        get: key => state.storage.get(key),
        put: (key, value) => state.storage.put(key, value),
        deleteAll: () => state.storage.deleteAll(),
        setAlarm: when => state.storage.setAlarm(when),
      },
      now: () => Date.now(),
    })
  }

  fetch(request: Request): Promise<Response> {
    return this.#share.fetch(request)
  }

  alarm(): Promise<void> {
    return this.#share.alarm()
  }
}
