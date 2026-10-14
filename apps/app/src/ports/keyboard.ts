import { Keyboard, Platform, type ViewProps } from 'react-native'

/**
 * What the software keyboard does to the layout when it appears.
 *
 * iOS slides the whole view up and needs the content padded out of the way;
 * Android resizes the window itself and needs nothing. Two screens had this as
 * `Platform.OS === 'ios' ? 'padding' : undefined` inline, which is the exact
 * shape foundation 2 forbids: a screen deciding something about the platform
 * rather than asking for a capability.
 *
 * `undefined` is `KeyboardAvoidingView`'s "do nothing", which is also the right
 * answer in a browser, where the page scrolls and there is no keyboard to
 * avoid.
 */
export const keyboardAvoidBehavior: 'padding' | 'height' | 'position' | undefined =
  Platform.OS === 'ios' ? 'padding' : undefined

/**
 * What dragging a list does to an open keyboard: puts it away, so the rows it
 * was covering can be seen (as Google's search does with its history).
 */
export const dragKeyboard: 'on-drag' | 'none' = 'on-drag'

/**
 * A press on a sheet that nothing on it takes — its words, the space between
 * its controls — puts the keyboard away. A sheet is no scroll view, so
 * nothing else would: a field's keyboard stayed up until the sheet was shut
 * (the room code, 2026-10-14). Asked only while the keyboard is up, so
 * nothing on the sheet is kept from a press it would have had.
 */
export const pressPutsKeyboardAway: Pick<
  ViewProps,
  'onStartShouldSetResponder' | 'onResponderRelease'
> = {
  onStartShouldSetResponder: () => Keyboard.isVisible(),
  onResponderRelease: () => Keyboard.dismiss(),
}
