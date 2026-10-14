import { useEffect, useRef } from 'react'
import { ALL_MENU_COMMANDS, type Command } from '@selfmp3/desktop-bridge'

import { menuKeys } from './keyCommands.model'
import { registerKey } from './keyRegistry'

/** What each command should do, by name. Anything not given is not offered. */
export type CommandHandlers = Partial<Record<Command, () => void>>

/** The desktop menu's keys, as an iPad registers them. Built once: the menu is a constant. */
const MENU_KEYS = menuKeys(ALL_MENU_COMMANDS)

/**
 * The desktop app's menu keys, on an iPad or an iPhone with a hardware keyboard.
 *
 * There is no menu bar to send a command, so each key with a handler here is a
 * key command of its own (`keyRegistry`), titled as the menu item is, which is
 * what iPadOS lists while ⌘ is held. Space and the ⌘-arrows stand aside while
 * a text field is being typed in; the rest answer there too, as the desktop
 * menu's do (`menuKeys`). On Android there is no module and nothing happens.
 * The desktop half, with its menu and media keys, is `useCommands.web.ts`.
 *
 * The division is the plan's: the keys belong to the shell, and the behaviour
 * belongs to the page, because only the page knows what "next" means with a
 * queue open. This hook is where the two meet.
 */
export function useCommands(handlers: CommandHandlers): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  // Only the commands this caller answers: two components use this hook — the
  // palette and the frame — and a key with no handler would be listed and do
  // nothing. Registered again only when that set changes.
  const answered = MENU_KEYS.filter(key => handlers[key.command])
    .map(key => key.combination)
    .join('\n')
  useEffect(() => {
    const removals = MENU_KEYS.filter(key => answered.split('\n').includes(key.combination)).map(
      key =>
        registerKey({
          combination: key.combination,
          title: key.title,
          whileTyping: key.whileTyping,
          run: () => latest.current[key.command]?.(),
        }),
    )
    return () => removals.forEach(remove => remove())
  }, [answered])
}
