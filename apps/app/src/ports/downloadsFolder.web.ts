import type { DownloadsFolder } from './downloadsFolder'
import { desktop } from './desktop/bridge'

export type { DownloadsFolder }

/**
 * Where this device's downloaded songs are.
 *
 * The installed app has a real folder and a Finder to open it in, which is one
 * of the plain reasons to install it: the music you own is somewhere you can
 * point at. An ordinary tab has the Cache API, which is not a place, so it
 * answers null and Settings shows nothing.
 *
 * `usage` comes from the shell rather than from the index, because the two can
 * disagree and the disk is the one that is right — and because free space is
 * something only the shell can see, which is what the 500 MB rule is really
 * asking about.
 */
function folderFor(bridge: NonNullable<typeof desktop>): DownloadsFolder {
  return {
    path: bridge.info.songsDir,
    reveal: () => bridge.files.reveal('songs'),
    usage: () => bridge.files.usage(),
  }
}

export const downloadsFolder: DownloadsFolder = desktop
  ? folderFor(desktop)
  : {
      path: null,
      reveal: () => Promise.resolve(),
      usage: () => Promise.resolve(null),
    }
