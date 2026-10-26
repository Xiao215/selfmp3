import { STORAGE_ROUTE } from '../features/welcome/storage.model'

/**
 * The way in: Welcome, Where it lives and First sync. Each replaces the
 * screen it leaves rather than being pushed onto it, so nothing is behind it
 * to go back to (`backGesture.ts`).
 */
export const GATE_ROUTES: readonly string[] = ['/welcome', STORAGE_ROUTE, '/first-sync']

/**
 * The pages that take the whole display at every width — the way in, and Now
 * Playing. No tab bar or mini player is drawn over them (`pageChrome.ts`), and
 * each has its own entrance rather than the shell's page step (`pageStep.ts`).
 */
export const FULL_SCREEN_ROUTES: readonly string[] = [...GATE_ROUTES, '/now-playing']

/**
 * The pages that open without signing in: joining a room from its invite
 * link, the room itself, and a share link — all a friend without self.mp3
 * ever sees (docs/features/listen-together.md, docs/features/share-links.md).
 * Each has its own head, so no chrome. In a room, Search too: it is where a
 * guest adds what is in the room, or a link (A2).
 */
export function opensSignedOut(pathname: string, inRoom = false): boolean {
  // A shared playlist's invite opens too, to say that joining one needs signing in.
  return (
    pathname === '/room' ||
    (inRoom && pathname === '/search') ||
    pathname.startsWith('/join/') ||
    pathname.startsWith('/l/') ||
    /^\/shared\/[^/]+\/join\//.test(pathname)
  )
}
