import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UsualHoursSchema, type Song, type UsualHours } from '@selfmp3/shared'
import { STALE, useDeviceUids, useUsualHours as useUsualHoursOf } from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { noServer, useVia, viaKey } from '../../connection/via'
import { prefs } from '../../ports/prefs'
import { useSongsById } from '../../ui/songsById'

/**
 * What you usually play at each hour, for Home's hour tile: asked of the
 * server, which alone keeps when each play was, and kept on this device, so
 * the tile still plays while the server is away (a cloud library out of the
 * house). The kept copy is the latest answer; it names songs by uid, which
 * this device lines up with its own songs whatever its ids are.
 */

const KEY = 'home.usual'

function read(): UsualHours | null {
  try {
    const parsed = UsualHoursSchema.safeParse(JSON.parse(prefs.get(KEY) ?? 'null'))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

let kept: UsualHours | null = read()
const listeners = new Set<() => void>()

function keep(hours: UsualHours): void {
  kept = hours
  prefs.set(KEY, JSON.stringify(hours))
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): UsualHours | null => kept

/** The latest answer, from the server when it gives one and the kept copy otherwise. */
export function useUsualHours(): UsualHours | null {
  const via = useVia()
  // The device's own clock against UTC, east positive: the hours are yours.
  const offset = -new Date().getTimezoneOffset()
  const own = useUsualHoursOf(offset, via === undefined)
  const server = useQuery({
    queryKey: viaKey(via?.baseUrl, 'usual', offset),
    queryFn: () => (via ? apiFor(via).usualHours(offset) : noServer()),
    enabled: via !== undefined,
    retry: false,
    staleTime: STALE.fiveMinutes,
  })
  const fresh = via ? server.data : own.data
  useEffect(() => {
    if (fresh) keep(fresh)
  }, [fresh])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Each of this device's songs by uid. Both a cloud library's copy and a server
 * answer `/api/cloud/uids` for the songs they hold.
 */
export function useSongByUid(): (uid: string) => Song | undefined {
  const byId = useSongsById()
  const uids = useDeviceUids()
  return useMemo(() => {
    const ids = new Map((uids.data?.songs ?? []).map(song => [song.uid, song.id]))
    return (uid: string) => {
      const id = ids.get(uid)
      return id === undefined ? undefined : byId.get(id)
    }
  }, [uids.data, byId])
}
