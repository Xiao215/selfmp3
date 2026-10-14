import { DEFAULT_APP_URL } from '@selfmp3/shared'
import { appPath } from './appPath'

/**
 * Hand a link to someone, from a browser or the desktop app: the system's
 * share sheet where the browser has one (a phone's Safari, Chrome on a Mac),
 * else the link copied for pasting.
 */
export async function shareLink(
  text: string,
  url: string,
): Promise<'shared' | 'copied' | 'failed'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text, url })
      return 'shared'
    } catch (error) {
      // Dismissed by the person: not a failure worth a copy behind their back.
      if (error instanceof Error && error.name === 'AbortError') return 'failed'
    }
  }
  return (await copyLink(url)) ? 'copied' : 'failed'
}

/**
 * Whether there is a share sheet to hand a link to. A browser without one
 * (Firefox on a computer) would only copy, which Copy already does.
 */
export function canShareLink(): boolean {
  return typeof navigator.share === 'function'
}

/** The link on the clipboard, for pasting. */
export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

/**
 * Where a link to the app opens for someone else: this page's own address in
 * a browser, so a development server's invite opens on it too; the web app
 * from the desktop app, whose own address no other computer can open.
 */
export function appAddress(): string {
  const { protocol, origin } = window.location
  if (protocol !== 'http:' && protocol !== 'https:') return DEFAULT_APP_URL
  return `${origin}${appPath('')}`.replace(/\/+$/, '')
}
