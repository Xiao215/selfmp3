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
