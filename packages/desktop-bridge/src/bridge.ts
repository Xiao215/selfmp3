import type {
  Command,
  DesktopInfo,
  DownloadRequest,
  DownloadResult,
  FileKind,
  FileStat,
  PlaybackState,
  TransferProgress,
  UpdateStatus,
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
    /**
     * Put text in a file of this kind, atomically.
     *
     * The page's own small documents — the download index, and nothing else so
     * far. `fetchTo` cannot stand in for this: it is the *main* process that
     * fetches, and a `blob:` URL belongs to the renderer that made it, so the
     * main process cannot read one (`net::ERR_UNKNOWN_URL_SCHEME`). Written to
     * `<name>.part` and renamed, like a download, so a reader never sees half
     * an index.
     */
    write(kind: FileKind, name: string, text: string): Promise<void>
    usage(): Promise<Usage>
    /** `shell.showItemInFolder`. */
    reveal(kind: FileKind, name?: string): Promise<void>
    /** Everything of a kind, `.part` files included. */
    clear(kind: FileKind): Promise<void>
  }

  /**
   * Open at login, as a Settings toggle.
   *
   * `get` answers what the operating system currently has, not what was asked
   * for: someone can turn this off in System Settings › General › Login Items,
   * and the toggle should show that rather than what the app last set.
   */
  loginItem: {
    get(): Promise<boolean>
    set(open: boolean): Promise<boolean>
  }

  /**
   * Whether there is a newer version, and what can be done about it.
   *
   * `check` answers the same status the `update` event carries, so a caller can
   * await it or watch. `install` only ever does anything once a status has said
   * `ready`, which an unsigned build never reaches — it offers `releaseUrl`
   * instead, and `canInstall` is how the page knows which to draw.
   */
  updates: {
    check(): Promise<UpdateStatus>
    install(): Promise<void>
    on(listener: (status: UpdateStatus) => void): () => void
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
 * Everything the plan settled is here now. The rule that kept `loginItem` and
 * `updates` out until their handlers existed is worth keeping for whatever
 * comes next: a member of this interface is a promise that something answers
 * it, and a bridge that declares what it cannot do is worse than one that grows.
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
  UpdateStatus,
  Usage,
}
