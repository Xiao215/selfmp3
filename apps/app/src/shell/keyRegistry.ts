import { keyCommands, type KeyCommandSpec, type KeyPress } from '../ports/keyCommands'
import { combinationOf, nativeKey } from './keyCommands.model'

/**
 * One key a hook answers on an iPad or an iPhone with a keyboard.
 *
 * `run` answers the press. Returning `false` says "not mine after all" and
 * hands it to the next one registered for that key: a layer that is not on
 * top, a list with no songs to select.
 */
interface KeyEntry {
  /** In the page's spelling: `meta+k`, ` `, `Escape` (`keyCommands.model.ts`). */
  readonly combination: string
  readonly run: () => boolean | void
  /** What holding ⌘ lists beside the key. */
  readonly title?: string
  /** Answered while a text field is being typed in. */
  readonly whileTyping: boolean
}

/** Everything registered, oldest first. A press tries the newest first. */
const entries: KeyEntry[] = []
let subscribed = false
let pushing = false

/**
 * Answer `entry`'s key until the returned function is called.
 *
 * The keys of every hook that asks — `useCommands`, `useHotkeys`, `useEscape`,
 * a list's ⌘A — go to the native module as one set, since a key command is
 * one per key: two screens that answer the same key share one command, and a
 * press goes to the one registered last. Nothing happens where there is no
 * module (`ports/keyCommands`).
 */
export function registerKey(entry: KeyEntry): () => void {
  if (!keyCommands) return () => {}
  if (!subscribed) {
    subscribed = true
    keyCommands.addListener('onKeyCommand', press)
  }
  entries.push(entry)
  schedulePush()
  return () => {
    const at = entries.lastIndexOf(entry)
    if (at !== -1) entries.splice(at, 1)
    schedulePush()
  }
}

/**
 * Hand a press to whoever answers it: the newest registration first, and on
 * down while each one passes it on. A press made while typing skips what does
 * not answer then; the module withdraws such a key while a field has the
 * keyboard, so this only matters for a key two hooks disagree on.
 */
function press({ input, modifiers, typing }: KeyPress): void {
  const combination = combinationOf({ input, modifiers })
  for (let at = entries.length - 1; at >= 0; at--) {
    const entry = entries[at]
    if (!entry || entry.combination !== combination || (typing && !entry.whileTyping)) continue
    if (entry.run() !== false) return
  }
}

/**
 * Sent once per turn of the event loop rather than per registration: a screen
 * mounting registers a dozen keys at once, and each send redraws UIKit's set.
 */
function schedulePush(): void {
  if (pushing) return
  pushing = true
  queueMicrotask(() => {
    pushing = false
    keyCommands?.setCommands(specs())
  })
}

/** One spec per key: titled by the first that gives one, kept while typing if any is. */
function specs(): KeyCommandSpec[] {
  const byKey = new Map<string, KeyCommandSpec>()
  for (const entry of entries) {
    const known = byKey.get(entry.combination)
    const title = known?.title ?? entry.title
    byKey.set(entry.combination, {
      ...nativeKey(entry.combination),
      ...(title === undefined ? {} : { title }),
      whileTyping: (known?.whileTyping ?? false) || entry.whileTyping,
    })
  }
  return [...byKey.values()]
}
