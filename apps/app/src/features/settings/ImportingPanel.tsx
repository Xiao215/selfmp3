import type { ReactNode } from 'react'
import type { View } from 'react-native'
import { ServerAway } from '../../connection/ServerAway'
import { useServerApi } from '../../connection/useServerApi'
import { Select } from '../../ui/components/Select'
import { Toggle } from '../../ui/components/Toggle'
import { Panel, Row, SettingsWaiting } from './SettingsParts'
import { useServerSettings } from './useServerSettings'

/**
 * Settings › Advanced › Importing: how the library's server imports, so read
 * from and written to that server — reached directly from a cloud library, the
 * way Import is, and said to be away when it is.
 */
export function ImportingPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const server = useServerApi()
  const { settings, failed, retry, set } = useServerSettings(
    server.api,
    server.via?.baseUrl ?? null,
  )
  return (
    <Panel title="Importing" anchor={anchor}>
      {server.reach.state !== 'reachable' ? (
        <ServerAway reach={server.reach} need="settings" row testID="importing-server" />
      ) : settings ? (
        <>
          <Row label="Downloads at once">
            <Select<number>
              value={settings.importConcurrency}
              onChange={value => set('importConcurrency', value)}
              options={[1, 2, 3, 4].map(value => ({ value, label: String(value) }))}
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
    </Panel>
  )
}
