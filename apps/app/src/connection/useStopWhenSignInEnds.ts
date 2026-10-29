import { useEffect } from 'react'

import { usePlayerCommands } from '../player/PlayerProvider'
import { useConnection } from './ConnectionProvider'

/**
 * The doorman ending this device's sign-in stops the music, as signing out
 * does (`settings/signOut.ts`, step 1): the app is back on Welcome, and a
 * device that is not signed in and still singing is plainly wrong.
 */
export function useStopWhenSignInEnds(): void {
  const { sessionEnded } = useConnection()
  const player = usePlayerCommands()
  useEffect(() => {
    if (sessionEnded) player.clearQueue()
  }, [sessionEnded, player])
}
