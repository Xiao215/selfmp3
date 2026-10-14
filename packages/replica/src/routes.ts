import {
  API_ERROR,
  AddToPlaylistSchema,
  BulkDeleteSongsSchema,
  BulkEditSongsSchema,
  BulkLovedSchema,
  BulkTagSchema,
  CreatePlaylistSchema,
  CreateTagSchema,
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  DoormanAccessUpdateSchema,
  DoormanError,
  DoormanHealthSchema,
  GemsQuerySchema,
  PlayEventSchema,
  RemoveFromPlaylistSchema,
  RenameTagSchema,
  ReorderPlaylistSchema,
  SetSongTagsSchema,
  SimilarQuerySchema,
  SongPatchSchema,
  UpdatePlaylistSchema,
  extractUrls,
  forgottenGems,
  similarSongs,
  type Affected,
  type PlayRecorded,
  type RemovedFromPlaylist,
} from '@selfmp3/shared'
import { z } from 'zod'
import * as edits from './edits.js'
import { CloudRouteError, notFound } from './errors.js'
import type { CloudLibraryApi } from './library.js'
import type { CloudPlatform } from './platform.js'
import { CloudImportRequestSchema } from './schemas.js'
import type { CloudSession, CloudSessionApi } from './session.js'
import { createSharedServer } from './sharedServer.js'
import type { CloudLibrary } from './snapshotLibrary.js'

/** As much of a query string as any route reads. */
interface RouteQuery {
  get(name: string): string | null
}

/**
 * The query string, parsed by hand.
 *
 * `URLSearchParams` would do it, and React Native's `URL` does not carry one.
 * Only `get` is ever used, so this is the whole of what was needed.
 */
export function parseQuery(search: string): RouteQuery {
  const values = new Map<string, string>()
  for (const pair of search.replace(/^\?/, '').split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = decode(eq === -1 ? pair : pair.slice(0, eq))
    const value = eq === -1 ? '' : decode(pair.slice(eq + 1))
    if (!values.has(key)) values.set(key, value)
  }
  return { get: name => values.get(name) ?? null }
}

/** One part of a query; a `%` that starts no escape is kept as it is, as a browser keeps it. */
function decode(part: string): string {
  const spaced = part.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(spaced)
  } catch {
    return spaced.replace(/(?:%[0-9a-fA-F]{2})+/g, run => {
      try {
        return decodeURIComponent(run)
      } catch {
        return run
      }
    })
  }
}

/**
 * A cloud library's stand-in for the server's API (docs/SYNC.md).
 *
 * In a cloud library there is no `/api` to ask, so `request()` in api.ts sends
 * every call here instead. Reading the library, a playlist, lyrics, what to
 * download: answered from this device's copy of the library. Editing it —
 * songs, tags, playlists, plays — is a change recorded here and uploaded to
 * this device's log, for every other device to replay. The rest — the
 * library's settings among it, which only its server acts on — still needs
 * the server, and says so. Bodies go through the
 * same schemas the server's routes use, and answers are the JSON the server would
 * send.
 */

/**
 * What the app sent, parsed as the server's routes parse it: a shape it does
 * not accept is the asker's mistake, a 400. Kept apart from every other parse
 * here, which reads what the bucket or this device answered — and a shape
 * that fails there is not something the app could have sent differently.
 */
function parseInput<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new CloudRouteError(400, parsed.error.issues[0]?.message ?? 'bad request', 'bad_request')
  }
  return parsed.data as z.output<S>
}

/**
 * What only a server can answer, as `METHOD /path` (`:id` a number, `:any`
 * any one segment): importing, the smart features, Stats, the devices list,
 * the library's settings and the server's own cloud settings, and searching
 * the words of every song,
 * whose index only a server builds. A cloud library answers these with a 501
 * coded `needs_server`, said in so many words; a path in neither this list nor
 * the routes below is a 404, as the server's own unknown paths are. A test
 * holds every route the app calls (@selfmp3/client api.ts) to one or the other.
 */
