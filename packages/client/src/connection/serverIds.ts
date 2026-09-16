import type { CloudUids } from '@selfmp3/shared'

/**
 * Two libraries' numbers for the same songs, lined up.
 *
 * A cloud library hands out ids of its own as uids arrive from the bucket
 * (`snapshotToLibrary`), and the server behind it has its database's. So a
 * screen that asks the server directly (reach.ts) gets answers about songs
 * numbered a way this device has never used: the play in the stats is song 812
 * there and song 47 here, and a metadata lookup for song 47 here has to be
 * asked for as 812.
 *
 * The uid is the one name both know a song by, and `/api/cloud/uids` is each
 * library's list of them. Both sides answer it — the server from its database,
 * this device from its snapshot — and this turns the pair into a translation
 * both ways. A song only one side has simply has no answer, which is the honest
 * result: it is not yet uploaded, or not yet in this device's copy.
 */
export interface SongIds {
  /** The server's id for the song this device numbers `songId`. */
  readonly onServer: (songId: number) => number | undefined
  /** This device's id for the song the server numbers `songId`. */
  readonly onDevice: (songId: number) => number | undefined
  /** False until both lists are in: nothing can be lined up from one of them. */
  readonly ready: boolean
}

export function songIds(device: CloudUids | undefined, server: CloudUids | undefined): SongIds {
  if (!device || !server) {
    return { onServer: () => undefined, onDevice: () => undefined, ready: false }
  }
  const serverByUid = new Map(server.songs.map(song => [song.uid, song.id]))
  const onServer = new Map<number, number>()
  const onDevice = new Map<number, number>()
  for (const song of device.songs) {
    const there = serverByUid.get(song.uid)
    if (there === undefined) continue
    onServer.set(song.id, there)
    onDevice.set(there, song.id)
  }
  return {
    onServer: songId => onServer.get(songId),
    onDevice: songId => onDevice.get(songId),
    ready: true,
  }
}
