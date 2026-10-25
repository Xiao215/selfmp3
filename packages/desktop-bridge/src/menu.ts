import type { Command, MenuState } from './schemas.js'

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
  /**
   * A setting, drawn with a checkmark while it is on (`menuChecked`): Shuffle
   * and Like as checkboxes, and Repeat's three modes as one radio group.
   */
  readonly check?: 'checkbox' | 'radio'
}

/** A submenu of commands: Repeat's Off, All and One. */
interface MenuSubmenu {
  readonly label: string
  readonly submenu: readonly MenuCommand[]
}

/** A line between groups of items. */
export const MENU_SEPARATOR = 'separator'

export type MenuEntry = MenuCommand | MenuSubmenu | typeof MENU_SEPARATOR

interface MenuSection {
  readonly title: string
  readonly items: readonly MenuEntry[]
}

/** The commands among a section's entries, a submenu's included, in the order drawn. */
export function menuCommandsIn(entries: readonly MenuEntry[]): readonly MenuCommand[] {
  return entries.flatMap(entry =>
    entry === MENU_SEPARATOR ? [] : 'submenu' in entry ? entry.submenu : [entry],
  )
}

/**
 * The menu's own items — the ones that send a command to the page.
 *
 * The standard roles (Edit's cut/copy/paste, Window's minimise and zoom, the
 * app menu's Hide and Quit, File's Close Window and View's Toggle Full Screen)
 * are Electron's `role:` and appear nowhere here: they are the operating
 * system's behaviour, not this app's, and giving them commands would mean
 * reimplementing ⌘C.
 *
 * Title case, as every Mac menu is, beside macOS's own items; the app itself
 * stays in sentence case (AO1, 2026-10-25). View follows the sidebar's order,
 * Home first, so ⌘1–⌘4 are its four rows.
 */
export const MENU_SECTIONS: readonly MenuSection[] = [
  {
    title: 'File',
    items: [
      { label: 'New Playlist', command: 'new-playlist', accelerator: 'CmdOrCtrl+N' },
      { label: 'Import…', command: 'start-import', accelerator: 'CmdOrCtrl+I' },
    ],
  },
  {
    title: 'View',
    items: [
      { label: 'Home', command: 'home', accelerator: 'CmdOrCtrl+1' },
      { label: 'Library', command: 'library', accelerator: 'CmdOrCtrl+2' },
      { label: 'Import', command: 'import', accelerator: 'CmdOrCtrl+3' },
      { label: 'Stats', command: 'stats', accelerator: 'CmdOrCtrl+4' },
      MENU_SEPARATOR,
      { label: 'Playlists', command: 'playlists', accelerator: 'CmdOrCtrl+5' },
      { label: 'Now Playing', command: 'now-playing', accelerator: 'CmdOrCtrl+0' },
      { label: 'Search', command: 'search', accelerator: 'CmdOrCtrl+K' },
    ],
  },
  {
    title: 'Playback',
    items: [
      { label: 'Play / Pause', command: 'play-pause', accelerator: 'Space', pageKeeps: true },
      { label: 'Next', command: 'next', accelerator: 'CmdOrCtrl+Right', pageKeeps: true },
      { label: 'Previous', command: 'previous', accelerator: 'CmdOrCtrl+Left', pageKeeps: true },
      {
        label: 'Seek Forward',
        command: 'seek-forward',
        accelerator: 'Alt+CmdOrCtrl+Right',
        pageKeeps: true,
      },
      {
        label: 'Seek Back',
        command: 'seek-back',
        accelerator: 'Alt+CmdOrCtrl+Left',
        pageKeeps: true,
      },
      MENU_SEPARATOR,
      { label: 'Shuffle', command: 'shuffle', check: 'checkbox' },
      {
        label: 'Repeat',
        submenu: [
          { label: 'Off', command: 'repeat-off', check: 'radio' },
          { label: 'All', command: 'repeat-all', check: 'radio' },
          { label: 'One', command: 'repeat-one', check: 'radio' },
        ],
      },
      { label: 'Like', command: 'like', accelerator: 'CmdOrCtrl+L', check: 'checkbox' },
      MENU_SEPARATOR,
      { label: 'Volume Up', command: 'volume-up', accelerator: 'CmdOrCtrl+Up' },
      { label: 'Volume Down', command: 'volume-down', accelerator: 'CmdOrCtrl+Down' },
      { label: 'Mute', command: 'mute', accelerator: 'Alt+CmdOrCtrl+Down' },
    ],
  },
]

/**
 * Whether an item with a checkmark has it, by what the page last said
 * (`MenuState`); undefined for an item that has none. Like is ticked while the
 * playing song is liked.
 */
export function menuChecked(command: Command, state: MenuState): boolean | undefined {
  switch (command) {
    case 'shuffle':
      return state.shuffle
    case 'repeat-off':
      return state.repeat === 'off'
    case 'repeat-all':
      return state.repeat === 'all'
    case 'repeat-one':
      return state.repeat === 'one'
    case 'like':
      return state.liked === true
    default:
      return undefined
  }
}

/** Whether an item can be chosen now: Like needs a song playing that can be liked. */
export function menuEnabled(command: Command, state: MenuState): boolean {
  return command === 'like' ? state.liked !== null : true
}

/** What the menu shows before the page has said anything: nothing on, nothing to like. */
export const MENU_STATE_AT_START: MenuState = { shuffle: false, repeat: 'off', liked: null }

/** Settings sits in the application menu on macOS, where ⌘, belongs. */
export const APP_MENU_ITEMS: readonly MenuCommand[] = [
  { label: 'Settings…', command: 'settings', accelerator: 'CmdOrCtrl+,' },
]

export const ALL_MENU_COMMANDS: readonly MenuCommand[] = [
  ...APP_MENU_ITEMS,
  ...MENU_SECTIONS.flatMap(section => menuCommandsIn(section.items)),
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
