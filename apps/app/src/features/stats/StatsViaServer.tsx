import { useState } from 'react'
import type { ReactNode } from 'react'
import { ServerAway } from '../../connection/ServerAway'
import { useServerDirect } from '../../connection/useServerDirect'
import { useConnection } from '../../connection/ConnectionProvider'
import { StatsFrame } from './StatsFrame'
import { StatsScreen } from './StatsScreen'
import type { StatsPeriod, StatsTab } from './stats.model'

/**
 * The Stats route, whichever kind of library this device has.
 *
 * Stats are the one thing the bucket cannot hold: a snapshot is the library as
 * it stands, and every number on this page comes from the plays behind it,
 * which live on the server. So a cloud library reaches the server the way
 * Import does and asks it directly (statsSource.ts).
 *
 * When it cannot be reached the page is still drawn — the title, the tabs, the
 * window — with the reason in its body. Leaving Stats out of the sidebar
 * instead, which is what this replaces, told a device signed in to the cloud
 * that the feature did not exist.
 */
export function StatsViaServer({ initialTab }: { initialTab: StatsTab }): ReactNode {
  const { fromCloud } = useConnection()
  if (!fromCloud) return <StatsScreen initialTab={initialTab} />
  return <CloudStats initialTab={initialTab} />
}

function CloudStats({ initialTab }: { initialTab: StatsTab }): ReactNode {
  const reach = useServerDirect()
  /*
   * The frame is drawn here too, rather than an empty page: the heading and
   * both controls are there while the server is looked for, so what arrives
   * fills a page that is already the right shape.
   *
   * Its own tab and window, because the page below it has its own. A server
   * going away mid-view therefore starts this pair over — rare enough, and the
   * page has to change under you anyway.
   */
  const [tab, setTab] = useState<StatsTab>(initialTab)
  const [period, setPeriod] = useState<StatsPeriod>('month')

  if (reach.state === 'reachable')
    return <StatsScreen initialTab={initialTab} via={reach.connection} />

  return (
    <StatsFrame tab={tab} onTab={setTab} period={period} onPeriod={setPeriod} testID="stats-screen">
      <ServerAway reach={reach} need="stats" testID="stats-server" />
    </StatsFrame>
  )
}
