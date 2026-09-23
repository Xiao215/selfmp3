import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { queryKeys } from '@selfmp3/client'
import type { DoormanMe } from '@selfmp3/shared'

import { session as cloud } from '../../replica'

/**
 * The account this device is signed in to, as the doorman last described it:
 * email, name, picture and the bucket. Read from the stored session, once,
 * and shared through the query cache by every screen that shows part of it
 * — the profile, the sidebar, Settings → Account, Where it lives. Null when
 * signed out.
 *
 * The cache is cleared when the session changes hands (`ConnectionProvider`:
 * signing in, connecting or forgetting a bucket), so the next read is fresh.
 */
export function useCloudSession(): UseQueryResult<DoormanMe | null, Error> {
  return useQuery({
    queryKey: queryKeys.cloudSession,
    queryFn: async () => (await cloud.loadSession())?.me ?? null,
    staleTime: 60_000,
  })
}
