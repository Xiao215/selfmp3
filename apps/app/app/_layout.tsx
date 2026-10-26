import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'
import type { ReactNode } from 'react'
import { Stack, usePathname, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif'
import { BricolageGrotesque_600SemiBold } from '@expo-google-fonts/bricolage-grotesque'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { failureText } from '@selfmp3/client'
import { DevicesProvider } from '../src/features/devices/DevicesProvider'
import { LibraryFilterProvider } from '../src/features/library/libraryFilter'
import { CarProvider } from '../src/ports/car/CarProvider'
import { DownloadsProvider } from '../src/offline/DownloadsProvider'
import { useKeepWaitingEdits } from '../src/offline/waitingEdits'
import { useKeepAlongside } from '../src/offline/useKeepAlongside'
import { RoomProvider } from '../src/features/room/RoomProvider'
import { PlayerProvider } from '../src/player/PlayerProvider'
import { useRecordRecentLists } from '../src/features/lists/recentLists.store'
import { usePlaybackMemory } from '../src/player/usePlaybackMemory'
import { registerPlayback } from '../src/player/registerPlayback'
import { ConnectionProvider, useConnection } from '../src/connection/ConnectionProvider'
import { Shell } from '../src/shell/Shell'
import { TitleBarRoom } from '../src/shell/TitleBarRoom'
import { addressOf, fullScreenSwipeAllowed, swipeBackAllowed } from '../src/shell/backGesture'
import { fromTile } from '../src/features/tag/placeLinks'
import { nowPlayingAnimation, stackAnimation } from '../src/shell/pageStep'
import { keepNearTop } from '../src/shell/keepNearTop'
import { useMotionReduced } from '../src/ui/motion'
import { afterWelcome } from '../src/features/welcome/firstSync.model'
import { STORAGE_ROUTE } from '../src/features/welcome/storage.model'
import { installedApp } from '../src/ports/install'
import { storedFirstSync } from '../src/features/welcome/firstSyncMemory'
import { useLayoutFlags } from '../src/shell/useLayout'
import { setRootWidth } from '../src/shell/rootWidth'
import { opensSignedOut } from '../src/shell/fullScreen.model'
import { useRoom } from '../src/features/room/room.store'
import { pageOwnsScreen, setPageChrome } from '../src/shell/pageChrome'
import { useStageArriving } from '../src/shell/stageArrival'
import { modalCoversScreen } from '../src/ports/modalCoversScreen'
import { listenForAppFocus } from '../src/ports/appFocus'
import { onAppLeaving } from '../src/ports/appLeaving'
import { sendingAsLeaving } from '../src/api/client'
import { hideScrollbars } from '../src/ports/scrollbars'
import { registerServiceWorker } from '../src/ports/serviceWorker'
import { singularPage, singularPlaces, singularSearch } from '../src/ports/singularPlaces'
import { useHistoryStepsOnLiveKeys } from '../src/ports/historySteps'
import { AccentProvider } from '../src/ui/accent'
import { WidgetSync } from '../src/features/widget/WidgetSync'
import { BucketHoldNotice } from '../src/features/profile/BucketHoldNotice'
import { sendPending, showToast } from '../src/ui/toast'
import { SIDEBAR_WIDTH } from '../src/shell/widths'
import { UsageReporter } from '../src/features/usage/UsageRow'

/**
 * The app shell.
 *
 * The playback service is registered at module scope, before any component
 * mounts: on Android it is a headless task that the OS may start with no UI at
 * all, so registration cannot wait for React (`registerPlayback.ts`).
 */
registerPlayback()

void SplashScreen.preventAutoHideAsync()

// Before the first paint, so no list is ever drawn with the browser's bar.
hideScrollbars()

// Coming back to the app is focus, for the queries that refetch on it.
listenForAppFocus()

// Leaving it sends what was waiting on its Undo, so closing the app loses none
// of it: as requests that outlive the page, since a closing tab cancels the rest.
onAppLeaving(
  () => {
    sendingAsLeaving(true)
    sendPending()
  },
  () => sendingAsLeaving(false),
)

/**
 * The design's two faces (`fonts` in packages/client). A native build embeds
 * them through the `expo-font` config plugin, so this finds them already there;
 * a browser gets them as `@font-face` from here. iOS draws them by their own
 * names instead (`ports/fonts`).
 */
const FONTS = {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
  BricolageGrotesque_600SemiBold,
}

const queryClient = new QueryClient({
  // An edit that failed says so. Most are taps that leave nothing on screen to
  // show an error — a heart, a tag, a song off a playlist — and failed without
  // a word. Those carry what to say (`meta.failure`); an edit whose screen
  // shows its own error carries nothing, and is left to it.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const failure = mutation.meta?.['failure']
      if (typeof failure !== 'string') return
      // The toast says it plainly; the detail is for whoever is debugging.
      console.warn(`${failure}:`, error)
      showToast(failureText(failure, error), 'error')
    },
  }),
  defaultOptions: {
    queries: {
      // The phone is often on a flaky link to the server at home. One retry and
      // then the cached library beats a spinner that never ends.
      retry: 1,
      refetchOnWindowFocus: false,
      // How long an answer nothing on screen reads is kept: not long, or a long
      // session holds every song's lyrics and motion, each artist, each Ask.
      // Nothing here is persisted, so keeping longer buys no offline copy:
      // those are the snapshots (`api/client.ts`). The library itself is
      // always read, so never dropped.
      gcTime: 10 * 60 * 1000,
    },
  },
})

