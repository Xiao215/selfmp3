import {
  ErrorBodySchema,
  RoomJoinedSchema,
  RoomStateSchema,
  type RoomAction,
  type RoomCreate,
  type RoomFilePart,
  type RoomJoined,
  type RoomLinkServer,
  type RoomState,
} from '@selfmp3/shared'
import type { ClientFetch } from '../platform.js'

/**
 * A room on the doorman, from a device (docs/features/listen-together.md):
 * opening one, joining, doing things in it, and the addresses of its socket
 * and of the songs it lends. The routes are the doorman's (apps/doorman's
 * rooms.ts); the shapes are packages/shared's schemas/room.ts.
 */

/** A room's answer that was not a yes, with the doorman's own words. */
export class RoomError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'RoomError'
    this.status = status
    this.code = code
  }

  /** The room is over for this member: it ended, was forgotten, or they were removed. */
  get gone(): boolean {
    return this.status === 410 || this.status === 404 || this.code === 'room_left'
  }
}

/** Which room, and which member of it: everything a device keeps to come back. */
export interface RoomPass {
  readonly code: string
  readonly member: string
  readonly token: string
}

interface RoomApi {
  create(session: string, input: RoomCreate): Promise<RoomJoined>
  /** With a session, you join as a friend who can bring songs; without, as a guest. */
  join(code: string, name: string, session: string | null): Promise<RoomJoined>
  state(pass: RoomPass): Promise<RoomState>
  /** `add` needs the session of the member who joined: the song is lent from their bucket. */
  act(pass: RoomPass, action: RoomAction, session?: string | null): Promise<RoomState>
  /** The host saying where its server answers from the internet, so links play for everyone. */
  linkServer(pass: RoomPass, server: RoomLinkServer): Promise<RoomState>
  /** The member's WebSocket. */
  socketUrl(pass: RoomPass): string
  /** One of a song's files, for an audio element, an image or the phone's player. */
  fileUrl(pass: RoomPass, entryId: string, part: RoomFilePart): string
}

export function createRoomApi(doormanUrl: string, fetch: ClientFetch): RoomApi {
  const base = doormanUrl.replace(/\/+$/, '')
  const at = (pass: RoomPass, path = ''): string =>
    `${base}/v1/rooms/${pass.code}${path}?t=${pass.token}`

  const send = async <T>(
    url: string,
    parse: (body: unknown) => T,
    body?: unknown,
    session?: string | null,
    method?: 'POST' | 'PUT',
  ): Promise<T> => {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (session) headers['authorization'] = `Bearer ${session}`
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : (method ?? 'POST'),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const answer: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const error = ErrorBodySchema.safeParse(answer)
      throw new RoomError(
        response.status,
        error.success ? error.data.code : 'room_error',
        error.success ? error.data.error : `the room answered ${response.status}`,
      )
    }
    return parse(answer)
  }

  return {
    create: (session, input) =>
      send(`${base}/v1/rooms`, body => RoomJoinedSchema.parse(body), input, session),
    join: (code, name, session) =>
      send(
        `${base}/v1/rooms/${encodeURIComponent(code)}/join`,
        body => RoomJoinedSchema.parse(body),
        { name },
        session,
      ),
    state: pass => send(at(pass), body => RoomStateSchema.parse(body)),
    act: (pass, action, session) =>
      send(at(pass, '/act'), body => RoomStateSchema.parse(body), action, session ?? null),
    linkServer: (pass, server) =>
      send(at(pass, '/link-server'), body => RoomStateSchema.parse(body), server, null, 'PUT'),
    socketUrl: pass => at(pass, '/socket').replace(/^http/, 'ws'),
    fileUrl: (pass, entryId, part) => at(pass, `/files/${entryId}/${part}`),
  }
}

/**
 * The one of a server's addresses the internet can reach, for the doorman to
 * play links through: https, and a name rather than a home or tailnet address
 * (a Tailscale Funnel's `*.ts.net` is the usual one). Null when it has none.
 */
export function publicServerBase(addresses: readonly string[]): string | null {
  for (const address of addresses) {
    const match = /^https:\/\/([^/:?#]+)(?::\d+)?\/?$/i.exec(address.trim())
    const host = match?.[1]?.toLowerCase()
    if (!host || host === 'localhost' || host.endsWith('.local')) continue
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) continue
    return address.trim().replace(/\/+$/, '')
  }
  return null
}
