import { z } from 'zod'
import {
  DOORMAN_PATHS,
  RoomJoinedSchema,
  RoomStateSchema,
  RoomVectorsSchema,
  type DoormanFetch,
  type RoomAction,
  type RoomCreate,
  type RoomFilePart,
  type RoomJoined,
  type RoomLinkServer,
  type RoomVectors,
  type RoomState,
} from '@selfmp3/shared'
import { doormanSend } from './send.js'

/**
 * A room on the doorman, from a device (docs/features/listen-together.md):
 * opening one, joining, doing things in it, and the addresses of its socket
 * and of the songs it lends. The routes are the doorman's (apps/doorman's
 * rooms.ts); the shapes are packages/shared's schemas/room.ts. A refusal is
 * packages/shared's `DoormanError`, whose `gone` says the room is over.
 */

const KeptSchema = z.object({ kept: z.number().int().nonnegative() })

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
  /** How the room's songs sound, for Keep it going. */
  vectors(pass: RoomPass): Promise<RoomVectors>
  /** How your own songs in the room sound; answers how many the room kept. */
  addVectors(pass: RoomPass, vectors: RoomVectors): Promise<number>
  /** The member's WebSocket. */
  socketUrl(pass: RoomPass): string
  /** One of a song's files, for an audio element, an image or the phone's player. */
  fileUrl(pass: RoomPass, entryId: string, part: RoomFilePart): string
}

export function createRoomApi(doormanUrl: string, fetch: DoormanFetch): RoomApi {
  const base = doormanUrl.replace(/\/+$/, '')
  const send = doormanSend(base, fetch)
  /** A member's own request: the room's path, with their token. */
  const at = (pass: RoomPass, rest = ''): string => DOORMAN_PATHS.room(pass.code, rest, pass.token)

  return {
    create: (session, input) =>
      send(DOORMAN_PATHS.rooms, body => RoomJoinedSchema.parse(body), { json: input, session }),
    join: (code, name, session) =>
      send(DOORMAN_PATHS.room(code, '/join'), body => RoomJoinedSchema.parse(body), {
        json: { name },
        session,
      }),
    state: pass => send(at(pass), body => RoomStateSchema.parse(body)),
    act: (pass, action, session) =>
      send(at(pass, '/act'), body => RoomStateSchema.parse(body), {
        json: action,
        session: session ?? null,
      }),
    linkServer: (pass, server) =>
      send(at(pass, '/link-server'), body => RoomStateSchema.parse(body), {
        json: server,
        method: 'PUT',
      }),
    vectors: pass => send(at(pass, '/vectors'), body => RoomVectorsSchema.parse(body)),
    addVectors: (pass, vectors) =>
      send(at(pass, '/vectors'), body => KeptSchema.parse(body).kept, { json: vectors }),
    socketUrl: pass => `${base}${at(pass, '/socket')}`.replace(/^http/, 'ws'),
    fileUrl: (pass, entryId, part) => `${base}${at(pass, `/files/${entryId}/${part}`)}`,
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
