import {
  DOORMAN_ERROR,
  type DoormanErrorCode,
  MemberPictureSchema,
  RoomMemberNameSchema,
  RoomSongSchema,
  SharedActionSchema,
  SharedDocSchema,
  SharedInviteSchema,
  SharedNameSchema,
  addSharedMember,
  applySharedAction,
  canReadSharedEntry,
  isRoomRefusal,
  newSharedDoc,
  sharedSummary,
  type RoomFilePart,
  type RoomRefusal,
  type SharedDoc,
  type SharedPlaylist,
} from '@selfmp3/shared'
import { z } from 'zod'
import { answer, refusalAnswer } from './doRelay.js'
import { secureHex } from './encoding.js'
import { keyOf } from './room.js'

/**
 * One shared playlist: a Durable Object per playlist id
 * (docs/features/listen-together.md, "Shared playlists"; the rules are
 * packages/shared's sharedPlaylist.ts).
 *
 * It belongs to Google accounts: the Worker (sharedRoutes.ts) checks a
 * session and says whose it was in `sub`, and this keeps which account each
 * of its people is — never sent to anyone, since it is what their songs are
 * lent by. Each person also has a listen token, which opens this playlist's
 * songs' files in an address and nothing else.
 *
 * It lasts until its last person leaves; then it forgets everything.
 */

interface Secrets {
  /** Member id → their Google account. */
  readonly subs: Record<string, string>
  /** Member id → their listen token. Kept as it is, to be handed back on every look. */
  readonly tokens: Record<string, string>
  /** What an invite link must carry. */
  readonly invite: string
}

/** What a shared playlist needs from the runtime. */
interface SharedRuntime {
  readonly storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    deleteAll(): Promise<void>
  }
  now(): number
}

const SubSchema = z.string().min(1)

/** A person's face's picture: the Worker's, from their session (sharedRoutes.ts). */
const PictureSchema = MemberPictureSchema.nullable()

const CreateSchema = z.object({
  id: z.string(),
  sub: SubSchema,
  picture: PictureSchema,
  name: SharedNameSchema,
  you: RoomMemberNameSchema,
  songs: z.array(RoomSongSchema).max(200),
})

/** A room kept: its signed-in people, and its songs with whose bucket each is in. */
const CreateFromSchema = z.object({
  id: z.string(),
  name: SharedNameSchema,
  creator: SubSchema,
  members: z
    .array(z.object({ sub: SubSchema, name: RoomMemberNameSchema, picture: PictureSchema }))
    .min(1)
    .max(32),
  items: z.array(z.object({ song: RoomSongSchema, sub: SubSchema })).max(500),
})
type CreateFrom = z.infer<typeof CreateFromSchema>

const JoinSchema = z.object({
  sub: SubSchema,
  picture: PictureSchema,
  invite: SharedInviteSchema,
  name: RoomMemberNameSchema,
})
const ActSchema = z.object({ sub: SubSchema, action: SharedActionSchema })

/** The songs a room may play from this playlist: each with its owner's account and name. */
export const LentSongsSchema = z.object({
  items: z.array(
    z.object({
      song: RoomSongSchema,
      sub: z.string(),
      name: RoomMemberNameSchema,
      picture: PictureSchema,
    }),
  ),
})
type LentSongs = z.infer<typeof LentSongsSchema>

/** A refusal's code, by what was refused. */
const SHARED_REFUSED: Readonly<Record<RoomRefusal['refused'], DoormanErrorCode>> = {
  forbidden: DOORMAN_ERROR.sharedForbidden,
  missing: DOORMAN_ERROR.sharedMissing,
  full: DOORMAN_ERROR.sharedFull,
  ended: DOORMAN_ERROR.sharedEnded,
  invalid: DOORMAN_ERROR.sharedInvalid,
}

export class Shared {
  readonly #runtime: SharedRuntime
  readonly #newId: () => string

