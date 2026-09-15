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
  /**
   * The menu shows this key but does not take it: the page keeps listening.
   *
   * A registered accelerator fires wherever the focus is, text fields included.
   * Space would then never reach the search box, and ⌘← — which is "go to the
   * start of the line" in every Mac text field there has ever been — would skip
   * to the previous song while someone was editing the server address. So the
   * menu shows these without taking them (`drawnMenuItem`: an unregistered
   * accelerator on Linux and Windows, the key in the label on macOS), and
   * `useHotkeys` handles them as it handles every other key: not while someone
   * is typing.
   */
  readonly pageKeeps?: boolean
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
      { label: 'Play / Pause', command: 'play-pause', accelerator: 'Space', pageKeeps: true },
      { label: 'Next', command: 'next', accelerator: 'CmdOrCtrl+Right', pageKeeps: true },
      { label: 'Previous', command: 'previous', accelerator: 'CmdOrCtrl+Left', pageKeeps: true },
      {
        label: 'Seek forward',
        command: 'seek-forward',
        accelerator: 'Alt+CmdOrCtrl+Right',
        pageKeeps: true,
      },
      {
        label: 'Seek back',
        command: 'seek-back',
        accelerator: 'Alt+CmdOrCtrl+Left',
        pageKeeps: true,
      },
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
 * Every combination the menu has actually taken, in the page's spelling.
 *
 * `useHotkeys.web.ts` skips these when the bridge is present, so a menu item
 * and a page shortcut cannot both fire. A `pageKeeps` item is not one of them:
 * the menu draws its key and leaves it alone, so the page must keep handling
 * it — which is the whole point of the flag.
 */
export function menuOwnedCombinations(): ReadonlySet<string> {
  const owned = new Set<string>()
  for (const item of ALL_MENU_COMMANDS) {
    if (!item.accelerator || item.pageKeeps) continue
    for (const combination of pageCombinations(item.accelerator)) owned.add(combination)
  }
  return owned
}

/**
 * What `useHotkeys` should listen for in the installed app, by command.
 *
 * The page's own shortcuts are the browser's, and the browser has none of
 * these: playback keys are a thing an *application* has, not a tab. So they
 * arrive with the menu, and this is how the page learns which key goes with
 * which command without repeating the table.
 */
export function pageKeptCombinations(): ReadonlyMap<string, Command> {
  const kept = new Map<string, Command>()
  for (const item of ALL_MENU_COMMANDS) {
    if (!item.accelerator || !item.pageKeeps) continue
    for (const combination of pageCombinations(item.accelerator)) kept.set(combination, item.command)
  }
  return kept
}

/** A Mac writes its modifiers in this order, whatever order they were given in. */
const MODIFIER_ORDER = ['⌃', '⌥', '⇧', '⌘'] as const

const MODIFIER_CAPS: Readonly<Record<string, (typeof MODIFIER_ORDER)[number]>> = {
  CmdOrCtrl: '⌘',
  CommandOrControl: '⌘',
  Cmd: '⌘',
  Command: '⌘',
  Ctrl: '⌃',
  Control: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
}

const KEY_CAPS: Readonly<Record<string, string>> = {
  Space: 'space',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Return: '↵',
  Esc: 'esc',
}

/**
 * Electron's spelling of a key, split into the caps a Mac draws: `Alt+CmdOrCtrl+Right` → ⌥ ⌘ →.
 *
 * Here rather than in the page because the menu writes keys too: a macOS menu
 * item the page keeps names its key in its label, and Settings › Keyboard
 * shortcuts draws the same keys, so both spell them with this.
 */
export function acceleratorKeys(accelerator: string): { modifiers: string[]; key: string } {
  const parts = accelerator.split('+')
  const last = parts[parts.length - 1] ?? ''
  const modifiers = parts
    .slice(0, -1)
    .map(part => MODIFIER_CAPS[part])
    .filter((part): part is (typeof MODIFIER_ORDER)[number] => part !== undefined)
    .sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
  return { modifiers, key: KEY_CAPS[last] ?? last.toUpperCase() }
}

/** A menu item as the shell hands it to Electron on one platform. */
export interface DrawnMenuItem {
  readonly label: string
  readonly accelerator?: string
  readonly registerAccelerator: boolean
}

/**
 * How one item is drawn on a platform.
 *
 * `registerAccelerator: false` is Linux and Windows only. A Mac menu acts on
 * an item's key whenever the page leaves that key unhandled, and a text field
 * leaves Space unhandled — so on macOS typing a space in the search box or the
 * palette also played or paused the music, while the list, where `useHotkeys`
 * handles Space, was fine. There a page-kept item has no accelerator at all:
 * its key is written into the label, in the caps Settings draws, and the page
 * handles the key exactly as before.
 */
export function drawnMenuItem(item: MenuCommand, platform: string): DrawnMenuItem {
  if (!item.accelerator) return { label: item.label, registerAccelerator: true }
  if (!item.pageKeeps) {
    return { label: item.label, accelerator: item.accelerator, registerAccelerator: true }
  }
  if (platform === 'darwin') {
    const { modifiers, key } = acceleratorKeys(item.accelerator)
    return { label: `${item.label} (${[...modifiers, key].join('')})`, registerAccelerator: false }
  }
  return { label: item.label, accelerator: item.accelerator, registerAccelerator: false }
}
