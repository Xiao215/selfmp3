import type { Command } from '@selfmp3/desktop-bridge'

export type { Command }

/** What each command should do, by name. Anything not given is not offered. */
export type CommandHandlers = Partial<Record<Command, () => void>>

/**
 * Menu items and media keys, from the desktop shell.
 *
 * A no-op on a phone and in a browser, which have no menu and no shell to send
 * one. The desktop half is `useCommands.web.ts`.
 *
 * The division is the plan's: the menu belongs to the shell, because only the
 * operating system can draw one, and the behaviour belongs to the page, because
 * only the page knows what "next" means with a queue open. This hook is where
 * the two meet.
 */
export function useCommands(_handlers: CommandHandlers): void {
  // Nothing to listen to.
}
