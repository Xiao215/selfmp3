import type { ReactNode } from 'react'
import { Row } from '../settings/SettingsParts'
import { Toggle } from '../../ui/components/Toggle'
import { setUsageCounting, useUsageCounting } from './usage'
import { useUsageReport } from './useUsageReport'

/** Settings › About: whether this device counts which features it uses (usage.ts). */
export function UsageRow(): ReactNode {
  const on = useUsageCounting()
  return (
    <Row
      label="Count features I use"
      hint="Once a day, how often each feature was used goes to your server as part of one total for everyone. Never what you play, search or ask."
      last
    >
      <Toggle
        value={on}
        onChange={setUsageCounting}
        label="Count features I use"
        testID="settings-usage-counting"
      />
    </Row>
  )
}

/** Drawn as nothing, at the root: sends the finished days (useUsageReport). */
export function UsageReporter(): null {
  useUsageReport()
  return null
}