export const SERVER_ONLY_ROUTES: readonly string[] = [
  'POST /api/library/scan',
  'GET /api/library/analyze',
  'POST /api/library/analyze',
  'GET /api/library/fix-covers',
  'POST /api/library/fix-covers',
  'POST /api/library/fix-covers/cancel',
  'GET /api/lyrics/search',
  'GET /api/songs/:id/lookup',
  'POST /api/songs/:id/apply-metadata',
  'GET /api/ai',
  'POST /api/ai/check',
  'POST /api/ai/describe',
  'POST /api/ai/refine',
  'POST /api/ai/ask',
  'GET /api/ai/ask/progress',
  'POST /api/ai/ask/stop',
  'GET /api/ai/tags/untagged',
  'GET /api/ai/songs/:id/metadata',
  'GET /api/ai/written',
  'GET /api/ai/tidy',
  'GET /api/import/tools',
  'POST /api/import/preview',
  'POST /api/import/search',
  'POST /api/import/find',
  'GET /api/import/cover-tone',
  'POST /api/import/already-have',
  'POST /api/import/enqueue',
  'GET /api/import/queue',
  'POST /api/import/jobs/:any/cancel',
  'POST /api/import/jobs/:any/retry',
  'POST /api/import/jobs/:any/next',
  'DELETE /api/import/jobs/:any',
  'POST /api/import/pause',
  'POST /api/import/resume',
  'POST /api/import/retry-failed',
  'POST /api/import/remove-failed',
  'POST /api/import/clear',
  'GET /api/devices',
  'POST /api/devices/heartbeat',
  'POST /api/devices/:any/command',
  'DELETE /api/devices/:any',
  'GET /api/cloud',
  'GET /api/stats',
  'GET /api/stats/wrapped',
  'GET /api/stats/history',
  'GET /api/artists/backdrop',
  'GET /api/settings',
  'PATCH /api/settings',
]

/** What each kind of path segment a route names may be. */
const SEGMENTS: Readonly<Record<string, RegExp>> = {
  ':id': /^\d+$/,
  ':uid': /^[0-9a-f]{32}$/,
  ':grant': /^[0-9a-f]{16}$/,
  ':any': /^[^/]+$/,
}

type Handler = (input: {
  session: CloudSession
  params: readonly string[]
  query: RouteQuery
  body: unknown
}) => Promise<unknown>

/**
 * The app's questions, answered from this device's own copy.
 *
 * Everything below closes over one device: its library, its session and its
 * platform. Nothing is module state, so two of these could exist at once —
 * which is mostly a way of saying a test can have one.
 */
