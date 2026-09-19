import { useState } from 'react'
import type { ReactNode } from 'react'
import { ServerAway } from '../../connection/ServerAway'
import { useServerDirect } from '../../connection/useServerDirect'
import { useConnection } from '../../connection/ConnectionProvider'
import { StatsFrame } from './StatsFrame'
import { StatsScreen } from './StatsScreen'
import type { StatsPeriod } from './stats.model'

/**
 * The Stats route, whichever kind of library this device has.
 *
 * Stats are the one thing the bucket cannot hold: a snapshot is the library as
 * it stands, and every number on this page comes from the plays behind it,
 * which live on the server. So a cloud library reaches the server the way
 * Import does and asks it directly (statsSource.ts).
 *
 * When it cannot be reached the page is still drawn — the title, the window,
 * the way to the Report — with the reason in its body. Leaving Stats out of
 * the sidebar instead, which is what this replaces, told a device signed in to
 * the cloud that the feature did not exist.
 */
export function StatsViaServer(): ReactNode {
  const { fromCloud } = useConnection()
  if (!fromCloud) return <StatsScreen />
  return <CloudStats />
}

function CloudStats(): ReactNode {
  const reach = useServerDirect()
  /*
   * The frame is drawn here too, rather than an empty page: the heading and
   * the window are there while the server is looked for, so what arrives
   * fills a page that is already the right shape.
   *
   * Its own window, because the page below it has its own. A server going
   * away mid-view therefore starts it over — rare enough, and the page has to
   * change under you anyway.
   */
  const [period, setPeriod] = useState<StatsPeriod>('month')

  if (reach.state === 'reachable') return <StatsScreen via={reach.connection} />

  return (
    <StatsFrame period={period} onPeriod={setPeriod} testID="stats-screen">
      <ServerAway reach={reach} need="stats" testID="stats-server" />
    </StatsFrame>
  )
}
