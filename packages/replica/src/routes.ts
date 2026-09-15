import {
  AddToPlaylistSchema,
  BulkDeleteSongsSchema,
  BulkLovedSchema,
  BulkTagSchema,
  CreatePlaylistSchema,
  CreateTagSchema,
  DEFAULT_SETTINGS,
  PlayEventSchema,
  RemoveFromPlaylistSchema,
  RenameTagSchema,
  ReorderPlaylistSchema,
  SetSongTagsSchema,
  SettingsSchema,
  SkipEventSchema,
  SmartRulesSchema,
  SongPatchSchema,
  UpdatePlaylistSchema,
  describeSmartRules,
  extractUrls,
  similarSongs,
  livePlaylistSongs,
  toCloudRules,
  type Settings,
} from '@selfmp3/shared'
import { z } from 'zod'
import * as edits from './edits.js'
import { CloudRouteError, notFound } from './errors.js'
import type { CloudLibraryApi } from './library.js'
import type { CloudPlatform } from './platform.js'
import { CloudImportRequestSchema } from './schemas.js'
import { DoormanError, type CloudSession, type CloudSessionApi } from './session.js'
import type { CloudLibrary } from './snapshotLibrary.js'

export { CloudRouteError } from './errors.js'

/** As much of a query string as any route reads. */
export interface RouteQuery {
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
    const key = decodeURIComponent((eq === -1 ? pair : pair.slice(0, eq)).replace(/\+/g, ' '))
    const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '))
    if (!values.has(key)) values.set(key, value)
  }
  return { get: name => values.get(name) ?? null }
}

/**
 * A cloud library's stand-in for the server's API (docs/SYNC.md).
 *
 * In a cloud library there is no `/api` to ask, so `request()` in api.ts sends
 * every call here instead. Reading the library, a playlist, lyrics, what to
 * download: answered from this device's copy of the library. Editing it —
 * songs, tags, playlists, plays — is a change recorded here and uploaded to
 * this device's log, for every other device to replay. Settings live on this
 * device. The rest still needs the server, and says so. Bodies go through the
 * same schemas the server's routes use, and answers are the JSON the server would
 * send.
 */

const SETTINGS_KEY = 'selfmp3.cloud.settings'

type Handler = (input: {
  session: CloudSession
  params: readonly string[]
  query: RouteQuery
  body: unknown
}) => Promise<unknown>

/** Routes as `METHOD /path`: `:id` for a number, `:uid` for a uid. */
/**
 * The app's questions, answered from this device's own copy.
 *
 * Everything below closes over one device: its library, its session and its
 * platform. Nothing is module state, so two of these could exist at once —
 * which is mostly a way of saying a test can have one.
 */
