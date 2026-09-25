/**
 * Whether a key event belongs to an input method composing text: pinyin on
 * its way to a character, kana to kanji.
 *
 * While a composition is open the keys are the input method's. Enter takes
 * the candidate, Escape drops it, the arrows move between candidates, Space
 * picks one. A listener that answered them closed the palette on the first
 * Escape and opened the top result on the first Enter, so a search in Chinese
 * could not be typed at all. `keyCode` 229 is what browsers report for such a
 * keydown where `isComposing` is not set (UI Events, "determine keyCode").
 */
export function isComposing(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229
}
