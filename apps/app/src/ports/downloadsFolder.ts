/**
 * Where this device's downloaded songs are, if that is a thing a person can be
 * shown.
 *
 * `null` on a phone and in a browser. A phone's files are inside the app's
 * sandbox and there is no Finder to open; a browser's are in the Cache API and
 * are not files at all.
 */
export interface DownloadsFolder {
  /** A path worth showing someone, or null. */
  readonly path: string | null
  /** Open it where the operating system shows folders. */
  reveal(): Promise<void>
  /** Bytes used, and free on the volume — or null where nothing can say. */
  usage(): Promise<{ songs: number; covers: number; free: number } | null>
}

export const downloadsFolder: DownloadsFolder = {
  path: null,
  reveal: () => Promise.resolve(),
  usage: () => Promise.resolve(null),
}
