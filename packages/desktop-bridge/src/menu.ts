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
   * to the previous song while someone was editing the server address. So these
   * are drawn with `registerAccelerator: false`, and `useHotkeys` handles them
   * as it handles every other key: not while someone is typing.
   *
   * That flag is Linux and Windows only. A Mac menu still acts on the key
   * whenever the page leaves it unhandled — and a text field leaves Space
   * unhandled — so the shell also ignores these items when a key rather than
   * the pointer chose them (`menuClickSends`).
   */
  readonly pageKeeps?: boolean
}

interface MenuSection {
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
    for (const combination of pageCombinations(item.accelerator))
      kept.set(combination, item.command)
  }
  return kept
}

/**
 * Whether choosing a menu item should send its command to the page.
 *
 * Always, except a `pageKeeps` item chosen by its key. The page already had
 * that key: on the list `useHotkeys` handled it, and in a text field it typed
 * the space or moved the caret. A Mac menu acts on the key only when the page
 * left it unhandled, which for these keys means someone was typing — so on a
 * Mac, a space in the search box also played or paused the music. The key stays
 * drawn in the menu where a Mac draws keys; chosen with the pointer the item
 * still does what it says.
 */
export function menuClickSends(item: MenuCommand, triggeredByAccelerator: boolean): boolean {
  return !(item.pageKeeps === true && triggeredByAccelerator)
}