/**
 * The places the sidebar and the tab bar go to, which a browser keeps one of.
 *
 * Going to a page the stack does not have on top adds it, so Library → Tags →
 * Library → Tags grew the stack by a page a click. Where `singularPlaces`
 * says so, a place already in the stack is brought back to the top instead.
 */
const PLACES = [
  'index',
  'library',
  'tags',
  'playlists/index',
  'import/index',
  'stats/index',
  'search',
  'settings',
  'profile',
] as const

/**
 * The pages of one thing, which a browser keeps one of each of: the same tag,
 * artist, playlist or song opened again brings its page back up
 * (`singularPage`).
 */
const PAGES = ['tag/[name]', 'artist/[name]', 'playlists/[id]', 'song/[id]'] as const

/**
 * Now Playing comes up from the foot of the display and goes back down
 * (docs/ui-mock `M2`, 1). The board has the mini player's card growing into
 * the page with the cover travelling in it; that needs shared elements the
 * app does not have, so on a phone the page rises itself and its cover grows
 * into place from where the mini player's cover was (`NowPlayingScreen`,
 * `ui/coverHandoff.ts`), and the navigator plays nothing
 * (`nowPlayingAnimation`); an iPad's stack slides it up over 380 ms.
 *
 * A modal has no sideways pop to inherit — the gesture a modal is offered is
 * a downward one — and pulling this one down to close is `NowPlayingScreen`'s
 * own responder, not the navigator's.
 *
 * At desktop width the page covers the library and not the player bar
 * (docs/ui-mock `C09`), so it cannot be a modal: on an iPad a fullScreenModal
 * covered the shell, and the stage was left with no transport at all.
 */
function nowPlayingOptions(wide: boolean, reduced: boolean) {
  if (wide) return { presentation: 'card', ...nowPlayingAnimation(wide, reduced) } as const
  // A transparent modal, so the library stays drawn under the page as it
  // rises and the cover is seen to travel out of the mini player; the page
  // paints its own ground, which rises with it.
  return {
    presentation: 'transparentModal',
    contentStyle: { backgroundColor: 'transparent' },
    ...nowPlayingAnimation(wide, reduced),
  } as const
}

