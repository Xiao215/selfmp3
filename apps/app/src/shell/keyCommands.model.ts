import { pageCombinations, type Command, type MenuCommand } from '@selfmp3/desktop-bridge'

/**
 * A key as UIKit's key commands name it (`modules/key-commands`): the key
 * itself, in the page's spelling (`a`, ` `, `ArrowLeft`, `Escape`), and the
 * modifiers held with it.
 */
interface NativeKey {
  readonly input: string
  readonly modifiers: readonly NativeModifier[]
}

type NativeModifier = 'command' | 'control' | 'alternate' | 'shift'

/** The page's modifier names (`useHotkeys.web.ts`), in the order it writes them. */
const MODIFIERS: readonly (readonly [string, NativeModifier])[] = [
  ['meta', 'command'],
  ['ctrl', 'control'],
  ['alt', 'alternate'],
  ['shift', 'shift'],
]

/**
 * A combination in the page's spelling — `meta+alt+ArrowLeft`, `meta+k`, ` ` —
 * as a key command. One spelling for every platform, so a screen names its keys
 * once and a key the desktop's menu has means the same on an iPad.
 */
export function nativeKey(combination: string): NativeKey {
  // A lone character is the key itself, Space and `+` included; `meta++` ends
  // in an empty part, which is the plus key.
  const parts = combination.length > 1 ? combination.split('+') : [combination]
  const input = parts.pop() || '+'
  const modifiers = MODIFIERS.filter(([name]) => parts.includes(name)).map(([, native]) => native)
  return { input, modifiers }
}

/** A key command's press back in the page's spelling, the way `useHotkeys.web.ts` builds it. */
export function combinationOf({ input, modifiers }: NativeKey): string {
  const parts = MODIFIERS.filter(([, native]) => modifiers.includes(native)).map(([name]) => name)
  return [...parts, input.length === 1 ? input.toLowerCase() : input].join('+')
}

/** One of the menu's keys as an iPad or an iPhone with a keyboard registers it. */
interface MenuKey {
  readonly combination: string
  readonly command: Command
  /** What holding ⌘ lists beside the key: the menu item's own label. */
  readonly title: string
  /**
   * Kept while a text field has the keyboard. The keys the desktop's menu takes
   * outright (⌘K, ⌘1, ⌘↑) are; the ones it draws but leaves to the page
   * (`pageKeeps`: Space, the ⌘-arrows) are not, for the reason the menu gives:
   * a space typed into the search box must be a space.
   */
  readonly whileTyping: boolean
}

/**
 * The desktop app's menu keys (`packages/desktop-bridge/src/menu.ts`) for a
 * keyboard on an iPad or an iPhone. `CmdOrCtrl` is ⌘ there, as on a Mac: an
 * Apple keyboard's Control is not a shortcut key.
 */
export function menuKeys(items: readonly MenuCommand[]): readonly MenuKey[] {
  return items.flatMap(item =>
    item.accelerator
      ? pageCombinations(item.accelerator)
          .filter(combination => !combination.startsWith('ctrl+'))
          .map(combination => ({
            combination,
            command: item.command,
            title: item.label,
            whileTyping: item.pageKeeps !== true,
          }))
      : [],
  )
}
