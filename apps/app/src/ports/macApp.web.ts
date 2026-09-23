import { onMac } from '@selfmp3/client'
import {
  LATEST_RELEASE_API,
  macInstallers,
  type MacChip,
  type MacInstallers,
} from '@selfmp3/shared'

import { desktop } from './desktop/bridge'
import type { MacAppPort } from './macApp'

export type { MacAppPort }

/**
 * Client Hints' name for the CPU: `arm` on Apple silicon, `x86` on an Intel
 * Mac. Only Chromium has `userAgentData`, and only its high-entropy call says
 * the architecture; neither is in TypeScript's DOM library yet.
 */
interface UserAgentData {
  getHighEntropyValues(hints: readonly string[]): Promise<{ architecture?: string }>
}

async function chip(): Promise<MacChip | null> {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
  if (!data) return null
  try {
    const { architecture } = await data.getHighEntropyValues(['architecture'])
    if (architecture === 'arm') return 'arm64'
    if (architecture === 'x86') return 'x64'
    return null
  } catch {
    return null
  }
}

/**
 * GitHub's public API, with no token: sixty asks an hour from one address, and
 * Settings asks once and keeps the answer. A 404 is "no release yet", which is
 * an answer and not a failure; anything else is thrown for the panel to say.
 */
async function latest(): Promise<MacInstallers | null> {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  return macInstallers(await response.json())
}

/** See `macApp.ts`. A tab on a Mac is offered the app; the app itself is not. */
export const macApp: MacAppPort = {
  offered:
    desktop === null &&
    typeof navigator !== 'undefined' &&
    onMac(navigator.userAgent, navigator.maxTouchPoints ?? 0),
  chip,
  latest,
}
