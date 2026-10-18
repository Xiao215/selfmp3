import type { ReactNode } from 'react'
import type { View } from 'react-native'
import { Toggle } from '../../ui/components/Toggle'
import {
  setDeviceDownloads,
  setDeviceHandBack,
  useDeviceDownloads,
  useDeviceHandBack,
} from '../import/devicePrefs'
import { Panel, Row } from './SettingsParts'

/**
 * Downloading in this browser (docs/features/client-download.md): this tab's
 * own switches, kept on this device, beside the server's Importing above.
 * Where to turn on the YouTube sign-in is the extension's own options page:
 * it is the extension that would send it, and no page should be able to.
 */
export function BrowserImportsPanel({
  anchor,
}: {
  anchor: (node: View | null) => void
}): ReactNode {
  const downloads = useDeviceDownloads()
  const handBack = useDeviceHandBack()
  return (
    <Panel title="In this browser" hint="on this device" anchor={anchor}>
      <Row
        label="Download songs here"
        hint="With the self.mp3 extension, YouTube songs are looked up, heard and downloaded in this browser, and your server adds them."
      >
        <Toggle value={downloads} onChange={setDeviceDownloads} label="Download songs here" />
      </Row>
      <Row
        label="Let the server take over when YouTube slows this browser down"
        hint="Off, this browser waits out YouTube's pause, up to 15 minutes, and finishes the songs itself."
        last
      >
        <Toggle
          value={handBack}
          onChange={setDeviceHandBack}
          disabled={!downloads}
          label="Let the server take over when YouTube slows this browser down"
        />
      </Row>
    </Panel>
  )
}
