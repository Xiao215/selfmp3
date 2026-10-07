import { describe, expect, it } from 'vitest'

import { APP_ORIGIN, APP_SCHEME } from '@selfmp3/desktop-bridge'
import { DESKTOP_APP_ORIGIN } from '@selfmp3/shared'

/**
 * The installed app's origin, spelled in two packages that do not depend on
 * each other: the bridge's, which the shell serves and the preload builds
 * media URLs on, and shared's, which the server and the doorman let through.
 * One drifting from the other is an app whose every request is refused.
 */
describe("the desktop app's origin", () => {
  it('is the same in the bridge and in shared', () => {
    expect(APP_ORIGIN).toBe(DESKTOP_APP_ORIGIN)
  })

  it('is served on the scheme the shell registers', () => {
    expect(new URL(APP_ORIGIN).protocol).toBe(`${APP_SCHEME}:`)
  })
})
