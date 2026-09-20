import { useQuery } from '@tanstack/react-query'
import { useCloudStatus } from '@selfmp3/client'
import type { CloudAccount } from '@selfmp3/shared'

import { useConnection } from '../../connection/ConnectionProvider'
import { session as cloud } from '../../replica'

/**
 * Whose library this is: the Google account, with its name and its picture.
 *
 * Two places know it. A device signed in to the cloud holds its own session,
 * which came back from the doorman with the account on it. A device talking
 * to a server asks the server, which signed in the same way. Either answers
 * the same question, so the pages ask this rather than either of them.
 */
export function useAccount(): CloudAccount | null {
  const { fromCloud } = useConnection()
  const mine = useQuery({
    queryKey: ['cloud', 'account'],
    queryFn: async () => (await cloud.loadSession())?.me ?? null,
    staleTime: 60_000,
  })
  // Only a device that talks to a server: on the cloud there is none to ask.
  const server = useCloudStatus()
  const theirs = fromCloud ? null : (server.data?.account ?? null)
  const me = mine.data
  return me ? { email: me.email, name: me.name, picture: me.picture } : theirs
}
