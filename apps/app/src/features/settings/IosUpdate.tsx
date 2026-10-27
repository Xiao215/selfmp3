import { useEffect } from 'react'
import { AppState, Linking } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import {
  IOS_INSTALL_PAGE_URL,
  announcesIosBuild,
  iosInstallOutcome,
  isNewerIosBuild,
  type IosLatest,
} from '@selfmp3/shared'
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
/** The build last handed to iOS to install, and when, for the app started again to say how it went. */
const TRIED_KEY = 'iosUpdateTried'
const TRIED_AT_KEY = 'iosUpdateTriedAt'

function remembered(buildKey: string, atKey: string): { build: number; at: number } | null {
  const kept = prefs.get(buildKey)
  const build = Number(kept)
  const at = Number(prefs.get(atKey) ?? 0)
  return kept && Number.isFinite(build) ? { build, at } : null
}

const lastAnnounced = () => remembered(ANNOUNCED_KEY, ANNOUNCED_AT_KEY)

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

const openInstallPage = () => void Linking.openURL(IOS_INSTALL_PAGE_URL)

/**
 * Hands the build to iOS, and says what is happening, which iOS does not:
 * after its own Install it downloads the build, then waits for self.mp3 to
 * leave the screen before putting it in — the app asking is the app being
 * replaced. Pressing Install used to end there, with nothing to see
 * (2026-10-27). The message stays until answered, and Home steps back to
 * the Home Screen, where the icon shows the rest; the app started again says
 * whether the build went in (`sayInstallOutcome`).
 */
function install(build: number): void {
  iosUpdate.install().then(
    () => {
      prefs.set(TRIED_KEY, String(build))
      prefs.set(TRIED_AT_KEY, String(Date.now()))
      showToast(
        {
          say: `Build ${build} goes in from the Home Screen`,
          under: 'self.mp3 has to close for it. Its icon there shows how far it’s got.',
        },
        'info',
        { autoDismissMs: 0, actions: [{ label: 'Home', onPress: leaveForInstall(build) }] },
      )
    },
    () =>
      showToast(
        {
          say: 'Couldn’t start the install',
          under: 'iOS wouldn’t open it. Safari can, from the install page.',
        },
        'error',
        { actions: [{ label: 'Open', onPress: openInstallPage }] },
      ),
  )
}

/**
 * Steps back for iOS to put the build in. Putting it in ends this app, so
 * coming back to this one still running means it has not gone in yet.
 */
const leaveForInstall = (build: number) => (): void => {
  const back = AppState.addEventListener('change', state => {
    if (state !== 'active') return
    back.remove()
    notIn(build)
  })
  iosUpdate.leave()
}

function notIn(build: number): void {
  showToast(
    {
      say: `Build ${build} hasn’t gone in`,
      under: 'Try again, or from its page in Safari.',
    },
    'error',
    {
      actions: [
        { label: 'Install', onPress: () => install(build) },
        { label: 'Page', onPress: openInstallPage },
      ],
    },
  )
}

/** The app started again after handing a build to iOS: whether it went in. */
function sayInstallOutcome(): void {
  const tried = remembered(TRIED_KEY, TRIED_AT_KEY)
  if (!tried) return
  prefs.set(TRIED_KEY, '')
  const outcome = iosInstallOutcome(tried, iosUpdate.build, Date.now())
  if (outcome === 'in') showToast(`Updated to build ${iosUpdate.build}`, 'good')
  else if (outcome === 'not-in') notIn(tried.build)
}

/** Mounted with the toasts; draws nothing of its own. */
export function IosUpdateNotice(): null {
  const newer = newerThanThis(useLatestBuild().data)
  useEffect(() => {
    if (iosUpdate.offered) sayInstallOutcome()
  }, [])
  useEffect(() => {
    const now = Date.now()
    if (!newer || !announcesIosBuild(newer.build, lastAnnounced(), now)) return
    prefs.set(ANNOUNCED_KEY, String(newer.build))
    prefs.set(ANNOUNCED_AT_KEY, String(now))
    showToast('A newer self.mp3 is ready.', 'info', {
      actions: [{ label: 'Install', onPress: () => install(newer.build) }],
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
      action: {
        label: 'Install',
        onPress: () => install(newer.build),
        primary: true,
        testID: 'settings-ios-update',
      },
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
