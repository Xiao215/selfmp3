import { ALL_MENU_COMMANDS, type MenuCommand } from '@selfmp3/desktop-bridge'

import { keyCommands, useHardwareKeyboard } from './keyCommands'

export type { MenuCommand }

/**
 * The application menu's items and their keys, where they can be pressed.
 *
 * On a computer that is the installed desktop app's menu: View, Playback and
 * Settings… (`menuKeys.web.ts`). On an iPad or an iPhone it is the same items,
 * registered as key commands (`useCommands`), while a hardware keyboard is
 * attached; `null` without one, and on Android, which has no module for them.
 * A browser tab has no menu keys either: the keys a tab would take are the
 * browser's, all but Space for play and pause. So a screen that shows keys —
 * Settings › Keyboard shortcuts, the sidebar's ⌘K beside Search — asks this,
 * and shows nothing when the answer is no keys.
 *
 * Read through a port because the list is the desktop bridge's, and features
 * do not import the bridge.
 */
export function useMenuCommands(): readonly MenuCommand[] | null {
  const keyboard = useHardwareKeyboard()
  return keyCommands && keyboard ? ALL_MENU_COMMANDS : null
}
