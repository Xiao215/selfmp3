/**
 * The keys an answer in the Search box takes while it is shown. The box keeps
 * the focus, so it hands each key to the answer first, and draws what they do
 * in its footer.
 */
export interface AnswerKeys {
  /** A key pressed in the box, and whether ⌘ (or ctrl) was held; true when the answer used it. */
  readonly press: (key: string, command: boolean) => boolean
  /** What the keys do, for the footer: the caps, then the word after them. */
  readonly hints: readonly (readonly [caps: readonly string[], word: string])[]
}
