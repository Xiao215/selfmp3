import { AppState } from 'react-native'

/**
 * The app going to the background: the last moment a phone surely runs it.
 * iOS may end it from there without a word, so what must not be lost — an
 * action waiting on its Undo (`sendPending`) — is done now. Not `inactive`,
 * which is only the notification shade or a call coming in.
 */
export function onAppLeaving(run: () => void): void {
  AppState.addEventListener('change', state => {
    if (state === 'background') run()
  })
}
