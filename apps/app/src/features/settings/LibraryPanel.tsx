import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { STALE, useScanLibrary, type Api } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { useServerApi } from '../../connection/useServerApi'
import { viaKey } from '../../connection/via'
import { Button } from '../../ui/components/Button'
import { Card, PathRow, Row } from './SettingsParts'
import { scanHint } from './settings.model'

/**
 * Settings › Advanced › Library: the library's folder on its server — the
 * inbox an import lands in, and where a file dropped by hand is picked up —
 * and a rescan of it. All of it is the server's, so a cloud library reaches
 * the server for it, as Import does, and says so when it cannot.
 */
export function LibraryPanel(): ReactNode {
  const server = useServerApi()
  return (
    <Card title="Library">
      {server.reach.state !== 'reachable' || !server.api ? (
        <ServerAway reach={server.reach} need="settings" row testID="library-server" />
      ) : (
        <LibraryRows api={server.api} baseUrl={server.via?.baseUrl} />
      )}
    </Card>
  )
}

function LibraryRows({ api, baseUrl }: { api: Api; baseUrl: string | undefined }): ReactNode {
  // The server's own health, for where its folder is: this device's says
  // nothing of it from a cloud library.
  const health = useQuery({
    queryKey: viaKey(baseUrl, 'health'),
    queryFn: () => api.health(),
    staleTime: STALE.minute,
    retry: false,
  })
  const libraryPath = health.data?.libraryPath
  const scan = useScanLibrary(api)

  return (
    <>
      {libraryPath !== undefined ? <PathRow label="Folder" path={libraryPath} /> : null}
      <Row label="Rescan the folder" hint={scanHint(scan.data)} last>
        <Button
          label={scan.isPending ? 'Scanning…' : 'Rescan'}
          variant="text"
          busy={scan.isPending}
          onPress={() => scan.mutate()}
        />
      </Row>
    </>
  )
}
