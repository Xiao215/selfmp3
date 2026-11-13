import type { ReactNode } from 'react'
import { StyleSheet, TextInput } from 'react-native'

/**
 * The keyboard kept up while a page is pushed, for a field on the next page
 * to take over (the room code going on to the join page's name).
 *
 * A native stack takes the keyboard from any field in the page it pushes
 * over, and a field focused on the new page while the push is under way is
 * blurred and focused again by it: either way the keyboard went down and
 * came straight back up. Before the push the focus moves to `KeyboardHold`,
 * a field drawn by the shell over every page and seen by nobody, which no
 * push reaches; the new page takes it back once it has arrived
 * (`ui/useFocusOnArrival.ts`). A page that wants no keyboard lets it go,
 * and should nothing take it, it goes by itself after a moment.
 *
 * Search's own field rising out of Home's does the same with a field of its
 * own (`features/search/searchDoor.ts`).
 */

/** How long the keyboard is kept for a page that never says whether it wants it. */
const HOLD_MS = 1200

let field: TextInput | null = null
let letGo: ReturnType<typeof setTimeout> | null = null

/**
 * Keeps the keyboard up through the page change about to happen, if a field
 * has it now. Call it just before pushing or replacing the page.
 */
export function holdKeyboard(): void {
  if (field === null || TextInput.State.currentlyFocusedInput() === null) return
  field.focus()
  if (letGo !== null) clearTimeout(letGo)
  letGo = setTimeout(releaseKeyboard, HOLD_MS)
}

/** Lets a kept keyboard go down; nothing happens when none is kept. */
export function releaseKeyboard(): void {
  if (letGo !== null) clearTimeout(letGo)
  letGo = null
  if (field !== null && TextInput.State.currentlyFocusedInput() === field) field.blur()
}

/** The field the keyboard is kept by, drawn once by the shell. */
export function KeyboardHold(): ReactNode {
  return (
    <TextInput
      ref={node => {
        field = node
      }}
      // Anything typed in the moment it is held goes nowhere.
      value=""
      autoCorrect={false}
      spellCheck={false}
      caretHidden
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.hold}
    />
  )
}

const styles = StyleSheet.create({
  hold: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0 },
})
