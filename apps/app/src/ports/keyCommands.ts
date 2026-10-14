import { useSyncExternalStore } from 'react'
import { requireOptionalNativeModule } from 'expo'

/** One shortcut, as the native module takes it. */
export interface KeyCommandSpec {
  /** The key in the page's spelling: `k`, `,`, ` `, `ArrowLeft`, `Escape`. */
  readonly input: string
  readonly modifiers: readonly ('command' | 'control' | 'alternate' | 'shift')[]
  /** What iPadOS lists beside the key while ⌘ is held. None leaves it off that list. */
  readonly title?: string
  /** Kept while a text field is being typed in; see `keyCommands.model.ts`. */
  readonly whileTyping: boolean
}

/** A press of one of the registered keys. */
export interface KeyPress {
  readonly input: string
  readonly modifiers: readonly ('command' | 'control' | 'alternate' | 'shift')[]
  /** Whether a text field had the keyboard when it was pressed. */
  readonly typing: boolean
}

interface Subscription {
  remove(): void
}

interface KeyCommandsModule {
  setCommands(commands: readonly KeyCommandSpec[]): void
  keyboardAttached(): boolean
  addListener(event: 'onKeyCommand', listener: (press: KeyPress) => void): Subscription
  addListener(
    event: 'onKeyboardChange',
    listener: (change: { attached: boolean }) => void,
  ): Subscription
}

/**
 * A hardware keyboard's shortcuts on an iPad or an iPhone: the app's own
 * module, `apps/app/modules/key-commands`, which puts `UIKeyCommand`s on the
 * root view controller and sends each press here.
 *
 * `null` on Android, where the module is not built, and in a dev client built
 * before the module was added: the keys then do nothing, as they did before.
 * There is no web half: nothing on the web asks for this. A page hears its
 * keys on the window (`useHotkeys.web.ts`, `useEscape.web.ts`), and the menu's
 * are the desktop shell's (`menuKeys.web.ts`).
 */
export const keyCommands: KeyCommandsModule | null =
  requireOptionalNativeModule<KeyCommandsModule>('KeyCommands')

function subscribe(onChange: () => void): () => void {
  const subscription = keyCommands?.addListener('onKeyboardChange', onChange)
  return () => subscription?.remove()
}

function attached(): boolean {
  return keyCommands?.keyboardAttached() ?? false
}

/**
 * Whether a hardware keyboard is attached now — a Magic Keyboard, a Bluetooth
 * one — and so whether there are keys to show. It changes as one is attached
 * or taken away.
 */
export function useHardwareKeyboard(): boolean {
  return useSyncExternalStore(subscribe, attached, attached)
}
