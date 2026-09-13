import type { ServerConnection } from '@selfmp3/client'

/**
 * The server this page was loaded from, if it was.
 *
 * The Mac serves this build at its own address, and then the page's origin is
 * the server — exactly as the old web app assumed. The same build on GitHub
 * Pages, or on the development server, has no API behind it, so the answer is
 * asked for rather than assumed: a health check that answers like the server
 * means the server.
 */
export async function servedByServer(): Promise<ServerConnection | null> {
  const origin = window.location.origin
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2_500)
  try {
    const response = await fetch(`${origin}/api/health`, { signal: controller.signal })
    if (!response.ok) return null
    const body = (await response.json()) as { ok?: unknown }
    return body.ok === true ? { baseUrl: origin, token: null } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
