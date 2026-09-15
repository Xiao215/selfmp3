import { focusManager } from '@tanstack/react-query'
import { AppState } from 'react-native'

/**
 * On a phone, the app coming back to the front is what a window gaining focus
 * is in a browser. TanStack Query listens for the browser's; this tells it the
 * phone's, so a query that refetches on focus does when the app is reopened.
 */
export function listenForAppFocus(): void {
  focusManager.setEventListener(setFocused => {
    const subscription = AppState.addEventListener('change', state =>
      setFocused(state === 'active'),
    )
    return () => subscription.remove()
  })
}
