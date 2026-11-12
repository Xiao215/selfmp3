import { useEffect } from 'react'
import { AppState, Linking } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import {
  INSTALL_PAGE_URL,
  announcesBuild,
  installOutcome,
  isNewerBuild,
  type PhoneBuild,
} from '@selfmp3/shared'
import { STALE } from '@selfmp3/client'
import { appUpdate } from '../../ports/appUpdate'
import { prefs } from '../../ports/prefs'
import { dismissToast, showToast } from '../../ui/toast'
import { checkedStatus, checkLabel, type UpdateStatus } from './updateStatus.model'

/**
 * A newer build of the phone app, shared from the `ios` or `android` release
 * (packages/shared/src/phoneBuilds.ts): said in a toast at most once a day
 * (`announcesBuild`), and on Settings' About card, as the Mac app's is,
 * checked on asking and installed from there. Nothing anywhere else, where
 * `appUpdate.offered` is false.
 */

/** The build last announced in a toast, and when, so the toasts come at most once a day. */
const ANNOUNCED_KEY = 'appUpdateAnnounced'
const ANNOUNCED_AT_KEY = 'appUpdateAnnouncedAt'
/** The build last handed to the system to install, and when, for the app started again to say how it went. */
const TRIED_KEY = 'appUpdateTried'
const TRIED_AT_KEY = 'appUpdateTriedAt'

function remembered(buildKey: string, atKey: string): { build: number; at: number } | null {
  const kept = prefs.get(buildKey)
  const build = Number(kept)
  const at = Number(prefs.get(atKey) ?? 0)
  return kept && Number.isFinite(build) ? { build, at } : null
}

const lastAnnounced = () => remembered(ANNOUNCED_KEY, ANNOUNCED_AT_KEY)

function useLatestBuild() {
  return useQuery({
    queryKey: ['github', 'phone-latest'],
    queryFn: () => appUpdate.latest(),
    enabled: appUpdate.offered,
    retry: false,
    staleTime: STALE.hour,
  })
}

const newerThanThis = (latest: PhoneBuild | null | undefined): PhoneBuild | null =>
  latest && isNewerBuild(latest, appUpdate.build) ? latest : null

const openInstallPage = () => void Linking.openURL(INSTALL_PAGE_URL)

/**
 * Hands the build to the system, and says what is happening, which neither
 * system does on its own. The app started again says whether the build went
 * in (`sayInstallOutcome`).
 *
 * iOS, after its own Install, downloads the build, then waits for self.mp3
 * to leave the screen before putting it in — the app asking is the app being
 * replaced. Pressing Install used to end there, with nothing to see
 * (2026-10-27), then with a message whose Home stepped back. Now the app
 * steps back to the Home Screen itself once iOS's question is answered
 * (`leaveOnceAnswered`), and the icon there shows the rest.
 *
 * Android has the app download the build itself, then opens the installer
 * over it; the installer putting it in ends this app, so the installer
 * closing with the app still here means it did not.
 */
function install(build: number): void {
  const fetching = appUpdate.downloads
    ? showToast(
        { say: `Downloading build ${build}…`, under: 'The installer opens when it’s here.' },
        'info',
        { autoDismissMs: 0 },
      )
    : null
  const handed = () => {
    if (fetching !== null) dismissToast(fetching)
    prefs.set(TRIED_KEY, String(build))
    prefs.set(TRIED_AT_KEY, String(Date.now()))
  }
  // Watching from before the link opens: its question can come before the open settles.
  const answered = appUpdate.downloads ? null : leaveOnceAnswered(build)
  appUpdate.install(handed).then(
    () => {
      if (answered) answered.opened()
      else notIn(build)
    },
    () => {
      answered?.stop()
      if (fetching !== null) dismissToast(fetching)
      showToast(
        appUpdate.downloads
          ? {
              say: `Couldn’t download build ${build}`,
              under: 'Try again, or get it from the install page.',
            }
          : {
              say: 'Couldn’t start the install',
              under: 'iOS wouldn’t open it. Safari can, from the install page.',
            },
        'error',
        { actions: [{ label: 'Open', onPress: openInstallPage }] },
      )
    },
  )
}

