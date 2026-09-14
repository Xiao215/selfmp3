import type { UpdateState, UpdatesPort } from './updates'
import { desktop } from './desktop/bridge'

export type { UpdateState, UpdatesPort }

const IDLE: UpdateState = {
  state: 'idle',
  version: null,
  releaseUrl: null,
  canInstall: false,
  message: null,
}

function through(bridge: NonNullable<typeof desktop>): UpdatesPort {
  return {
    available: true,
    version: bridge.info.version,
    check: () => bridge.updates.check(),
    install: () => bridge.updates.install(),
    on: listener => bridge.updates.on(listener),
  }
}

/** See `updates.ts`. A tab has nothing on disk that could be out of date. */
export const updates: UpdatesPort = desktop
  ? through(desktop)
  : {
      available: false,
      version: null,
      check: () => Promise.resolve(IDLE),
      install: () => Promise.resolve(),
      on: () => () => {},
    }
