/**
 * Whether there is a newer self.mp3, for an app that can be replaced.
 *
 * `available` is false in a browser and on a phone: a tab is whatever the
 * server last sent, and the App Store owns a phone's version. Only the
 * installed desktop app has a copy of itself on a disk that could be out of
 * date, and only some of its builds can do anything about it — `canInstall` on
 * the status, which is false for an unsigned build, because Squirrel refuses to
 * apply an update whose signature it cannot verify.
 */
export interface UpdateState {
  readonly state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  readonly version: string | null
  readonly releaseUrl: string | null
  readonly canInstall: boolean
  readonly message: string | null
}

export interface UpdatesPort {
  readonly available: boolean
  /** What this copy is, for Settings to show beside the check. */
  readonly version: string | null
  check(): Promise<UpdateState>
  /** Quit and swap. Only ever reachable when a status said `ready`. */
  install(): Promise<void>
  on(listener: (status: UpdateState) => void): () => void
}

const IDLE: UpdateState = {
  state: 'idle',
  version: null,
  releaseUrl: null,
  canInstall: false,
  message: null,
}

export const updates: UpdatesPort = {
  available: false,
  version: null,
  check: () => Promise.resolve(IDLE),
  install: () => Promise.resolve(),
  on: () => () => {},
}
