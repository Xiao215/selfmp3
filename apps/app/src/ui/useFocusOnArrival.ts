import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { TextInput } from 'react-native'
import { useNavigation } from 'expo-router'
import type { NativeStackNavigationProp } from 'expo-router'
import { releaseKeyboard } from '../ports/keyboardHold'
import { stackMoves } from '../ports/stackMoves'

/** How long a page waits to be told it has arrived before it takes the keyboard anyway. */
const ARRIVAL_MS = 600

/**
 * Gives `field` the focus once its page has finished arriving, where
 * `autoFocus` would give it in the middle of the push, when the stack blurs
 * it and focuses it again and the keyboard bobs. A keyboard kept up from the
 * page before (`holdKeyboard`) is taken over without moving; with `focus`
 * false it is let go instead. A stack with no moves (a browser's) says
 * nothing and blurs nothing, and the field is focused at once.
 */
export function useFocusOnArrival(field: RefObject<TextInput | null>, focus: boolean): void {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>()
  // Asked once, as the page arrives: a field focused later is the person's doing.
  const [wanted] = useState(focus)
  useEffect(() => {
    let arrived = false
    const arrive = (): void => {
      if (arrived) return
      arrived = true
      if (wanted) field.current?.focus()
      else releaseKeyboard()
    }
    if (!stackMoves) {
      arrive()
      return undefined
    }
    const off = navigation.addListener('transitionEnd', event => {
      if (!event.data.closing) arrive()
    })
    const late = setTimeout(arrive, ARRIVAL_MS)
    return () => {
      off()
      clearTimeout(late)
    }
  }, [navigation, field, wanted])
}
