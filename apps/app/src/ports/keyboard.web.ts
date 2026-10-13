/** A browser scrolls the page itself; there is nothing to avoid. */
export const keyboardAvoidBehavior: 'padding' | 'height' | 'position' | undefined = undefined

/**
 * React Native Web blurs the field on every scroll event when this is
 * `on-drag`, a wheel or a list jumping back to its top included, not only on a
 * drag. With a mouse there is no keyboard on screen to put away, and typing in
 * a filter would lose its field each time the results moved. A touch screen
 * has the keyboard over the rows, so there it goes away as on a phone.
 */
export const dragKeyboard: 'on-drag' | 'none' =
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false)
    ? 'on-drag'
    : 'none'
