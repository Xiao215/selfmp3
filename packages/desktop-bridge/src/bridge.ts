import type {
  Command,
  DesktopInfo,
  DownloadRequest,
  DownloadResult,
  FileKind,
  FileStat,
  PlaybackState,
  TransferProgress,
  Usage,
} from './schemas.js'

/**
 * `window.selfmp3Desktop`: the whole surface between the page and the shell.
 *
 * The page never sees `ipcRenderer`, `require` or anything else of Node's. The
 * preload exposes exactly this object with `contextBridge`, with
 * `contextIsolation` on, `nodeIntegration` off and `sandbox` on, and the page's
 * one file that reads the global (`apps/app/src/ports/desktop/bridge.ts`) types
 * it as this.
 *
 * Calls go one way and answers come back; events go the other way and are
 * subscribed to. Every listener registration answers with the function that
 * removes it, because a React effect that cannot unsubscribe leaks a listener
 * per mount.
 */
export interface DesktopBridge {
  /** Constant for the life of the process, so the page may read it once. */
  readonly info: DesktopInfo

  /** The keychain. Tokens go here and nowhere else. */
  readonly secrets: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    remove(key: string): Promise<void>
  }

  /**
   * Songs and covers on disk.
   *
   * This is the other half of what an installed app is for. A browser's
   * downloads live in the Cache API, which the browser may evict and which
   * cannot be resumed; these are files in
   * `~/Library/Application Support/self.mp3`, and an interrupted one continues
   * from where it stopped.
   */
  readonly files: {
    /**
     * Stream a URL to `<name>.part` and rename it when the whole thing is
     * there, so a file under its real name is always a complete file.
     * Resolves `cancelled` rather than rejecting when `cancel` was called.
     */
    download(request: DownloadRequest): Promise<DownloadResult>
    /** Abort, leaving the `.part` for a later resume. */
    cancel(id: string): Promise<void>
    delete(kind: FileKind, name: string): Promise<void>
    stat(kind: FileKind, name: string): Promise<FileStat>
    list(kind: FileKind): Promise<readonly { name: string; bytes: number }[]>
    /** A whole small file, with no progress. Covers. */
    fetchTo(
      kind: FileKind,
      name: string,
      url: string,
      headers?: Record<string, string>,
    ): Promise<void>
    usage(): Promise<Usage>
    /** `shell.showItemInFolder`. */
    reveal(kind: FileKind, name?: string): Promise<void>
    /** Everything of a kind, `.part` files included. */
    clear(kind: FileKind): Promise<void>
  }

  /** Progress on a download in flight. */
  onProgress(listener: (progress: TransferProgress) => void): () => void

  /**
   * Where the page may point an `<audio>` or an `<Image>` at a file on disk:
   * `app://selfmp3/_media/<kind>/<name>`, which the shell answers with a proper
   * 206 so seeking works.
   */
  mediaUrl(kind: FileKind, name: string): string

  /**
   * Open a URL in the person's own browser.
   *
   * Which is how signing in works: Google refuses to sign in inside an embedded
   * window, so the system browser does it and the answer comes back through
   * `onDeepLink`.
   */
  openExternal(url: string): Promise<void>

  /** `selfmp3://…` URLs the operating system handed the app. */
  onDeepLink(listener: (url: string) => void): () => void

  /** Menu items and media keys. The menu is the shell's; this is the behaviour. */
  onCommand(listener: (command: Command) => void): () => void

  /**
   * Lets the shell hold a `powerSaveBlocker` while music is playing and label
   * the Dock menu with what is on.
   */
  setPlaybackState(state: PlaybackState): Promise<void>

}

/*
 * Deliberately not here yet: `loginItem` and `updates` (phases 4 and 5). Their
 * channel names and schemas are already in this package, because they are the
 * vocabulary the plan settled, but a member of this interface is a promise that
 * something answers it — and nothing does until the phase that writes the
 * handler. A bridge that declares what it cannot do is worse than one that
 * grows.
 */

export type {
  Command,
  DesktopInfo,
  DownloadRequest,
  DownloadResult,
  FileKind,
  FileStat,
  PlaybackState,
  TransferProgress,
  Usage,
}