export function createCloudRoutes(
  platform: CloudPlatform,
  session_: CloudSessionApi,
  library: CloudLibraryApi,
): { cloudRequest: (method: string, path: string, body: unknown) => Promise<unknown> } {
  const {
    cloudLibraryVersion,
    cloudLyrics,
    cloudManifest,
    cloudMotion,
    cloudPlaylistSongs,
    currentSongs,
    loadCloudLibrary,
    recordChanges,
  } = library

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
        const { library } = await loadCloudLibrary(session)
        const seed = library.songs.find(song => song.id === id(params))
        if (!seed) throw notFound('song')
        const limit = Math.min(Math.max(Number(query.get('limit')) || 20, 1), 100)
        return { songId: seed.id, songs: similarSongs(seed, library.songs, limit) }
      },
    ],
    [
      'GET',
      '/api/songs/:id/lyrics',
      async ({ session, params }) => {
        const found = await cloudLyrics(session, id(params))
        if (!found) throw new CloudRouteError(404, 'No lyrics for this song.', 'not_found')
        return { source: 'sidecar', kind: found.kind, text: found.text, romanized: found.romanized }
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
        const patch = SongPatchSchema.parse(body)
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
        const { loved } = z.object({ loved: z.boolean() }).parse(body)
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
        const input = BulkLovedSchema.parse(body)
        return recordChanges(session, ctx => {
          const affected = ctx.view.library.songs.filter(
            song => input.songIds.includes(song.id) && song.loved !== input.loved,
          ).length
          return {
            changes: edits.loveSongs(ctx, input.songIds, input.loved),
            answer: () => ({ affected }),
          }
        })
      },
    ],
    [
      'PUT',
      '/api/songs/:id/tags',
      ({ session, params, body }) => {
        const { tagIds } = SetSongTagsSchema.parse(body)
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
        const event = PlayEventSchema.parse(body)
        return recordChanges(session, ctx => ({
          changes: edits.playSong(ctx, id(params), event),
          answer: () => ({ ok: true, duplicate: false }),
        }))
      },
    ],
    [
      'POST',
      '/api/songs/:id/skipped',
      ({ session, params, body }) => {
        const { atSeconds } = SkipEventSchema.parse(body)
        return recordChanges(session, ctx => ({
          changes: edits.skipSong(ctx, id(params), atSeconds),
          answer: () => ({ ok: true }),
        }))
      },
    ],
    [
      'DELETE',
      '/api/songs/:id',
      ({ session, params, query }) => {
        const deleteFile = query.get('deleteFile') === '1'
        return recordChanges(session, ctx => {
          edits.song(ctx, id(params))
          return {
            changes: edits.removeSongs(ctx, [id(params)], deleteFile),
            answer: () => ({ ok: true, fileDeleted: deleteFile }),
          }
        })
      },
    ],
    [
      'POST',
      '/api/songs/bulk/delete',
      ({ session, body }) => {
        const input = BulkDeleteSongsSchema.parse(body)
        return recordChanges(session, ctx => {
          const changes = edits.removeSongs(ctx, input.songIds, input.deleteFile)
          const failed = [...new Set(input.songIds)]
            .filter(songId => !ctx.view.uids.songs.has(songId))
            .map(songId => ({ songId, reason: `no song with id ${songId}`, removed: false }))
          return {
            changes,
            answer: () => ({
              removed: changes.length,
              filesDeleted: input.deleteFile ? changes.length : 0,
              failed,
            }),
          }
        })
      },
    ],

    // --- Tags ------------------------------------------------------------------------

    [
      'POST',
      '/api/tags',
      ({ session, body }) => {
        const input = CreateTagSchema.parse(body)
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
        const input = RenameTagSchema.parse(body)
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
        const input = BulkTagSchema.parse(body)
        return recordChanges(session, ctx => {
          const on = input.action === 'add'
          const affected = ctx.view.library.songs.filter(
            song => input.songIds.includes(song.id) && song.tagIds.includes(input.tagId) !== on,
          ).length
          return {
            changes: edits.tagSongs(ctx, input.tagId, input.songIds, on),
            answer: () => ({ affected }),
          }
        })
      },
    ],

    // --- Playlists -------------------------------------------------------------------

    [
      'POST',
      '/api/playlists',
      ({ session, body }) => {
        const input = CreatePlaylistSchema.parse(body)
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
        const patch = UpdatePlaylistSchema.parse(body)
        return recordChanges(session, ctx => ({
          changes: edits.editPlaylist(ctx, id(params), patch),
          answer: view => playlistOf(view, view.uids.playlists.get(id(params))),
        }))
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
        const input = AddToPlaylistSchema.parse(body)
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
        const { songIds } = RemoveFromPlaylistSchema.parse(body)
        return recordChanges(session, ctx => {
          const inIt = new Set(ctx.view.playlistSongs[id(params)] ?? [])
          const removed = [...new Set(songIds)].filter(songId => inIt.has(songId)).length
          return {
            changes: edits.removeFromPlaylist(ctx, id(params), songIds),
            answer: view => ({
              removed,
              playlist: playlistOf(view, view.uids.playlists.get(id(params))),
            }),
          }
        })
      },
    ],
    [
      'DELETE',
      '/api/playlists/:id/songs/:id',
      ({ session, params }) =>
        recordChanges(session, ctx => ({
          changes: edits.removeFromPlaylist(ctx, id(params), [id(params, 1)]),
          answer: view => playlistOf(view, view.uids.playlists.get(id(params))),
        })),
    ],
    [
      'PUT',
      '/api/playlists/:id/order',
      ({ session, params, body }) => {
        const { songIds } = ReorderPlaylistSchema.parse(body)
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
        const input = CloudImportRequestSchema.parse(body)
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
    [
      'GET',
      '/api/cloud/server',
      async ({ session }) => ({ server: (await loadCloudLibrary(session)).server }),
    ],

    [
      'POST',
      '/api/playlists/preview',
      async ({ session, body }) => {
        const { rules } = z.object({ rules: SmartRulesSchema.nullable() }).parse(body)
        if (!rules) return { songIds: [], description: 'No rules yet' }
        const view = await loadCloudLibrary(session)
        const uids = view.uids
        const songIdOf = new Map([...uids.songs].map(([songId, uid]) => [uid, songId]))
        const songs = currentSongs()
        const matched = livePlaylistSongs(
          toCloudRules(rules, tagId => uids.tags.get(tagId) ?? null),
          songs,
        )
        return {
          songIds: matched.flatMap(uid => {
            const songId = songIdOf.get(uid)
            return songId === undefined ? [] : [songId]
          }),
          description: describeSmartRules(
            rules,
            new Map(view.library.tags.map(tag => [tag.id, tag.name])),
          ),
        }
      },
    ],
  ]

  async function cloudRequest(method: string, path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, 'https://app.invalid')

    try {
      if (method === 'GET' && url.pathname === '/api/settings') return await loadSettings()
      if (method === 'PATCH' && url.pathname === '/api/settings') return await saveSettings(body)
      if (method === 'GET' && url.pathname === '/api/health') return await health()

      for (const [routeMethod, pattern, handler] of ROUTES) {
        if (routeMethod !== method) continue
        const params = match(pattern, url.pathname)
        if (!params) continue
        const session = await session_.loadSession()
        if (!session) throw new CloudRouteError(401, 'Sign in with Google first.', 'unauthorized')
        return await handler({ session, params, query: parseQuery(url.search), body })
      }
    } catch (error) {
      if (error instanceof CloudRouteError) throw error
      if (error instanceof z.ZodError) {
        throw new CloudRouteError(400, error.issues[0]?.message ?? 'bad request', 'bad_request')
      }
      if (error instanceof DoormanError) {
        throw new CloudRouteError(
          error.status,
          error.message,
          error.status === 0 ? 'offline' : error.code,
        )
      }
      throw error
    }

    throw new CloudRouteError(
      501,
      'Not in a cloud library yet — this still needs your server.',
      'needs-server',
    )
  }

  /** The numbers standing for `:id` in a path, or null when it is not this route. */
  function match(pattern: string, pathname: string): string[] | null {
    const want = pattern.split('/')
    const have = pathname.split('/')
    if (want.length !== have.length) return null
    const params: string[] = []
    for (let i = 0; i < want.length; i++) {
      if (want[i] === ':id' || want[i] === ':uid') {
        const pattern = want[i] === ':id' ? /^\d+$/ : /^[0-9a-f]{32}$/
        if (!pattern.test(have[i] ?? '')) return null
        params.push(have[i] ?? '')
      } else if (want[i] !== have[i]) {
        return null
      }
    }
    return params
  }

  const id = (params: readonly string[], index = 0): number => Number(params[index])

  function songOf(view: CloudLibrary, songId: number) {
    const found = view.library.songs.find(song => song.id === songId)
    if (!found) throw notFound('song')
    return found
  }

  function tagOf(view: CloudLibrary, uid: string | undefined) {
    const tagId = uid === undefined ? undefined : view.ids.tags[uid]
    const found = view.library.tags.find(tag => tag.id === tagId)
    if (!found) throw notFound('tag')
    return found
  }

  function playlistOf(view: CloudLibrary, uid: string | undefined) {
    const playlistId = uid === undefined ? undefined : view.ids.playlists[uid]
    const found = view.library.playlists.find(playlist => playlist.id === playlistId)
    if (!found) throw notFound('playlist')
    return found
  }

  /** "Reachable" means the doorman answers: a cloud library's only server. */
  async function health(): Promise<unknown> {
    const response = await session_.doormanFetch(null, '/v1/health')
    if (!response.ok) throw new DoormanError(response.status, 'the doorman is not answering')
    return {
      ok: true,
      version: 'web',
      uptimeSeconds: 0,
      libraryPath: 'the cloud',
      storageDriver: 'cloud',
      songCount: 0,
    }
  }

  async function loadSettings(): Promise<Settings> {
    try {
      const stored = await platform.store.read(SETTINGS_KEY)
      const parsed = SettingsSchema.safeParse({
        ...DEFAULT_SETTINGS,
        ...(typeof stored === 'object' && stored !== null ? stored : {}),
      })
      return parsed.success ? parsed.data : DEFAULT_SETTINGS
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  /** Kept on this device: with no server to share them through, they are its own. */
  async function saveSettings(patch: unknown): Promise<Settings> {
    const next = SettingsSchema.parse({ ...(await loadSettings()), ...(patch as object) })
    try {
      await platform.store.write(SETTINGS_KEY, next)
    } catch {
      // No storage: the change holds until the app is closed.
    }
    return next
  }

  return { cloudRequest }
}
