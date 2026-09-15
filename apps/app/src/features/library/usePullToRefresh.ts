import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@selfmp3/client'

import { useConnection } from '../../connection/ConnectionProvider'
import { library as cloudLibrary } from '../../replica'

/**
 * Pulling a list down to ask for the library again.
 *
 * In a cloud library that means looking at the bucket now, rather than
 * answering from this device's copy and looking behind it. `also` is anything
 * else the screen shows, such as a playlist's members. `refreshing` is this
 * pull's own, not the query's: a refetch the app made by itself spins nothing.
 */
export function usePullToRefresh(also?: () => Promise<unknown>): {
  refreshing: boolean
  onRefresh: () => void
} {
  const client = useQueryClient()
  const { fromCloud } = useConnection()
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    if (fromCloud) cloudLibrary.markCloudLibraryStale()
    void Promise.allSettled([
      client.refetchQueries({ queryKey: queryKeys.library }),
      also?.(),
    ]).finally(() => setRefreshing(false))
  }, [client, fromCloud, also])

  return { refreshing, onRefresh }
}
