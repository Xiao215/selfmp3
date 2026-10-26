import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { announcesIosBuild, isNewerIosBuild, type IosLatest } from '@selfmp3/shared'
import { STALE } from '@selfmp3/client'
import { iosUpdate } from '../../ports/iosUpdate'
import { prefs } from '../../ports/prefs'
import { showToast } from '../../ui/toast'
import type { UpdateStatus } from './AboutCard'

/**
 * A newer build of the iPhone app, shared from the `ios` release
 * (packages/shared/src/iosApp.ts): said in a toast at most once a day
 * (`announcesIosBuild`), and on Settings' About card, as the Mac app's is, checked on asking and installed
 * from there. Nothing anywhere else, where `iosUpdate.offered`
 * is false.
 */

/** The build last announced in a toast, and when, so the toasts come at most once a day. */
const ANNOUNCED_KEY = 'iosUpdateAnnounced'
const ANNOUNCED_AT_KEY = 'iosUpdateAnnouncedAt'

function lastAnnounced(): { build: number; at: number } | null {
  const build = Number(prefs.get(ANNOUNCED_KEY))
  const at = Number(prefs.get(ANNOUNCED_AT_KEY) ?? 0)
  return Number.isFinite(build) && prefs.get(ANNOUNCED_KEY) !== null ? { build, at } : null
}

function useLatestBuild() {
  return useQuery({
    queryKey: ['github', 'ios-latest'],
    queryFn: () => iosUpdate.latest(),
    enabled: iosUpdate.offered,
    retry: false,
    staleTime: STALE.hour,
  })
}

const newerThanThis = (latest: IosLatest | null | undefined): IosLatest | null =>
  latest && isNewerIosBuild(latest, iosUpdate.build) ? latest : null

const install = () => void iosUpdate.install()

/** Mounted with the toasts; draws nothing of its own. */
export function IosUpdateNotice(): null {
  const newer = newerThanThis(useLatestBuild().data)
  useEffect(() => {
    const now = Date.now()
    if (!newer || !announcesIosBuild(newer.build, lastAnnounced(), now)) return
    prefs.set(ANNOUNCED_KEY, String(newer.build))
    prefs.set(ANNOUNCED_AT_KEY, String(now))
    showToast('A newer self.mp3 is ready.', 'info', {
      actions: [{ label: 'Install', onPress: install }],
    })
  }, [newer])
  return null
}

/**
 * Settings › About: where the check has got to, and the one thing to do about
 * it. Null where builds are not shared this way (`iosUpdate.offered`).
 */
export function useIosUpdateStatus(): UpdateStatus | null {
  const latest = useLatestBuild()
  if (!iosUpdate.offered) return null
  const newer = newerThanThis(latest.data)
  if (newer) {
    return {
      tone: 'ready',
      line: `Build ${newer.build} is ready`,
      action: { label: 'Install', onPress: install, primary: true, testID: 'settings-ios-update' },
    }
  }
  const check = {
    label: latest.isFetching ? 'Checking…' : latest.isSuccess ? 'Check again' : 'Check',
    onPress: () => void latest.refetch(),
    busy: latest.isFetching,
    testID: 'settings-ios-update-check',
  }
  return latest.isError
    ? { tone: 'error', line: 'Couldn’t check', action: check }
    : latest.isSuccess
      ? { tone: 'good', line: 'Up to date', action: check }
      : { tone: 'quiet', line: 'Not checked yet', action: check }
}

/** The version as About shows it: with the build number where builds are shared. */
export function versionLabel(version: string): string {
  return iosUpdate.offered && Number.isFinite(iosUpdate.build)
    ? `${version} (${iosUpdate.build})`
    : version
}
