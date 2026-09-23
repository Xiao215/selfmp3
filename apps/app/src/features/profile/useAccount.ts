import { useCloudStatus } from '@selfmp3/client'
import type { CloudAccount } from '@selfmp3/shared'

import { useConnection } from '../../connection/ConnectionProvider'
import { useCloudSession } from './useCloudSession'

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
  const me = useCloudSession().data
  // Only a device that talks to a server: on the cloud there is none to ask,
  // and `GET /api/cloud` would be a 501 polled forever.
  const server = useCloudStatus(!fromCloud)
  const theirs = fromCloud ? null : (server.data?.account ?? null)
  return me ? { email: me.email, name: me.name, picture: me.picture } : theirs
}