  constructor(runtime: SharedRuntime, ids: { readonly newId?: () => string } = {}) {
    this.#runtime = runtime
    this.#newId = ids.newId ?? (() => secureHex(6))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'POST /create':
          return await this.#create(CreateSchema.parse(await request.json()))
        case 'POST /create-from':
          return await this.#createFrom(CreateFromSchema.parse(await request.json()))
        case 'POST /join':
          return await this.#join(JoinSchema.parse(await request.json()))
        case 'GET /view':
          return await this.#view(
            SubSchema.parse(url.searchParams.get('sub')),
            PictureSchema.parse(url.searchParams.get('picture')),
          )
        case 'GET /summary':
          return await this.#summary(SubSchema.parse(url.searchParams.get('sub')))
        case 'POST /act':
          return await this.#act(ActSchema.parse(await request.json()))
        case 'GET /lend':
          return await this.#lend(SubSchema.parse(url.searchParams.get('sub')))
        case 'GET /file':
          return await this.#file(url)
        default:
          return answer(404, DOORMAN_ERROR.notFound, 'no such endpoint')
      }
    } catch (error) {
      if (error instanceof z.ZodError)
        return answer(400, DOORMAN_ERROR.badRequest, 'that is not a playlist request')
      throw error
    }
  }

  async #create(input: z.infer<typeof CreateSchema>): Promise<Response> {
    if (await this.#doc()) return answer(409, DOORMAN_ERROR.sharedTaken, 'that playlist exists')
    const member = this.#newId()
    const doc = newSharedDoc({
      id: input.id,
      name: input.name,
      creator: { id: member, name: input.you, picture: input.picture },
      songs: input.songs.map(song => ({ id: this.#newId(), song })),
      now: this.#runtime.now(),
    })
    const secrets: Secrets = {
      subs: { [member]: input.sub },
      tokens: { [member]: secureHex(16) },
      invite: secureHex(8),
    }
    await this.#save(doc, secrets)
    return Response.json(this.#viewOf(doc, secrets, member))
  }

  async #createFrom(input: CreateFrom): Promise<Response> {
    if (await this.#doc()) return answer(409, DOORMAN_ERROR.sharedTaken, 'that playlist exists')
    const now = this.#runtime.now()
    // The one who kept it first, so they are the one who made it.
    const people = [...input.members].sort((a, b) =>
      a.sub === input.creator ? -1 : b.sub === input.creator ? 1 : 0,
    )
    const ids = new Map<string, string>()
    let doc: SharedDoc | null = null
    for (const person of people) {
      if (ids.has(person.sub)) continue
      const id = this.#newId()
      ids.set(person.sub, id)
      if (!doc) {
        doc = newSharedDoc({
          id: input.id,
          name: input.name,
          creator: { id, name: person.name, picture: person.picture },
          songs: [],
          now,
        })
      } else {
        const joined = addSharedMember(doc, { id, name: person.name, picture: person.picture }, now)
        if (isRoomRefusal(joined)) break
        doc = joined
      }
    }
    if (!doc) return answer(400, DOORMAN_ERROR.badRequest, 'nobody to keep it')
    const seen = new Set<string>()
    const entries = input.items.flatMap(item => {
      const owner = ids.get(item.sub)
      const key = item.song.audio?.key
      // A song whose owner is not one of its people could never be lent; one
      // already in it is not put in twice.
      if (!owner || !key || seen.has(key)) return []
      seen.add(key)
      return [{ id: this.#newId(), song: item.song, owner, addedAt: now }]
    })
    doc = { ...doc, entries }
    const secrets: Secrets = {
      subs: Object.fromEntries([...ids].map(([sub, id]) => [id, sub])),
      tokens: Object.fromEntries([...ids.values()].map(id => [id, secureHex(16)])),
      invite: secureHex(8),
    }
    await this.#save(doc, secrets)
    const creator = ids.get(input.creator) ?? ''
    return Response.json(this.#viewOf(doc, secrets, creator))
  }

  async #join(input: z.infer<typeof JoinSchema>): Promise<Response> {
    const doc = await this.#doc()
    const secrets = await this.#secrets()
    if (!doc || !secrets) return answer(404, DOORMAN_ERROR.sharedMissing, 'no such playlist')
    if (input.invite !== secrets.invite)
      return answer(403, DOORMAN_ERROR.sharedForbidden, 'that invite is not this playlist’s')
    const already = this.#memberOf(secrets, input.sub)
    if (already) return Response.json(this.#viewOf(doc, secrets, already))
    const member = this.#newId()
    const joined = addSharedMember(
      doc,
      { id: member, name: input.name, picture: input.picture },
      this.#runtime.now(),
    )
    if (isRoomRefusal(joined)) return this.#refusal(joined)
    const next: Secrets = {
      ...secrets,
      subs: { ...secrets.subs, [member]: input.sub },
      tokens: { ...secrets.tokens, [member]: secureHex(16) },
    }
    await this.#save(joined, next)
    return Response.json(this.#viewOf(joined, next, member))
  }

  /**
   * The playlist, for one of its people, whose face takes the picture their
   * session has now: one who joined before faces had pictures, or has since
   * changed theirs, shows it from their next look.
   */
  async #view(sub: string, picture: string | null): Promise<Response> {
    const found = await this.#found(sub)
    if (found instanceof Response) return found
    let doc = found.doc
    if (doc.members.some(member => member.id === found.member && member.picture !== picture)) {
      doc = {
        ...doc,
        members: doc.members.map(member =>
          member.id === found.member ? { ...member, picture } : member,
        ),
      }
      await this.#save(doc, found.secrets)
    }
    return Response.json(this.#viewOf(doc, found.secrets, found.member))
  }

  async #summary(sub: string): Promise<Response> {
    const found = await this.#found(sub)
    if (found instanceof Response) return found
    return Response.json(sharedSummary(found.doc))
  }

  async #act(input: z.infer<typeof ActSchema>): Promise<Response> {
    const found = await this.#found(input.sub)
    if (found instanceof Response) return found
    const next = applySharedAction(
      found.doc,
      found.member,
      input.action,
      this.#runtime.now(),
      this.#newId,
    )
    if (isRoomRefusal(next)) return this.#refusal(next)
    if (input.action.type === 'leave') {
      if (next.members.length === 0) {
        await this.#runtime.storage.deleteAll()
        return new Response(null, { status: 204 })
      }
      const { [found.member]: _sub, ...subs } = found.secrets.subs
      const { [found.member]: _token, ...tokens } = found.secrets.tokens
      await this.#save(next, { ...found.secrets, subs, tokens })
      return new Response(null, { status: 204 })
    }
    await this.#save(next, found.secrets)
    return Response.json(this.#viewOf(next, found.secrets, found.member))
  }

  /** Its songs, with their owners' accounts, for a room one of its people is opening. */
  async #lend(sub: string): Promise<Response> {
    const found = await this.#found(sub)
    if (found instanceof Response) return found
    const people = new Map(found.doc.members.map(member => [member.id, member]))
    const body: LentSongs = {
      items: found.doc.entries.flatMap(entry => {
        const owner = found.secrets.subs[entry.owner]
        const person = people.get(entry.owner)
        return owner && person
          ? [{ song: entry.song, sub: owner, name: person.name, picture: person.picture }]
          : []
      }),
    }
    return Response.json(body)
  }

  /** `GET /file?t=&entry=&part=`: whose bucket, and which key, for one of its people. */
  async #file(url: URL): Promise<Response> {
    const doc = await this.#doc()
    const secrets = await this.#secrets()
    if (!doc || !secrets) return answer(404, DOORMAN_ERROR.sharedMissing, 'no such playlist')
    const token = url.searchParams.get('t') ?? ''
    const member = Object.entries(secrets.tokens).find(([, held]) => held === token)?.[0]
    if (!member || !/^[0-9a-f]{32}$/.test(token)) {
      return answer(401, DOORMAN_ERROR.sharedUnauthorized, 'that is not a way into this playlist')
    }
    const part = url.searchParams.get('part') as RoomFilePart | null
    const entry = canReadSharedEntry(doc, member, url.searchParams.get('entry') ?? '')
    const key = entry && part ? keyOf(entry.song, part) : null
    const sub = entry ? secrets.subs[entry.owner] : undefined
    if (!key || !sub)
      return answer(404, DOORMAN_ERROR.sharedMissing, 'that song is not in the playlist')
    return Response.json({ sub, key })
  }

  async #found(
    sub: string,
  ): Promise<{ doc: SharedDoc; secrets: Secrets; member: string } | Response> {
    const doc = await this.#doc()
    const secrets = await this.#secrets()
    if (!doc || !secrets) return answer(404, DOORMAN_ERROR.sharedMissing, 'no such playlist')
    const member = this.#memberOf(secrets, sub)
    if (!member || !doc.members.some(other => other.id === member)) {
      return answer(403, DOORMAN_ERROR.sharedForbidden, 'you are not in this playlist')
    }
    return { doc, secrets, member }
  }

  #memberOf(secrets: Secrets, sub: string): string | undefined {
    return Object.entries(secrets.subs).find(([, held]) => held === sub)?.[0]
  }

  #viewOf(doc: SharedDoc, secrets: Secrets, member: string): SharedPlaylist {
    return { ...doc, you: member, invite: secrets.invite, token: secrets.tokens[member] ?? '' }
  }

  #refusal(refused: RoomRefusal): Response {
    return refusalAnswer(refused, SHARED_REFUSED)
  }

  async #doc(): Promise<SharedDoc | null> {
    const stored = await this.#runtime.storage.get<unknown>('doc')
    const parsed = SharedDocSchema.safeParse(stored)
    return parsed.success ? parsed.data : null
  }

  async #secrets(): Promise<Secrets | null> {
    return (await this.#runtime.storage.get<Secrets>('secrets')) ?? null
  }

  async #save(doc: SharedDoc, secrets: Secrets): Promise<void> {
    await this.#runtime.storage.put('doc', doc)
    await this.#runtime.storage.put('secrets', secrets)
  }
}

/**
 * The Durable Object class, exported from index.ts by the name wrangler.toml
 * binds (`SharedPlaylist`).
 */
export class SharedObject {
  readonly #shared: Shared

  constructor(state: DurableObjectState) {
    this.#shared = new Shared({
      storage: {
        get: key => state.storage.get(key),
        put: (key, value) => state.storage.put(key, value),
        deleteAll: () => state.storage.deleteAll(),
      },
      now: () => Date.now(),
    })
  }

  fetch(request: Request): Promise<Response> {
    return this.#shared.fetch(request)
  }
}
