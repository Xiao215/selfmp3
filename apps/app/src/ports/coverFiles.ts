/**
 * Cover art kept as files, where that is something this platform can do.
 *
 * `null` on a phone and in an ordinary tab. A phone keeps its covers through
 * expo-file-system (offline/covers.ts) and needs nothing from here; a browser
 * has no folder to keep them in, and no way to hand an `<img>` a bearer token,
 * so a cloud library's covers stay letter tiles there. The installed app has
 * both: the shell fetches with the header and serves the file back from its own
 * origin, which is the whole reason this port exists.
 */
export interface CoverFiles {
  /** Where a kept cover is drawn from, whether or not it is there yet. */
  uriFor(name: string): string
  /** Whether that name is already on disk. */
  has(name: string): Promise<boolean>
  /** Fetch one and keep it, with headers an image loader could not have sent. */
  keep(name: string, url: string, headers?: Record<string, string>): Promise<void>
  /** Everything kept, by name. */
  list(): Promise<readonly string[]>
  /** After signing out: another account's ids mean other songs. */
  forget(): Promise<void>
}

export const coverFiles: CoverFiles | null = null