export default function RootLayout(): ReactNode {
  return (
    // Outermost of all: gesture handler installs the root it arbitrates
    // gestures under, and a handler mounted outside one never fires.
    <GestureHandlerRootView
      style={styles.root}
      // The width every screen lays out by, measured here (`shell/rootWidth`).
      onLayout={event => setRootWidth(event.nativeEvent.layout.width)}
    >
      <SafeAreaProvider>
        {/* A narrow desktop window's traffic lights, as a phone's status bar. */}
        <TitleBarRoom>
          <ThemedStatusBar />
          {/* Outermost of the app's own providers: everything below draws with it. */}
          <AccentProvider>
            <QueryClientProvider client={queryClient}>
              <ConnectionProvider>
                <DownloadsProvider>
                  <PlayerProvider>
                    {/*
                    Inside the player, not around it: devices reads the player to
                    build a heartbeat and calls back into it to execute a handoff,
                    and the player has no idea other devices exist.
                  */}
                    {/* Listening together: the room's songs, and the host's player playing them. */}
                    <RoomProvider>
                      <DevicesProvider>
                        <CarProvider>
                          {/* Around the shell: the sidebar and the library share it. */}
                          <LibraryFilterProvider>
                            <RootRoutes />
                            {/* What is kept in step behind the pages: drawn as nothing. */}
                            <Keeping />
                            {/* The home-screen widget's snapshot, where there is one. */}
                            <WidgetSync />
                            {/* The bucket refusing for the day, said once. */}
                            <BucketHoldNotice />
                            {/* Yesterday's feature counts, sent to the server once. */}
                            <UsageReporter />
                          </LibraryFilterProvider>
                        </CarProvider>
                      </DevicesProvider>
                    </RoomProvider>
                  </PlayerProvider>
                </DownloadsProvider>
              </ConnectionProvider>
            </QueryClientProvider>
          </AccentProvider>
        </TitleBarRoom>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

/**
 * The work that follows the player and the downloads and draws nothing, in a
 * component of its own.
 *
 * These read the player and the download queue, and a hook reading them
 * renders whoever calls it on every play, pause, skip and finished download.
 * Called from the routes below, that was the root of the app: the frame, the
 * overlay host and the navigator with every screen's options, again for a
 * press of pause. Here only this does.
 */
function Keeping(): ReactNode {
  // What was playing comes back when the app opens again, paused where it was.
  usePlaybackMemory()
  useRecordRecentLists()
  // Every downloaded song's cover and words, kept beside it while the server answers.
  useKeepAlongside()
  // Edits made while the library was out of reach, kept through a reload.
  useKeepWaitingEdits()
  return null
}

/** Which page is showing, and the frame around it: where sign-in sends you, and the stack. */
function RootRoutes(): ReactNode {
  const { theme } = useUnistyles()
  const { status, fromCloud, needsStorage } = useConnection()
  const router = useRouter()
  const pathname = usePathname()
  // A guest in a room adds to it from Search (`opensSignedOut`).
  const inRoom = useRoom().pass !== null
  const { wide } = useLayoutFlags()
  const reduced = useMotionReduced()
  // A face that failed to load is not a reason to keep the app shut: the system
  // font stands in, and nothing else depends on it.
  const [fontsLoaded, fontError] = useFonts(FONTS)
  const fontsReady = fontsLoaded || fontError !== null
  // A browser's Back and Forward keep the app mounted, and the music playing.
  useHistoryStepsOnLiveKeys()

  // In a browser: the manifest, and the service worker, told whether there is a
  // bucket to fetch songs from. Nothing on a phone.
  useEffect(() => {
    if (status !== 'loading') registerServiceWorker({ cloud: fromCloud })
  }, [status, fromCloud])

  useEffect(() => {
    // hideAsync is safe to call more than once, so no "already hidden" flag is
    // needed — and tracking one in state would re-render the whole shell.
    if (status !== 'loading' && fontsReady) void SplashScreen.hideAsync()
  }, [status, fontsReady])

  useEffect(() => {
    // Google sign-in is the only way in: the library is the bucket's, and the
    // server does not have to be running. Welcome is where it starts, and in a
    // development build it also takes a server's address, for the simulator
    // tests. Signing out lands here too, by the same rule.
    // A room's invite and the room itself are the exception: a friend
    // without self.mp3 joins with a name (docs/features/listen-together.md).
    if (status === 'missing' && pathname !== '/welcome' && !opensSignedOut(pathname, inRoom)) {
      router.replace('/welcome')
    }
  }, [status, pathname, router, inRoom])

  // Welcome with a library is done: an account with no bucket yet goes to
  // Where it lives, a device's first Google sign-in goes on to First sync,
  // once, and anything else — a later sign-in, an address typed in
  // development, a link to Welcome from inside the app — goes Home. Decided
  // here rather than on Welcome, so no second redirect can race it.
  useEffect(() => {
    if (status === 'ready' && pathname === '/welcome') {
      router.replace(afterWelcome(fromCloud, storedFirstSync(), installedApp, needsStorage))
    }
  }, [status, pathname, fromCloud, needsStorage, router])

  // An account with no bucket has no library to show: whatever page this is,
  // Where it lives comes first. Welcome is left alone, being on its way there.
  useEffect(() => {
    if (
      status === 'ready' &&
      needsStorage &&
      pathname !== STORAGE_ROUTE &&
      pathname !== '/welcome'
    ) {
      router.replace(STORAGE_ROUTE)
    }
  }, [status, needsStorage, pathname, router])

  // On a computer Now Playing covers the sidebar and keeps the player bar.
  const stage = wide && pathname === '/now-playing'
  // The sidebar goes as the page starts up over it, which is later than the
  // address changes (`shell/stageArrival.ts`).
  const arriving = useStageArriving()
  // On a phone Now Playing is a native modal over the tab bar already. Taking
  // the chrome away under it only made the page beneath taller, and a list
  // scrolled to its end was pulled back up by the difference when it closed.
  const covered = pathname === '/now-playing' && modalCoversScreen && !wide
  const chrome = (stage || covered || !pageOwnsScreen(pathname, wide)) && status === 'ready'
  // Every scrolling page leaves room at its foot for the chrome; the pages
  // that own the display must not keep a hole where the bar would have been.
  useEffect(() => {
    setPageChrome(chrome)
  }, [chrome])

  // Kept, not rebuilt: a new function here is new options for every screen in
  // the stack each time the shell renders.
  const surface = theme.colors.surface0
  const ready = status === 'ready'
  const screenOptions = useMemo(
    () =>
      ({ route }: { route: { name: string; params?: object } }) => ({
        headerShown: false,
        contentStyle: {
          backgroundColor: surface,
          // The sidebar lies over the page's column (`shell/Shell.tsx`), and a
          // page keeps clear of it here. Now Playing, which covers it, and the
          // pages with no sidebar at all do not — so taking the sidebar away
          // never changes the width of anything.
          paddingLeft:
            wide && ready && !pageOwnsScreen(addressOf(route.name), wide) ? SIDEBAR_WIDTH : 0,
        },
        // The shell steps a tab's page in; the stack slides in the pages a
        // phone pushes, and fades a place in from its Home tile
        // (`src/shell/pageStep.ts`).
        ...stackAnimation(route.name, wide, reduced, fromTile(route.params)),
        // Per screen, because the tab bar navigates inside this one stack:
        // without it iOS popped back to the tab underneath on a swipe.
        // `src/shell/backGesture.ts` has the rule and the reason.
        gestureEnabled: swipeBackAllowed(route.name),
        // Edge-only where the page has a bar to drag sideways (same file).
        fullScreenGestureEnabled: fullScreenSwipeAllowed(route.name),
      }),
    [surface, wide, ready, reduced],
  )

  const nowPlaying = useMemo(() => nowPlayingOptions(wide, reduced), [wide, reduced])

  return (
    <Shell chrome={chrome} covered={covered} sidebar={!(stage && arriving)}>
      <Stack screenOptions={screenOptions} screenLayout={keepNearTop}>
        <Stack.Screen name="now-playing" options={nowPlaying} />
        {PLACES.map(name => (
          <Stack.Screen
            key={name}
            name={name}
            dangerouslySingular={name === 'search' ? singularSearch : singularPlaces}
          />
        ))}
        {PAGES.map(name => (
          <Stack.Screen key={name} name={name} dangerouslySingular={singularPage} />
        ))}
      </Stack>
      {/*
       * Nothing shows until it is decided where the library comes from — the
       * bucket, a server, or nowhere yet. The library is the first route, and a
       * fresh install drew it, loading, for a moment before going to sign in.
       * A phone's splash screen covers this already; a browser and the desktop app
       * have no splash, so this is theirs.
       */}
      {status === 'loading' || !fontsReady ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.surface0 }]}
        />
      ) : null}
    </Shell>
  )
}

/** Light text over the dark theme, dark text over the light one, following a switch. */
function ThemedStatusBar(): ReactNode {
  const { rt } = useUnistyles()
  return <StatusBar style={rt.themeName === 'light' ? 'dark' : 'light'} />
}

const styles = StyleSheet.create({ root: { flex: 1 } })