/** How long the opened link has for iOS's question to come, before the app steps back without one. */
const QUESTION_MS = 5000

/**
 * iOS asks over the app whether to replace it: the app goes inactive while
 * the question is up, and active again once it is answered. Either answer
 * brings it back, and nothing says which, so the app steps back to the Home
 * Screen on either. Cancel then finds the app still running on coming back,
 * which says the build hasn't gone in, with Install again.
 *
 * A link that asks nothing (the simulator's) steps back once `opened` has
 * waited QUESTION_MS — the time for iOS to fetch the manifest and ask. The
 * app leaving the screen on its own while asked is the Home gesture doing
 * the same.
 */
function leaveOnceAnswered(build: number): { opened(): void; stop(): void } {
  let asked = false
  let wait: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    watch.remove()
    clearTimeout(wait)
  }
  const leave = () => {
    stop()
    leaveForInstall(build)
  }
  const watch = AppState.addEventListener('change', state => {
    if (state === 'inactive') {
      asked = true
      clearTimeout(wait)
    } else if (state === 'background') {
      stop()
      notInOnReturn(build)
    } else if (asked) leave()
  })
  return {
    opened: () => {
      if (!asked) wait = setTimeout(leave, QUESTION_MS)
    },
    stop,
  }
}

/** Steps back for iOS to put the build in. */
function leaveForInstall(build: number): void {
  notInOnReturn(build)
  appUpdate.leave()
}

/** Putting the build in ends this app, so coming back to this one still running means it has not gone in. */
function notInOnReturn(build: number): void {
  const back = AppState.addEventListener('change', state => {
    if (state !== 'active') return
    back.remove()
    notIn(build)
  })
}

function notIn(build: number): void {
  showToast(
    {
      say: `Build ${build} hasn’t gone in`,
      under: `Try again, or from its page in ${appUpdate.browser}.`,
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

/** The app started again after handing a build to the system: whether it went in. */
function sayInstallOutcome(): void {
  const tried = remembered(TRIED_KEY, TRIED_AT_KEY)
  if (!tried) return
  prefs.set(TRIED_KEY, '')
  const outcome = installOutcome(tried, appUpdate.build, Date.now())
  if (outcome === 'in') showToast(`Updated to build ${appUpdate.build}`, 'good')
  else if (outcome === 'not-in') notIn(tried.build)
}

/** Mounted with the toasts; draws nothing of its own. */
export function AppUpdateNotice(): null {
  const newer = newerThanThis(useLatestBuild().data)
  useEffect(() => {
    if (appUpdate.offered) sayInstallOutcome()
  }, [])
  useEffect(() => {
    const now = Date.now()
    if (!newer || !announcesBuild(newer.build, lastAnnounced(), now)) return
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
 * it. Null where builds are not shared this way (`appUpdate.offered`).
 */
export function useAppUpdateStatus(): UpdateStatus | null {
  const latest = useLatestBuild()
  if (!appUpdate.offered) return null
  const newer = newerThanThis(latest.data)
  if (newer) {
    return {
      tone: 'ready',
      line: `Build ${newer.build} is ready`,
      action: {
        label: 'Install',
        onPress: () => install(newer.build),
        primary: true,
        testID: 'settings-app-update',
      },
    }
  }
  const check = {
    label: checkLabel(latest.isFetching, latest.isSuccess),
    onPress: () => void latest.refetch(),
    busy: latest.isFetching,
    testID: 'settings-app-update-check',
  }
  return checkedStatus(latest.isError ? 'failed' : latest.isSuccess ? 'upToDate' : 'notYet', check)
}

/** The version as About shows it: with the build number where builds are shared. */
export function versionLabel(version: string): string {
  return appUpdate.offered && Number.isFinite(appUpdate.build)
    ? `${version} (${appUpdate.build})`
    : version
}
