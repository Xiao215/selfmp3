import { onMac } from '@selfmp3/client'
import { fetchLatestRelease, type MacChip } from '@selfmp3/shared'

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

/** See `macApp.ts`. A tab on a Mac is offered the app; the app itself is not. */
export const macApp: MacAppPort = {
  offered:
    desktop === null &&
    typeof navigator !== 'undefined' &&
    onMac(navigator.userAgent, navigator.maxTouchPoints ?? 0),
  chip,
  // Settings asks once and keeps the answer.
  latest: () => fetchLatestRelease(fetch),
}
