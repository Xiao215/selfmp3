import { useState, type ReactNode } from 'react'
import type { View } from 'react-native'
import { resetRatchet } from '@selfmp3/shared'
import { Button } from '../../ui/components/Button'
import { Toggle } from '../../ui/components/Toggle'
import { deviceBudget } from '../../ports/deviceDownloads'
import { paceNote } from '../import/devicePreview.model'
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
  // Read as the panel draws: a refusal lands while downloading, not while Settings is open.
  const [pace, setPace] = useState(() => paceNote(deviceBudget.get(), Date.now()))
  const resetPace = (): void => {
    const state = deviceBudget.get()
    if (state) deviceBudget.save(resetRatchet(state, Date.now()))
    setPace(paceNote(deviceBudget.get(), Date.now()))
  }
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
        last={pace === null}
      >
        <Toggle
          value={handBack}
          onChange={setDeviceHandBack}
          disabled={!downloads}
          label="Let the server take over when YouTube slows this browser down"
        />
      </Row>
      {pace !== null ? (
        <Row
          label="Pace at YouTube"
          hint={`${pace} Back to full if nothing has changed since.`}
          last
        >
          <Button label="Reset" onPress={resetPace} testID="settings-reset-youtube-pace" />
        </Row>
      ) : null}
    </Panel>
  )
}
