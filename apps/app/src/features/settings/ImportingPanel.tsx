import type { ReactNode } from 'react'
import { View } from 'react-native'
import { type Settings } from '@selfmp3/shared'
import { Select } from '../../ui/components/Select'
import { Toggle } from '../../ui/components/Toggle'
import { Panel, Row } from './SettingsParts'

export function ImportingPanel({
  settings,
  set,
  anchor,
}: {
  settings: Settings
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  anchor: (node: View | null) => void
}): ReactNode {
  return (
    <Panel title="Importing" hint="shared across your devices" anchor={anchor}>
      <Row label="Downloads at once" hint="Two is a good default.">
        <Select<number>
          value={settings.importConcurrency}
          onChange={value => set('importConcurrency', value)}
          options={[1, 2, 3, 4].map(value => ({ value, label: String(value) }))}
          label="Downloads at once"
        />
      </Row>
      <Row label="Watch the library folder" hint="Picks up files the moment they change." last>
        <Toggle
          value={settings.watchLibrary}
          onChange={value => set('watchLibrary', value)}
          label="Watch the library folder"
        />
      </Row>
    </Panel>
  )
}
