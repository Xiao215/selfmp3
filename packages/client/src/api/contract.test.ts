import { describe, expect, it } from 'vitest'
import { SERVER_ONLY_ROUTES, createCloudRoutes } from '@selfmp3/replica'
import { API_ERROR } from '@selfmp3/shared'
import { createApi, type Api } from './api.js'
import { ApiError } from './error.js'

/**
 * Every route the app calls has an answer in a cloud library, or is one only
 * a server can give and is listed as such (`SERVER_ONLY_ROUTES`). A route
 * added to the app and to the server, and never to the replica, used to reach
 * a phone as a 501 nobody had decided on: stop following, a playlist played.
 *
 * Each of the app's calls is made through the real cloud routes, signed out:
 * a route the replica answers says so (sign in first), a server-only one says
 * it needs the server, and one that is neither is a 404 — which fails here.
 * `CALLS` names every call in api.ts, so a new one does not compile until it
 * is added.
 */

type Calls = Record<
  Exclude<keyof Api, 'answersFromCloud' | 'onCloudLibraryChanged'>,
  (api: Api) => Promise<unknown>
>

const UID = 'a'.repeat(32)
const GRANT = 'b'.repeat(16)

const CALLS: Calls = {
  library: api => api.library(),
  libraryVersion: api => api.libraryVersion(),
  scan: api => api.scan(),
  manifest: api => api.manifest('playlists'),
  analyze: api => api.analyze(),
  analysisStatus: api => api.analysisStatus(),
  patchSong: api => api.patchSong(1, { loved: true }),
  changeSongTags: api => api.changeSongTags(1, { add: [2], remove: [] }),
  setLoved: api => api.setLoved(1, true),
  recordPlay: api => api.recordPlay(1, { msPlayed: 1000, completed: true }),
  lyrics: api => api.lyrics(1),
  motion: api => api.motion(1),
  lyricsSearch: api => api.lyricsSearch('rain'),
  similar: api => api.similar(1, 5),
  bulkDeleteSongs: api => api.bulkDeleteSongs({ songIds: [1] }),
  mergeSongs: api => api.mergeSongs({ keep: 1, songIds: [2] }),
  bulkEditSongs: api => api.bulkEditSongs({ edits: [] }),
  bulkLoved: api => api.bulkLoved({ songIds: [1], loved: true }),
  lookupMetadata: api => api.lookupMetadata(1),
  applyMetadata: api => api.applyMetadata(1, {} as never),
  removeCover: api => api.removeCover(1),
  fixCoversStart: api => api.fixCoversStart(),
  describePlaylist: api => api.describePlaylist({ text: 'calm', understanding: null }),
  refineAnswer: api => api.refineAnswer({} as never),
  ask: api => api.ask('calm'),
  askProgress: api => api.askProgress('ticket'),
  askStop: api => api.askStop('ticket'),
  untaggedTags: api => api.untaggedTags(),
  suggestMetadata: api => api.suggestMetadata(1),
  written: api => api.written('month' as never),
  tidy: api => api.tidy(),
  importNames: api => api.importNames({ list: null, rows: [{ title: 'x' }] }),
  aiSetup: api => api.aiSetup(),
  checkAi: api => api.checkAi(),
  fixCoversStatus: api => api.fixCoversStatus(),
  fixCoversCancel: api => api.fixCoversCancel(),
  createTag: api => api.createTag({ name: 'rain' }),
  renameTag: api => api.renameTag(1, 'rain'),
  setTagHue: api => api.setTagHue(1, 20),
  deleteTag: api => api.deleteTag(1),
  bulkTag: api => api.bulkTag({ songIds: [1], tagId: 2, action: 'add' }),
  createPlaylist: api => api.createPlaylist({} as never),
  updatePlaylist: api => api.updatePlaylist(1, { name: 'Mix' }),
  deletePlaylist: api => api.deletePlaylist(1),
  stopFollowing: api => api.stopFollowing(1),
  playlistSongs: api => api.playlistSongs(1),
  allPlaylistSongs: api => api.allPlaylistSongs(),
  addToPlaylist: api => api.addToPlaylist(1, { songIds: [1] }),
  removeManyFromPlaylist: api => api.removeManyFromPlaylist(1, [1]),
  reorderPlaylist: api => api.reorderPlaylist(1, [1]),
  markPlaylistPlayed: api => api.markPlaylistPlayed(1),
  importTools: api => api.importTools(),
  importPreview: api => api.importPreview('https://youtu.be/x'),
  importSearch: api => api.importSearch('rain'),
  importFind: api => api.importFind([]),
  importCoverTone: api => api.importCoverTone('https://i.ytimg.com/x.jpg'),
  importAlreadyHave: api => api.importAlreadyHave([]),
  importEnqueue: api => api.importEnqueue({} as never),
  importQueue: api => api.importQueue(),
  cancelImport: api => api.cancelImport('job-1'),
  retryImport: api => api.retryImport('job-1'),
  dismissImport: api => api.dismissImport('job-1'),
  importNext: api => api.importNext('job-1'),
  pauseImports: api => api.pauseImports(),
  resumeImports: api => api.resumeImports(),
  retryFailedImports: api => api.retryFailedImports(),
  removeFailedImports: api => api.removeFailedImports(),
  clearImports: api => api.clearImports(),
  devices: api => api.devices(),
  heartbeat: api => api.heartbeat({} as never),
  deviceCommand: api => api.deviceCommand('iphone-1', {} as never),
  forgetDevice: api => api.forgetDevice('iphone-1'),
  cloudStatus: api => api.cloudStatus(),
  cloudImports: api => api.cloudImports(),
  requestCloudImport: api => api.requestCloudImport({} as never),
  cancelCloudImport: api => api.cancelCloudImport(UID),
  cloudServer: api => api.cloudServer(),
  cloudServerRefused: api => api.cloudServerRefused('t'),
  joinSharedServer: api => api.joinSharedServer(),
  serverGrants: api => api.serverGrants(),
  reportUsage: api => api.reportUsage({ day: '2026-10-23', uses: {}, errors: {} }),
  removeServerGrant: api => api.removeServerGrant(GRANT),
  cloudUids: api => api.cloudUids(),
  health: api => api.health(),
  settings: api => api.settings(),
  updateSettings: api => api.updateSettings({}),
  stats: api => api.stats('month' as never),
  artistBackdrop: api => api.artistBackdrop('Aurora'),
  wrapped: api => api.wrapped('month' as never),
  gems: api => api.gems(5),
  history: api => api.history(5),
}

