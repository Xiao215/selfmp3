import {
  ErrorBodySchema,
  RoomStateSchema,
  SharedPlaylistSchema,
  SharedSummariesSchema,
  type RoomFilePart,
  type RoomState,
  type SharedAction,
  type SharedCreate,
  type SharedPlaylist,
  type SharedSummary,
} from '@selfmp3/shared'
import type { ClientFetch } from '../platform.js'
import { RoomError, type RoomPass } from './roomApi.js'

/**
 * Shared playlists on the doorman, from a device
 * (docs/features/listen-together.md, "Shared playlists"; the doorman's
 * sharedRoutes.ts). Every call is made signed in; a song's file address
 * carries the playlist's listen token instead, for an audio element.
 */
interface SharedApi {
  list(session: string): Promise<SharedSummary[]>
  create(session: string, input: SharedCreate): Promise<SharedPlaylist>
  get(session: string, id: string): Promise<SharedPlaylist>
  join(session: string, id: string, invite: string, name: string): Promise<SharedPlaylist>
  /** The playlist after it; null after you left it. */
  act(session: string, id: string, action: SharedAction): Promise<SharedPlaylist | null>
  fileUrl(
    playlist: Pick<SharedPlaylist, 'id' | 'token'>,
    entryId: string,
    part: RoomFilePart,
  ): string
  /** The room you host, kept as a shared playlist everyone signed in there has. */
  keepRoom(pass: RoomPass, session: string, name: string): Promise<SharedPlaylist>
  /** A shared playlist's songs, into the room you host. */
  fillRoom(pass: RoomPass, session: string, shared: string): Promise<RoomState>
}

export function createSharedApi(doormanUrl: string, fetch: ClientFetch): SharedApi {
  const base = doormanUrl.replace(/\/+$/, '')

  const send = async <T>(
    url: string,
    session: string,
    parse: (body: unknown) => T,
    body?: unknown,
  ): Promise<T> => {
    const headers: Record<string, string> = { authorization: `Bearer ${session}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const answer: unknown = response.status === 204 ? null : await response.json().catch(() => null)
    if (!response.ok) {
      const error = ErrorBodySchema.safeParse(answer)
      throw new RoomError(
        response.status,
        error.success ? error.data.code : 'shared_error',
        error.success ? error.data.error : `the playlist answered ${response.status}`,
      )
    }
    return parse(answer)
  }
  const one = (body: unknown): SharedPlaylist => SharedPlaylistSchema.parse(body)
  const room = (pass: RoomPass, path: string): string =>
    `${base}/v1/rooms/${pass.code}${path}?t=${pass.token}`

  return {
    list: session => send(`${base}/v1/shared`, session, body => SharedSummariesSchema.parse(body)),
    create: (session, input) => send(`${base}/v1/shared`, session, one, input),
    get: (session, id) => send(`${base}/v1/shared/${id}`, session, one),
    join: (session, id, invite, name) =>
      send(`${base}/v1/shared/${id}/join`, session, one, { invite, name }),
    act: (session, id, action) =>
      send(
        `${base}/v1/shared/${id}/act`,
        session,
        body => (body === null ? null : one(body)),
        action,
      ),
    fileUrl: (playlist, entryId, part) =>
      `${base}/v1/shared/${playlist.id}/files/${entryId}/${part}?t=${playlist.token}`,
    keepRoom: (pass, session, name) => send(room(pass, '/keep'), session, one, { name }),
    fillRoom: (pass, session, shared) =>
      send(room(pass, '/from-shared'), session, body => RoomStateSchema.parse(body), { shared }),
  }
}

/** A shared playlist's invite link: opens the join page, in the app or a browser. */
export function sharedInviteLink(
  appUrl: string,
  playlist: Pick<SharedPlaylist, 'id' | 'invite'>,
): string {
  return `${appUrl.replace(/\/+$/, '')}/shared/${playlist.id}/join/${playlist.invite}`
}
