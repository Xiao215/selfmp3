import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isNewerIosBuild, type IosLatest } from '@selfmp3/shared'
import { STALE } from '@selfmp3/client'
import { iosUpdate } from '../../ports/iosUpdate'
import { prefs } from '../../ports/prefs'
import { Button } from '../../ui/components/Button'
import { showToast } from '../../ui/toast'
import { Row } from './SettingsParts'

/**
 * A newer build of the iPhone app, shared from the `ios` release
 * (packages/shared/src/iosApp.ts): said once per build in a toast, and kept in
 * Settings › About until it is installed. Nothing anywhere else, where
 * `iosUpdate.offered` is false.
 */

/** The build last announced in a toast, so each is announced once. */
const ANNOUNCED_KEY = 'iosUpdateAnnounced'

function useIosUpdate(): IosLatest | null {
  const latest = useQuery({
    queryKey: ['github', 'ios-latest'],
    queryFn: () => iosUpdate.latest(),
    enabled: iosUpdate.offered,
    retry: false,
    staleTime: STALE.hour,
  }).data
  return latest && isNewerIosBuild(latest, iosUpdate.build) ? latest : null
}

const install = () => void iosUpdate.install()

/** Mounted with the toasts; draws nothing of its own. */
export function IosUpdateNotice(): null {
  const newer = useIosUpdate()
  useEffect(() => {
    if (!newer || prefs.get(ANNOUNCED_KEY) === String(newer.build)) return
    prefs.set(ANNOUNCED_KEY, String(newer.build))
    showToast('A newer self.mp3 is ready.', 'info', {
      actions: [{ label: 'Install', onPress: install }],
    })
  }, [newer])
  return null
}

/** Settings › About: this build, and the newer one while there is one. */
export function IosUpdateRow(): ReactNode {
  const newer = useIosUpdate()
  if (!newer) return null
  return (
    <Row
      label="Update"
      hint={`Build ${newer.build} is ready. iOS asks before it replaces this one; your music and settings stay.`}
    >
      <Button label="Install" variant="primary" onPress={install} testID="settings-ios-update" />
    </Row>
  )
}

/** The version as About shows it: with the build number where builds are shared. */
export function versionLabel(version: string): string {
  return iosUpdate.offered && Number.isFinite(iosUpdate.build)
    ? `${version} (${iosUpdate.build})`
    : version
}