type Routes = Parameters<typeof createCloudRoutes>

/** The real cloud routes over a device that is signed out and has nothing kept. */
function signedOutRoutes() {
  const platform = {
    sharedServerUrl: 'https://shared.test',
    store: {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      update: () => Promise.resolve(null),
    },
  } as unknown as Routes[0]
  const session = {
    loadSession: () => Promise.resolve(null),
    doormanFetch: () => Promise.reject(new Error('no doorman here')),
  } as unknown as Routes[1]
  return createCloudRoutes(platform, session, {} as Routes[2])
}

describe('the routes the app calls, in a cloud library', () => {
  const asked: { method: string; path: string }[] = []
  const { cloudRequest } = signedOutRoutes()
  const api = createApi({
    context: () => ({
      transport: null,
      fromCloud: true,
      cloudRequest: (method, path, body) => {
        asked.push({ method, path })
        return cloudRequest(method, path, body)
      },
    }),
    fetch: () => Promise.reject(new Error('no server in a cloud library')),
  })

  /** What each call was answered with: a code, or `answered` for no error. */
  async function answers(): Promise<Map<string, string>> {
    const codes = new Map<string, string>()
    for (const [name, call] of Object.entries(CALLS)) {
      const before = asked.length
      const code = await call(api).then(
        () => 'answered',
        (error: unknown) => (error instanceof ApiError ? error.code : String(error)),
      )
      const request = asked[before]
      codes.set(`${name}: ${request?.method ?? '?'} ${request?.path ?? '?'}`, code)
    }
    return codes
  }

  it('are answered by the replica or said to need the server, never unknown', async () => {
    const unknown = [...(await answers())].filter(([, code]) => code === 'not_found')
    expect(unknown).toEqual([])
  })

  it('list nothing as needing the server that the replica answers, or the app never calls', async () => {
    const codes = await answers()
    const serverOnly = [...codes].filter(([, code]) => code === API_ERROR.needsServer)
    // One call for each route listed: none listed that nothing calls.
    expect(serverOnly).toHaveLength(SERVER_ONLY_ROUTES.length)
    // And the replica's own routes are the ones a signed-out device refuses to answer.
    for (const name of ['stopFollowing', 'markPlaylistPlayed', 'recordPlay', 'lyrics']) {
      const [, code] = [...codes].find(([call]) => call.startsWith(`${name}:`)) ?? []
      expect({ name, code }).toEqual({ name, code: 'unauthorized' })
    }
  })
})
