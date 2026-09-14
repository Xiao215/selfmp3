import type { Command, DesktopInfo, PlaybackState } from './schemas.js'

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
 * Deliberately not here yet: `files`, `mediaUrl` and `covers` (phase 3),
 * `loginItem` and `updates` (phases 4 and 5). Their channel names and schemas
 * are already in this package, because they are the vocabulary the plan
 * settled, but a member of this interface is a promise that something answers
 * it — and nothing does until the phase that writes the handler. A bridge that
 * declares what it cannot do is worse than one that grows.
 */

export type { Command, DesktopInfo, PlaybackState }
