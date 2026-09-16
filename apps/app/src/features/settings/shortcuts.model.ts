/**
 * The installed app's menu keys, as Settings › Keyboard shortcuts lists them.
 *
 * The menu names each item once — Next, Previous, Seek forward, Seek back —
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
  { commands: ['volume-up', 'volume-down'], label: 'Volume' },
  { commands: ['mute'], label: 'Mute' },
  { commands: ['search'], label: 'Search' },
  { commands: ['library', 'playlists', 'now-playing'], label: 'Library · Playlists · Now Playing' },
  { commands: ['practice'], label: 'Practice panel' },
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
