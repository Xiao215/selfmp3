import {
  DOORMAN_PATHS,
  RoomStateSchema,
  SharedPlaylistSchema,
  SharedSummariesSchema,
  type DoormanFetch,
  type RoomFilePart,
  type RoomState,
  type SharedAction,
  type SharedCreate,
  type SharedPlaylist,
  type SharedSummary,
} from '@selfmp3/shared'
import type { RoomPass } from './roomApi.js'
import { doormanSend } from './send.js'

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

export function createSharedApi(doormanUrl: string, fetch: DoormanFetch): SharedApi {
  const base = doormanUrl.replace(/\/+$/, '')
  const send = doormanSend(base, fetch)
  const one = (body: unknown): SharedPlaylist => SharedPlaylistSchema.parse(body)
  const playlist = DOORMAN_PATHS.sharedPlaylist

  return {
    list: session =>
      send(DOORMAN_PATHS.shared, body => SharedSummariesSchema.parse(body), { session }),
    create: (session, input) => send(DOORMAN_PATHS.shared, one, { json: input, session }),
    get: (session, id) => send(playlist(id), one, { session }),
    join: (session, id, invite, name) =>
      send(playlist(id, '/join'), one, { json: { invite, name }, session }),
    act: (session, id, action) =>
      send(playlist(id, '/act'), body => (body === null ? null : one(body)), {
        json: action,
        session,
      }),
    fileUrl: (shared, entryId, part) =>
      `${base}${playlist(shared.id, `/files/${entryId}/${part}`, shared.token)}`,
    keepRoom: (pass, session, name) =>
      send(DOORMAN_PATHS.room(pass.code, '/keep', pass.token), one, { json: { name }, session }),
    fillRoom: (pass, session, shared) =>
      send(
        DOORMAN_PATHS.room(pass.code, '/from-shared', pass.token),
        body => RoomStateSchema.parse(body),
        { json: { shared }, session },
      ),
  }
}

/** A shared playlist's invite link: opens the join page, in the app or a browser. */
export function sharedInviteLink(
  appUrl: string,
  playlist: Pick<SharedPlaylist, 'id' | 'invite'>,
): string {
  return `${appUrl.replace(/\/+$/, '')}/shared/${playlist.id}/join/${playlist.invite}`
}
