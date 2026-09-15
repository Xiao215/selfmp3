import { pageKeptCombinations, type Command } from '@selfmp3/desktop-bridge'

/**
 * The playback keys the page answers itself, by combination.
 *
 * In the installed app, the ones its menu draws but leaves to the page: Space
 * and the ⌘-arrows (`pageKeptCombinations`).
 *
 * In a browser tab, Space alone, for play and pause — what anyone who has
 * paused a video or a web player expects of a page that plays music. The rest
 * belong to the browser: ⌘← and ⌘→ are Back and Forward, and ⌥⌘← and ⌥⌘→
 * change tabs. ⌘K stays the browser's too (decided 2026-09-14; Space added
 * the same night).
 */
export function playbackKeys(installedApp: boolean): ReadonlyMap<string, Command> {
  return installedApp ? pageKeptCombinations() : BROWSER_KEYS
}

const BROWSER_KEYS: ReadonlyMap<string, Command> = new Map<string, Command>([[' ', 'play-pause']])
