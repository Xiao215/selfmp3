import { requireOptionalNativeModule } from 'expo'

interface Subscription {
  remove(): void
}

interface SongStreamModule {
  address(
    name: string,
    url: string,
    headers: Readonly<Record<string, string>>,
    directory: string,
  ): string | null
  fetch(
    name: string,
    url: string,
    headers: Readonly<Record<string, string>>,
    directory: string,
  ): Promise<number | null>
  stopAll(): void
  addListener(
    event: 'onArrived',
    listener: (arrived: { name: string; bytes: number }) => void,
  ): Subscription
}

/**
 * A bucket song played from one download of it: the app's own module,
 * `apps/app/modules/song-stream`, a loopback server the player is pointed at
 * instead of the doorman. The first range the player asks for starts one
 * download of the whole file into the played-songs folder, and every range —
 * that one, the next, a seek — is read from it as it arrives, as a tab's
 * service worker and the desktop shell do. Once whole the file is told of
 * (`onArrived`), and kept like any played song (`recentCopies.ts`).
 *
 * Only a file named by the hash of its bytes goes through it: that name is the
 * song's for as long as it is kept.
 *
 * `null` on Android, where the module is not built yet, and in a dev client
 * built before it was added: the player then asks the doorman for each range
 * itself, with the bearer as a header (`bucketMedia.ts`), and a played song is
 * fetched again whole to be kept.
 */
export const songStream: SongStreamModule | null =
  requireOptionalNativeModule<SongStreamModule>('SongStream')

/** What the module will take: `<sha256>.<extension>`, as `fileNameFor` names a bucket song. */
export function streamsOnce(fileName: string): boolean {
  return songStream !== null && /^[0-9a-f]{64}\.[a-z0-9]{1,5}$/.test(fileName)
}
