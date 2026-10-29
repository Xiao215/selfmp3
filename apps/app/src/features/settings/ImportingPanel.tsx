import type { ReactNode } from 'react'
import { ServerAway } from '../../connection/ServerAway'
import { useServerApi } from '../../connection/useServerApi'
import { Toggle } from '../../ui/components/Toggle'
import { Card, Row, SettingsWaiting, Stepper } from './SettingsParts'
import { useServerSettings } from './useServerSettings'

/**
 * Settings › Advanced › Importing: how the library's server imports, so read
 * from and written to that server — reached directly from a cloud library, the
 * way Import is, and said to be away when it is.
 */
export function ImportingPanel(): ReactNode {
  const server = useServerApi()
  const { settings, failed, retry, set } = useServerSettings(
    server.api,
    server.via?.baseUrl ?? null,
  )
  return (
    <Card title="Importing">
      {server.reach.state !== 'reachable' ? (
        <ServerAway reach={server.reach} need="settings" row testID="importing-server" />
      ) : settings ? (
        <>
          <Row label="Downloads at once">
            <Stepper
              value={settings.importConcurrency}
              min={1}
              max={4}
              onChange={value => set('importConcurrency', value)}
              label="Downloads at once"
            />
          </Row>
          <Row
            label="Look up lyrics automatically"
            hint="Fetches timed lyrics when a song is imported."
          >
            <Toggle
              value={settings.autoFetchLyrics}
              onChange={value => set('autoFetchLyrics', value)}
              label="Look up lyrics automatically"
            />
          </Row>
          <Row label="Watch the library folder" hint="Picks up files the moment they change." last>
            <Toggle
              value={settings.watchLibrary}
              onChange={value => set('watchLibrary', value)}
              label="Watch the library folder"
            />
          </Row>
        </>
      ) : (
        <SettingsWaiting failed={failed} onRetry={retry} />
      )}
    </Card>
  )
}
