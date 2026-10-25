/**
 * The installed app's menu keys, as Settings › Keyboard shortcuts lists them.
 *
 * The menu names each item once — Next, Previous, Seek Forward, Seek Back —
 * which is right for a menu and a long list for a page. So related items share
 * a row ("⌘ ← → Previous / next"), and the keys are drawn the way a Mac draws
 * them. The keys themselves are always read from the menu, never written here,
 * so a key changed in `packages/desktop-bridge/src/menu.ts` changes this page.
 */

/** A menu item as far as this page cares: what it does, and its key. */
interface MenuKey {
  readonly command: string
  readonly accelerator?: string
}

interface ShortcutRow {
  /** Each one drawn as its own key cap. */
  readonly keys: readonly string[]
  readonly label: string
}

/** Which items share a row, in the order the page lists them. */
const ROWS: readonly { commands: readonly string[]; label: string }[] = [
  { commands: ['play-pause'], label: 'Play / pause' },
  { commands: ['previous', 'next'], label: 'Previous / next' },
  { commands: ['seek-back', 'seek-forward'], label: 'Seek 10 s' },
  { commands: ['like'], label: 'Like the song playing' },
  { commands: ['volume-up', 'volume-down'], label: 'Volume' },
  { commands: ['mute'], label: 'Mute' },
  { commands: ['search'], label: 'Search' },
  { commands: ['home', 'library', 'import', 'stats'], label: 'Home · Library · Import · Stats' },
  { commands: ['playlists'], label: 'Playlists' },
  { commands: ['now-playing'], label: 'Now playing' },
  { commands: ['new-playlist'], label: 'New playlist' },
  { commands: ['start-import'], label: 'Import a link or song' },
  { commands: ['settings'], label: 'Settings' },
]

/** A Mac writes its modifiers in this order, whatever order they were given in. */
const MODIFIER_ORDER = ['⌃', '⌥', '⇧', '⌘'] as const

const MODIFIERS: Readonly<Record<string, (typeof MODIFIER_ORDER)[number]>> = {
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

const KEYS: Readonly<Record<string, string>> = {
  Space: 'space',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Return: '↵',
  Esc: 'esc',
  Tab: 'tab',
}

/** Electron's spelling of a key, split into the caps a Mac draws: `Alt+CmdOrCtrl+Right` → ⌥ ⌘ →. */
export function acceleratorKeys(accelerator: string): { modifiers: string[]; key: string } {
  const parts = accelerator.split('+')
  const last = parts[parts.length - 1] ?? ''
  const modifiers = parts
    .slice(0, -1)
    .map(part => MODIFIERS[part])
    .filter((part): part is (typeof MODIFIER_ORDER)[number] => part !== undefined)
    .sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
  return { modifiers, key: KEYS[last] ?? last.toUpperCase() }
}

/**
 * The rows, from the menu's items. A row whose items have no key, or whose
 * items disagree on their modifiers, is drawn from what there is: one item
 * with a key is still a row, and differing modifiers get a cap set each.
 */
export function shortcutRows(items: readonly MenuKey[]): readonly ShortcutRow[] {
  const byCommand = new Map(items.map(item => [item.command, item.accelerator]))
  const rows: ShortcutRow[] = []
  for (const row of ROWS) {
    const keyed = row.commands
      .map(command => byCommand.get(command))
      .filter((accelerator): accelerator is string => Boolean(accelerator))
      .map(acceleratorKeys)
    const first = keyed[0]
    if (!first) continue
    const shared = keyed.every(keys => keys.modifiers.join('') === first.modifiers.join(''))
    if (!shared) {
      rows.push({ keys: keyed.flatMap(keys => [...keys.modifiers, keys.key]), label: row.label })
      continue
    }
    const last = keyed[keyed.length - 1] ?? first
    // Three or more in a run read as a range: ⌘ 1–3.
    const tail = keyed.length > 2 ? [`${first.key}–${last.key}`] : keyed.map(keys => keys.key)
    rows.push({ keys: [...first.modifiers, ...tail], label: row.label })
  }
  return rows
}

/**
 * A song list's own keys (`selection/useListKeys`), which no menu item
 * carries: they mean something only with a list in front of you, and Space
 * and Enter there are the row's rather than the menu's. Written here, in
 * Electron's spelling, so they are drawn as the menu's are. `rows` marks the
 * ones that need a row the keyboard is on, which only a computer has.
 */
const LIST_KEYS: readonly { accelerators: readonly string[]; label: string; rows?: true }[] = [
  { accelerators: ['Tab'], label: 'Into or out of the list of songs', rows: true },
  { accelerators: ['Up', 'Down'], label: 'Move between songs', rows: true },
  { accelerators: ['Left', 'Right'], label: 'Move between a song’s buttons', rows: true },
  { accelerators: ['Space', 'Return'], label: 'Tick / play the song you moved to', rows: true },
  { accelerators: ['Shift+F10'], label: 'Open the song’s menu', rows: true },
  { accelerators: ['CmdOrCtrl+A'], label: 'Select all songs' },
  { accelerators: ['Esc'], label: 'Clear the selection' },
]

/**
 * The rows for a song list's keys, drawn after the menu's. `rowsTakeKeys`:
 * whether a row is somewhere the keyboard can be (`LIST_ROWS_TAKE_KEYS`) — on
 * an iPad it is not, and only ⌘A and Escape apply.
 */
export function listShortcutRows(rowsTakeKeys: boolean): readonly ShortcutRow[] {
  return LIST_KEYS.filter(row => rowsTakeKeys || !row.rows).map(row => ({
    keys: row.accelerators.flatMap(accelerator => {
      const { modifiers, key } = acceleratorKeys(accelerator)
      return [...modifiers, key]
    }),
    label: row.label,
  }))
}
