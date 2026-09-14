import * as Unistyles from 'react-native-unistyles'

/**
 * Never delete a CSS rule Unistyles has written, in a browser.
 *
 * On the web Unistyles turns each style into a class and a rule, and when the
 * last element it knows of using a class goes away it waits a microtask, looks
 * for the class in the document, and deletes the rule if it finds none. An
 * element that still carries the class but was not in the document at that
 * instant — a screen swapped out while Now Playing closed — keeps its class
 * with no rule behind it, and nothing adds the rule again until that element
 * re-renders: Xiao saw the sidebar, a row and then the whole stage drawn
 * unstyled after closing Now Playing.
 *
 * The rules are a few hundred lines of text at most. Keeping all of them
 * costs nothing; losing one breaks the page. So `remove` keeps its
 * bookkeeping — which elements use a class — and reports that it removed
 * nothing, which also keeps the class's theme listener, so a kept rule still
 * follows a change of accent or theme.
 *
 * Unistyles does not export its registry, so it is reached through whichever
 * exported service holds the shared `services`. If none does, in some future
 * version, this does nothing rather than break the page.
 */

interface WebRegistry {
  stylesCounter?: Map<string, Set<unknown>>
  remove?: (ref: unknown, hash: string) => Promise<boolean>
}

type WithServices = { services?: { registry?: WebRegistry } } | undefined

export function keepWebStyles(): void {
  const exported = Unistyles as unknown as Record<string, WithServices>
  const registry =
    exported['UnistylesShadowRegistry']?.services?.registry ??
    exported['UnistylesRuntime']?.services?.registry
  if (!registry?.remove) return
  registry.remove = (ref, hash) => {
    registry.stylesCounter?.get(hash)?.delete(ref)
    return Promise.resolve(false)
  }
}
