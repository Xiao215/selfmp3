import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { STALE, queryKeys } from '@selfmp3/client'
import type { DoormanSpace } from '@selfmp3/shared'

import { session as cloud } from '../../replica'

/**
 * How much room the account's storage has, as the doorman asks Google: for
 * the line under where the library is kept on Settings › Account. Asked only
 * for a Google Drive (`enabled`); a bucket has no size the doorman can ask
 * about. Not being able to say is no error worth a word there: the line is
 * simply left out.
 */
export function useStorageSpace(enabled: boolean): UseQueryResult<DoormanSpace['space'], Error> {
  return useQuery({
    queryKey: queryKeys.storageSpace,
    queryFn: async () => {
      const session = await cloud.loadSession()
      return session ? cloud.storageSpace(session, 'storage') : null
    },
    enabled,
    staleTime: STALE.minute,
    retry: false,
  })
}
