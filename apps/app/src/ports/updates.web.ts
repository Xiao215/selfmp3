import type { UpdatesPort } from './updates'
import { desktop } from './desktop/bridge'
import { NOT_INSTALLED } from './notInstalled'

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
export const updates: UpdatesPort = desktop ? through(desktop) : NOT_INSTALLED.updates