export function createCloudRoutes(
  platform: CloudPlatform,
  sessionApi: CloudSessionApi,
  library: CloudLibraryApi,
): { cloudRequest: (method: string, path: string, body: unknown) => Promise<unknown> } {
  const {
    cloudLibraryVersion,
    cloudLyrics,
    cloudManifest,
    cloudMotion,
    cloudPlaylistSongs,
    loadCloudLibrary,
    markPlaylistPlayed,
    peekCloudLibrary,
    recordChanges,
  } = library
  const shared = createSharedServer(platform, sessionApi)

  /** Routes as `METHOD /path`: `:id` for a number, `:uid` for a uid, `:grant` for a grant's id. */
  const ROUTES: ReadonlyArray<readonly [string, string, Handler]> = [
    ['GET', '/api/library', async ({ session }) => (await loadCloudLibrary(session)).library],
    ['GET', '/api/library/version', ({ session }) => cloudLibraryVersion(session)],
    [
      'GET',
      '/api/library/manifest',
      async ({ session, query }) => {
        await loadCloudLibrary(session)
        return cloudManifest(query.get('scope') === 'playlists' ? 'playlists' : 'library')
      },
    ],
    [
      'GET',
      '/api/playlists/:id/songs',
      async ({ params }) => ({
        playlistId: id(params),
        songIds: await cloudPlaylistSongs(id(params)),
      }),
    ],
    [
      'GET',
      '/api/songs/:id/similar',
      async ({ session, params, query }) => {
        const { limit } = parseInput(SimilarQuerySchema, { limit: query.get('limit') ?? undefined })
        const view = await loadCloudLibrary(session)
        const seed = songOf(view, id(params))
        return { songId: seed.id, songs: similarSongs(seed, view.library.songs, limit) }
      },
    ],
    [
      'GET',
      '/api/library/gems',
      async ({ session, query }) => {
        const { limit } = parseInput(GemsQuerySchema, { limit: query.get('limit') ?? undefined })
        const { library } = await loadCloudLibrary(session)
        const { gems, minDays, total } = forgottenGems(library.songs, { limit })
        return {
          songs: gems.map(gem => gem.song),
          minDays,
          total,
          generatedAt: new Date().toISOString(),
        }
      },
    ],
    [
      'GET',
      '/api/songs/:id/lyrics',
      async ({ session, params }) => {
        const found = await cloudLyrics(session, id(params))
        // As the server answers: words win over the flag, and a song known to
        // have none says so with its own code, so the app can say "instrumental".
        if (!found) {
          const song = (await peekCloudLibrary(session)).byId.songs.get(id(params))
          if (song?.instrumental) {
            throw new CloudRouteError(404, 'this track is instrumental', API_ERROR.instrumental)
          }
          throw new CloudRouteError(404, 'no lyrics for this track', 'not_found')
        }
        // The bucket's copy: what a server that keeps none of its own answers with.
        return { source: 'cloud', kind: found.kind, text: found.text, romanized: found.romanized }
      },
    ],
    [
      'GET',
      '/api/songs/:id/motion',
      async ({ session, params }) => {
        const found = await cloudMotion(session, id(params))
        if (!found) {
          throw new CloudRouteError(404, 'This song has not been analysed yet.', 'not-analysed')
        }
        return found
      },
    ],

    // --- Songs -----------------------------------------------------------------------

    [
      'PATCH',
      '/api/songs/:id',
      ({ session, params, body }) => {
        const patch = parseInput(SongPatchSchema, body)
        return recordChanges(session, ctx => ({
          changes: edits.editSong(ctx, id(params), patch),
          answer: view => songOf(view, id(params)),
        }))
      },
    ],
    [
      'POST',
      '/api/songs/:id/loved',
      ({ session, params, body }) => {
        const { loved } = parseInput(z.object({ loved: z.boolean() }), body)
        return recordChanges(session, ctx => ({
          changes: edits.editSong(ctx, id(params), { loved }),
          answer: view => songOf(view, id(params)),
        }))
      },
    ],
    [
      'POST',
      '/api/songs/bulk/loved',
      ({ session, body }) => {
        const input = parseInput(BulkLovedSchema, body)
        const wanted = new Set(input.songIds)
        return recordChanges(session, ctx => {
          const affected = ctx.view.library.songs.filter(
            song => wanted.has(song.id) && song.loved !== input.loved,
          ).length
          return {
            changes: edits.loveSongs(ctx, input.songIds, input.loved),
            answer: (): Affected => ({ affected }),
          }
        })
      },
    ],
    [
      'POST',
      '/api/songs/bulk/edit',
      ({ session, body }) => {
        const input = parseInput(BulkEditSongsSchema, body)
        return recordChanges(session, ctx => {
          const here = input.edits.filter(edit => ctx.view.uids.songs.has(edit.songId))
          return {
            changes: here.flatMap(edit => edits.editSong(ctx, edit.songId, edit.patch)),
            answer: (): Affected => ({ affected: here.length }),
          }
        })
      },
    ],
    [
      'PUT',
      '/api/songs/:id/tags',
      ({ session, params, body }) => {
        const { tagIds } = parseInput(SetSongTagsSchema, body)
        return recordChanges(session, ctx => ({
          changes: edits.setSongTags(ctx, id(params), tagIds),
          answer: view => songOf(view, id(params)),
        }))
      },
    ],
    [
      'POST',
      '/api/songs/:id/played',
      ({ session, params, body }) => {
        const event = parseInput(PlayEventSchema, body)
        return recordChanges(
          session,
          ctx => {
            const changes = edits.playSong(ctx, id(params), event)
            return {
              changes,
              answer: (): PlayRecorded => ({ ok: true, duplicate: changes.length === 0 }),
            }
          },
          // The outbox sends a phone's waiting plays one after another.
          { deferView: true },
        )
      },
    ],
    [
      'POST',
      '/api/songs/bulk/delete',
      ({ session, body }) => {
        const input = parseInput(BulkDeleteSongsSchema, body)
        return recordChanges(session, ctx => {
          const asked = [...new Set(input.songIds)]
          const removed = asked.filter(songId => ctx.view.uids.songs.has(songId)).length
          const failed = asked
            .filter(songId => !ctx.view.uids.songs.has(songId))
            .map(songId => ({ songId, reason: `no song with id ${songId}`, removed: false }))
          return {
            changes: edits.removeSongs(ctx, input.songIds),
            answer: () => ({ removed, failed }),
          }
        })
      },
    ],

    // --- Tags ------------------------------------------------------------------------

    [
      'POST',
      '/api/tags',
      ({ session, body }) => {
        const input = parseInput(CreateTagSchema, body)
        return recordChanges(session, ctx => {
          const { changes, uid } = edits.createTag(ctx, input.name, input.hue)
          return { changes, answer: view => tagOf(view, uid) }
        })
      },
    ],
    [
      'PATCH',
      '/api/tags/:id',
      ({ session, params, body }) => {
        const input = parseInput(RenameTagSchema, body)
        return recordChanges(session, ctx => {
          const uid = ctx.view.uids.tags.get(id(params))
          return {
            changes: edits.editTag(ctx, id(params), input),
            answer: view => tagOf(view, uid),
          }
        })
      },
    ],
    [
      'DELETE',
      '/api/tags/:id',
      ({ session, params }) =>
        recordChanges(session, ctx => ({
          changes: edits.removeTag(ctx, id(params)),
          answer: () => ({ ok: true }),
        })),
    ],
    [
      'POST',
      '/api/tags/bulk',
      ({ session, body }) => {
        const input = parseInput(BulkTagSchema, body)
        const wanted = new Set(input.songIds)
        return recordChanges(session, ctx => {
          const on = input.action === 'add'
          const affected = ctx.view.library.songs.filter(
            song => wanted.has(song.id) && song.tagIds.includes(input.tagId) !== on,
          ).length
          return {
            changes: edits.tagSongs(ctx, input.tagId, input.songIds, on),
            answer: (): Affected => ({ affected }),
          }
        })
      },
    ],

    // --- Playlists -------------------------------------------------------------------

    [
      'POST',
      '/api/playlists',
      ({ session, body }) => {
        const input = parseInput(CreatePlaylistSchema, body)
        return recordChanges(session, ctx => {
          const { changes, uid } = edits.createPlaylist(ctx, input)
          return { changes, answer: view => playlistOf(view, uid) }
        })
      },
    ],
    [
      'PATCH',
      '/api/playlists/:id',
      ({ session, params, body }) => {
        const patch = parseInput(UpdatePlaylistSchema, body)
        return recordChanges(session, ctx => ({
          changes: edits.editPlaylist(ctx, id(params), patch),
          answer: view => playlistOf(view, view.uids.playlists.get(id(params))),
        }))
      },
    ],
    [
      'POST',
      '/api/playlists/:id/stop-following',
      ({ session, params }) =>
        recordChanges(session, ctx => ({
          changes: edits.stopFollowing(ctx, id(params)),
          answer: view => playlistOf(view, view.uids.playlists.get(id(params))),
        })),
    ],
    [
      'POST',
      '/api/playlists/:id/played',
      async ({ session, params }) => {
        if (!(await markPlaylistPlayed(session, id(params)))) throw notFound('playlist')
        return { ok: true }
      },
    ],
    [
      'DELETE',
      '/api/playlists/:id',
      ({ session, params }) =>
        recordChanges(session, ctx => ({
          changes: edits.removePlaylist(ctx, id(params)),
          answer: () => ({ ok: true }),
        })),
    ],
    [
      'POST',
      '/api/playlists/:id/songs',
      ({ session, params, body }) => {
        const input = parseInput(AddToPlaylistSchema, body)
        return recordChanges(session, ctx => ({
          changes: edits.addToPlaylist(ctx, id(params), input.songIds, input.position),
          answer: view => playlistOf(view, view.uids.playlists.get(id(params))),
        }))
      },
    ],
    [
      'POST',
      '/api/playlists/:id/songs/remove',
      ({ session, params, body }) => {
        const { songIds } = parseInput(RemoveFromPlaylistSchema, body)
        return recordChanges(session, ctx => {
          const inIt = new Set(ctx.view.playlistSongs[id(params)] ?? [])
          const removed = [...new Set(songIds)].filter(songId => inIt.has(songId)).length
          return {
            changes: edits.removeFromPlaylist(ctx, id(params), songIds),
            answer: (view): RemovedFromPlaylist => ({
              removed,
              playlist: playlistOf(view, view.uids.playlists.get(id(params))),
            }),
          }
        })
      },
    ],
    [
      'PUT',
      '/api/playlists/:id/order',
      ({ session, params, body }) => {
        const { songIds } = parseInput(ReorderPlaylistSchema, body)
        return recordChanges(session, ctx => ({
          changes: edits.reorderPlaylist(ctx, id(params), songIds),
          answer: () => ({ ok: true }),
        }))
      },
    ],
    // --- Importing, by asking the server -----------------------------------------------

    [
      'GET',
      '/api/cloud/imports',
      async ({ session }) => ({ imports: (await loadCloudLibrary(session)).imports }),
    ],
    [
      'POST',
      '/api/cloud/imports',
      ({ session, body }) => {
        const input = parseInput(CloudImportRequestSchema, body)
        // A share sheet sends the link inside other text; the first one is it.
        const url = extractUrls(input.url).find(link => /^https?:\/\//i.test(link))
        if (!url || url.length > 2000) {
          throw new CloudRouteError(400, 'That doesn’t look like a link.', 'bad_request')
        }
        return recordChanges(session, ctx => {
          const { changes, uid } = edits.requestImport(ctx, { ...input, url })
          return {
            changes,
            answer: view => {
              const made = view.imports.find(item => item.uid === uid)
              if (!made) throw notFound('import')
              return made
            },
          }
        })
      },
    ],
    [
      'DELETE',
      '/api/cloud/imports/:uid',
      ({ session, params }) =>
        recordChanges(session, ctx => ({
          changes: edits.cancelImport(ctx, params[0] ?? ''),
          answer: () => ({ ok: true }),
        })),
    ],
    // Where the server is, for a device that would rather ask it directly.
    // Asked every few seconds by every screen that might use the server, so
    // from this device's copy alone: as a library read, it was a look at the
    // bucket — two counted listings — every eighty seconds the app was open.
    // With none named, the shared server: joined by itself the first time this
    // is asked, then kept until the snapshot names it (sharedServer.ts).
    [
      'GET',
      '/api/cloud/server',
      async ({ session }) => ({
        server: await shared.automatic(session, (await peekCloudLibrary(session)).server),
      }),
    ],
    [
      'POST',
      '/api/cloud/server/join',
      async ({ session }) => ({ server: await shared.join(session) }),
    ],
    // Who may sign in, for the doorman's owner (apps/doorman/src/access.ts).
    ['GET', '/api/cloud/access', ({ session }) => shared.access(session)],
    [
      'PUT',
      '/api/cloud/access',
      ({ session, body }) =>
        shared.updateAccess(session, parseInput(DoormanAccessUpdateSchema, body)),
    ],
    // The servers this account has let into its bucket, from the doorman.
    ['GET', '/api/cloud/grants', ({ session }) => shared.grants(session)],
    [
      'DELETE',
      '/api/cloud/grants/:grant',
      async ({ session, params }) => {
        await shared.removeGrant(session, params[0] ?? '')
        return { ok: true }
      },
    ],
    /*
     * The uid behind each of this device's song ids — the other half of the
     * server's table of the same name. A screen that asks the server directly
     * gets answers in the server's numbers, and lines them up with these.
     */
    [
      'GET',
      '/api/cloud/uids',
      async ({ session }) => {
        const view = await peekCloudLibrary(session)
        return { songs: [...view.uids.songs].map(([id, uid]) => ({ id, uid })) }
      },
    ],
  ]

  async function cloudRequest(method: string, path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, 'https://app.invalid')

    try {
      if (method === 'GET' && url.pathname === '/api/health') return await health()

      for (const [routeMethod, pattern, handler] of ROUTES) {
        if (routeMethod !== method) continue
        const params = match(pattern, url.pathname)
        if (!params) continue
        const session = await sessionApi.loadSession()
        if (!session) throw new CloudRouteError(401, 'Sign in with Google first.', 'unauthorized')
        return await handler({ session, params, query: parseQuery(url.search), body })
      }
    } catch (error) {
      if (error instanceof CloudRouteError) throw error
      // Not the request (that is `parseInput`): what the bucket or this device's
      // copy answered — the wrong shape, or not JSON at all. Anything else that
      // is not a CloudRouteError reaches the app as "offline", which this is not.
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        const why =
          error instanceof z.ZodError ? (error.issues[0]?.message ?? 'shape mismatch') : 'not JSON'
        throw new CloudRouteError(
          502,
          `Unexpected answer from the bucket: ${why}`,
          API_ERROR.contractMismatch,
        )
      }
      if (error instanceof DoormanError) {
        throw new CloudRouteError(
          error.status,
          error.message,
          error.status === 0 ? API_ERROR.offline : error.code,
        )
      }
      throw error
    }

    for (const route of SERVER_ONLY_ROUTES) {
      const [routeMethod = '', pattern = ''] = route.split(' ')
      if (routeMethod === method && match(pattern, url.pathname)) {
        throw new CloudRouteError(501, 'This needs your server.', API_ERROR.needsServer)
      }
    }
    throw new CloudRouteError(404, 'no such endpoint', 'not_found')
  }

  /** The `:id`, `:uid`, `:grant` and `:any` segments a path filled in, or null when it is not this route. */
  function match(pattern: string, pathname: string): string[] | null {
    const want = pattern.split('/')
    const have = pathname.split('/')
    if (want.length !== have.length) return null
    const params: string[] = []
    for (let i = 0; i < want.length; i++) {
      const shape = SEGMENTS[want[i] ?? '']
      if (shape) {
        if (!shape.test(have[i] ?? '')) return null
        params.push(have[i] ?? '')
      } else if (want[i] !== have[i]) {
        return null
      }
    }
    return params
  }

  const id = (params: readonly string[]): number => Number(params[0])

  function songOf(view: CloudLibrary, songId: number) {
    const found = view.byId.songs.get(songId)
    if (!found) throw notFound('song')
    return found
  }

  function tagOf(view: CloudLibrary, uid: string | undefined) {
    const tagId = uid === undefined ? undefined : view.ids.tags[uid]
    const found = tagId === undefined ? undefined : view.byId.tags.get(tagId)
    if (!found) throw notFound('tag')
    return found
  }

  function playlistOf(view: CloudLibrary, uid: string | undefined) {
    const playlistId = uid === undefined ? undefined : view.ids.playlists[uid]
    const found = playlistId === undefined ? undefined : view.byId.playlists.get(playlistId)
    if (!found) throw notFound('playlist')
    return found
  }

  /** "Reachable" means the doorman answers: a cloud library's only server. */
  async function health(): Promise<unknown> {
    const response = await sessionApi.doormanFetch(null, DOORMAN_PATHS.health)
    if (!response.ok) {
      throw new DoormanError(
        response.status,
        DOORMAN_ERROR.notFound,
        'the doorman is not answering',
      )
    }
    // A 200 is not yet an answer: a captive portal or a proxy's login page
    // returns one too, and this route's whole job is to say the doorman is
    // really there. Status 0, as for no answer at all: a 200 from something
    // else is the doorman being out of reach, which the app calls offline.
    if (!DoormanHealthSchema.safeParse(await response.json().catch(() => null)).success) {
      throw new DoormanError(0, DOORMAN_ERROR.unexpected, 'the doorman is not answering')
    }
    // No song count: the library's is on screen beside it, and a made-up 0 read
    // "self.mp3 web · 0 songs" over a library of thirty.
    return { ok: true, version: 'web', uptimeSeconds: 0, libraryPath: 'the cloud' }
  }

  return { cloudRequest }
}
