import { formatBytes } from '@selfmp3/shared'
import { STORAGE_ROUTE } from './storage.model'

/**
 * First sync, without the screen (docs/ui-mock `P03`, `C02`): whether it is
 * due, what it says about the library arriving, and where its one switch
 * starts.
 *
 * It is shown once per device, straight after the first Google sign-in there,
 * while the library comes down. The switch is the same preference as Settings'
 * "Download automatically on Wi-Fi"; this page only decides where it starts.
 */

/** The preference that remembers this device has seen First sync. */
export const FIRST_SYNC_KEY = 'welcome.firstSync'

/** What is stored under `FIRST_SYNC_KEY` once it has been shown. */
export const FIRST_SYNC_SEEN = 'seen'

/** Whether this device has yet to see First sync, from what is stored for it. */
export function firstSyncDue(stored: string | null): boolean {
  return stored !== FIRST_SYNC_SEEN
}

/**
 * Where Welcome hands over to once the app has a library — or an account
 * whose library has nowhere to be yet, which goes to Where it lives first
 * (`storage.model.ts`), and comes back through here once the bucket is there.
 *
 * First sync only follows a Google sign-in: the address typed in a development
 * build is the simulator tests' way in, and they expect the app itself next.
 *
 * And only where the answer means anything. The page exists to ask whether to
 * keep every song on this device, while the library comes down; a browser tab
 * keeps nothing and streams everything, so there is no question to put and
 * nothing to wait for — it goes straight in (Xiao, 2026-09-22). The desktop
 * app is an installed app and still sees it.
 */
export function afterWelcome(
  fromCloud: boolean,
  stored: string | null,
  installed: boolean,
  needsStorage = false,
): typeof STORAGE_ROUTE | '/first-sync' | '/' {
  if (fromCloud && needsStorage) return STORAGE_ROUTE
  return installed && fromCloud && firstSyncDue(stored) ? '/first-sync' : '/'
}

/**
 * Where "Keep every song" starts: off on a phone, whose room is short and which
 * plays from the bucket anyway; on on a computer, which usually has the room.
 */
export function keepEverySongByDefault(wide: boolean): boolean {
  return wide
}

/** The switch's words, naming the device it is on and how much it would hold. */
export function keepEverySongCopy(
  wide: boolean,
  bytes: number | null,
): { readonly label: string; readonly hint: string } {
  const size = bytes !== null && bytes > 0 ? `About ${formatBytes(bytes)}. ` : ''
  return wide
    ? {
        label: 'Keep every song on this computer',
        hint: `${size}A computer usually has the room, so this is on by default here.`,
      }
    : {
        label: 'Keep every song on this phone',
        hint: `${size}Off, songs stream and stay once played.`,
      }
}

/** "Hello, Xiao", by the first word of the name Google gave, or plain "Hello". */
export function helloLine(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0]
  return first ? `Hello, ${first}` : 'Hello'
}

/** What is known of the library so far: nothing yet, or what it holds. */
export interface LibrarySoFar {
  readonly songs: number
  readonly tags: number
  readonly playlists: number
  /** Songs with a cover to fetch. */
  readonly withArt: number
  /** Of those, how many are on this device already. */
  readonly coversHere: number
  /** Whether this device keeps covers at all: a browser tab does not. */
  readonly keepsCovers: boolean
}

interface Arrival {
  /** "45 songs · 8 tags · 4 playlists", or null while the library is still on its way. */
  readonly summary: string | null
  /** "31 of 45 covers so far", or null when there are no covers to wait for. */
  readonly detail: string | null
  /** How far along the bar is, 0 to 1. */
  readonly fraction: number
}

function count(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`
}

/**
 * How the library's arrival reads.
 *
 * The library itself comes down in one piece, so the part that visibly arrives
 * is the covers, one by one, and the bar is theirs. Where covers are not kept —
 * a browser tab draws each from its own address — there is nothing to wait for
 * once the library is here, and the bar is full.
 */
export function arrival(library: LibrarySoFar | null): Arrival {
  if (library === null) return { summary: null, detail: null, fraction: 0 }
  const summary = [
    count(library.songs, 'song'),
    count(library.tags, 'tag'),
    count(library.playlists, 'playlist'),
  ].join(' · ')
  if (!library.keepsCovers || library.withArt === 0) return { summary, detail: null, fraction: 1 }
  const here = Math.min(library.coversHere, library.withArt)
  return {
    summary,
    detail:
      here === library.withArt
        ? 'Every cover is here'
        : `${here} of ${library.withArt} covers so far`,
    fraction: here / library.withArt,
  }
}

/** How many covers the stack in the card shows before "+N". */
export const STACK_COVERS = 3

/** The "+N" after the stack: every song the stack does not show. */
export function stackRest(songs: number, shown: number): number {
  return Math.max(0, songs - shown)
}
