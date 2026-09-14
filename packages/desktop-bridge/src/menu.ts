import type { Command } from './schemas.js'

/**
 * The application menu, as data.
 *
 * It is here rather than in `apps/desktop` because it is a contract, not a
 * drawing: the shell builds an Electron `Menu` from it, and the page needs to
 * know which key combinations the menu has taken so it can stop listening for
 * them. macOS delivers a menu accelerator to the menu *and* leaves the page's
 * `keydown` alone — but the page's own `useHotkeys` would then run the same
 * handler the menu just ran, and ⌘K would open the palette twice.
 *
 * Nothing here draws anything, so it is a pure module with tests: no
 * accelerator twice, every command one the contract knows.
 */

export interface MenuCommand {
  /** What the person reads. */
  readonly label: string
  /** What the page is told to do. */
  readonly command: Command
  /** Electron's spelling. `CmdOrCtrl` so a Windows build is not a rewrite. */
  readonly accelerator?: string
}

export interface MenuSection {
  readonly title: string
  readonly items: readonly MenuCommand[]
}

/**
 * The menu's own items — the ones that send a command to the page.
 *
 * The standard roles (Edit's cut/copy/paste, Window's minimise and zoom, the
 * app menu's Hide and Quit) are Electron's `role:` and appear nowhere here:
 * they are the operating system's behaviour, not this app's, and giving them
 * commands would mean reimplementing ⌘C.
 */
export const MENU_SECTIONS: readonly MenuSection[] = [
  {
    title: 'View',
    items: [
      { label: 'Library', command: 'library', accelerator: 'CmdOrCtrl+1' },
      { label: 'Playlists', command: 'playlists', accelerator: 'CmdOrCtrl+2' },
      { label: 'Now Playing', command: 'now-playing', accelerator: 'CmdOrCtrl+3' },
      { label: 'Search', command: 'search', accelerator: 'CmdOrCtrl+K' },
      { label: 'Practice panel', command: 'practice', accelerator: 'CmdOrCtrl+P' },
    ],
  },
  {
    title: 'Playback',
    items: [
      { label: 'Play / Pause', command: 'play-pause', accelerator: 'Space' },
      { label: 'Next', command: 'next', accelerator: 'CmdOrCtrl+Right' },
      { label: 'Previous', command: 'previous', accelerator: 'CmdOrCtrl+Left' },
      { label: 'Seek forward', command: 'seek-forward', accelerator: 'Alt+CmdOrCtrl+Right' },
      { label: 'Seek back', command: 'seek-back', accelerator: 'Alt+CmdOrCtrl+Left' },
      { label: 'Shuffle', command: 'shuffle' },
      { label: 'Repeat', command: 'repeat' },
      { label: 'Volume up', command: 'volume-up', accelerator: 'CmdOrCtrl+Up' },
      { label: 'Volume down', command: 'volume-down', accelerator: 'CmdOrCtrl+Down' },
      { label: 'Mute', command: 'mute', accelerator: 'Alt+CmdOrCtrl+Down' },
    ],
  },
]

/** Settings sits in the application menu on macOS, where ⌘, belongs. */
export const APP_MENU_ITEMS: readonly MenuCommand[] = [
  { label: 'Settings…', command: 'settings', accelerator: 'CmdOrCtrl+,' },
]

export const ALL_MENU_COMMANDS: readonly MenuCommand[] = [
  ...APP_MENU_ITEMS,
  ...MENU_SECTIONS.flatMap(section => section.items),
]

/**
 * How a key reaches the page's own listener: `useHotkeys.web.ts` builds
 * `meta+ctrl+alt+shift+key` from a `KeyboardEvent`, with a one-character key
 * lower-cased and everything longer kept as `event.key` is spelled.
 *
 * `CmdOrCtrl` is two combinations, not one, because the page cannot tell which
 * one the operating system used to trigger the menu item.
 */
export function pageCombinations(accelerator: string): readonly string[] {
  const parts = accelerator.split('+')
  const key = parts[parts.length - 1] ?? ''
  const modifiers = parts.slice(0, -1)

  const pageKey = KEY_NAMES[key] ?? (key.length === 1 ? key.toLowerCase() : key)
  const alt = modifiers.includes('Alt') || modifiers.includes('Option')
  const shift = modifiers.includes('Shift')

  const build = (first: 'meta' | 'ctrl' | null): string => {
    const combination: string[] = []
    if (first === 'meta') combination.push('meta')
    if (first === 'ctrl') combination.push('ctrl')
    if (alt) combination.push('alt')
    // `useHotkeys` only records shift for a named key; a shifted character
    // arrives as the character itself.
    if (shift && pageKey.length > 1) combination.push('shift')
    combination.push(pageKey)
    return combination.join('+')
  }

  if (modifiers.includes('CmdOrCtrl') || modifiers.includes('CommandOrControl')) {
    return [build('meta'), build('ctrl')]
  }
  if (modifiers.includes('Cmd') || modifiers.includes('Command')) return [build('meta')]
  if (modifiers.includes('Ctrl') || modifiers.includes('Control')) return [build('ctrl')]
  return [build(null)]
}

/** Electron's key names on the left, `KeyboardEvent.key` on the right. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  Space: ' ',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Return: 'Enter',
  Esc: 'Escape',
}

/**
 * Every combination the menu has taken, in the page's spelling.
 *
 * `useHotkeys.web.ts` skips these when the bridge is present, so a menu item
 * and a page shortcut cannot both fire.
 */
export function menuOwnedCombinations(): ReadonlySet<string> {
  const owned = new Set<string>()
  for (const item of ALL_MENU_COMMANDS) {
    if (!item.accelerator) continue
    for (const combination of pageCombinations(item.accelerator)) owned.add(combination)
  }
  return owned
}
