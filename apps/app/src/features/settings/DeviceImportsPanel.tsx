import { useState, type ReactNode } from 'react'
import { resetRatchet } from '@selfmp3/shared'
import { Button } from '../../ui/components/Button'
import { Toggle } from '../../ui/components/Toggle'
import { deviceBudget, downloadsHere } from '../../ports/deviceDownloads'
import { paceNote } from '../import/devicePreview.model'
import {
  setDeviceDownloads,
  setDeviceHandBack,
  useDeviceDownloads,
  useDeviceHandBack,
} from '../import/devicePrefs'
import { Card, Row } from './SettingsParts'

/**
 * Downloading on this device (docs/features/client-download.md): a browser
 * tab's or a phone's own switches, kept on the device, beside the server's
 * Importing above. Where to turn on the YouTube sign-in is the extension's
 * own options page: it is the extension that would send it, and no page
 * should be able to.
 */
export function DeviceImportsPanel(): ReactNode {
  const downloads = useDeviceDownloads()
  const handBack = useDeviceHandBack()
  const { title, place, hint } = downloadsHere
  // Read as the panel draws: a refusal lands while downloading, not while Settings is open.
  const [pace, setPace] = useState(() => paceNote(deviceBudget.get(), Date.now(), place))
  const resetPace = (): void => {
    const state = deviceBudget.get()
    if (state) deviceBudget.save(resetRatchet(state, Date.now()))
    setPace(paceNote(deviceBudget.get(), Date.now(), place))
  }
  const takeOver = `Let the server take over when YouTube slows this ${place} down`
  return (
    <Card title={title}>
      <Row label="Download songs here" hint={hint}>
        <Toggle value={downloads} onChange={setDeviceDownloads} label="Download songs here" />
      </Row>
      <Row
        label={takeOver}
        hint={`Off, this ${place} waits out YouTube's pause, 15 minutes from each refusal, and finishes the songs itself.`}
        last={pace === null}
      >
        <Toggle
          value={handBack}
          onChange={setDeviceHandBack}
          disabled={!downloads}
          label={takeOver}
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
    </Card>
  )
}
