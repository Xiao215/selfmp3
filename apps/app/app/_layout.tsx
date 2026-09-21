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
import TrackPlayer from 'react-native-track-player'
import { DevicesProvider } from '../src/features/devices/DevicesProvider'
import { LibraryFilterProvider } from '../src/features/library/libraryFilter'
import { CarProvider } from '../src/ports/car/CarProvider'
import { DownloadsProvider } from '../src/offline/DownloadsProvider'
import { useKeepAlongside } from '../src/offline/useKeepAlongside'
import { PlayerProvider } from '../src/player/PlayerProvider'
import { usePlaybackMemory } from '../src/player/usePlaybackMemory'
import { playbackService } from '../src/player/service'
import { ConnectionProvider, useConnection } from '../src/connection/ConnectionProvider'
import { Shell as Frame } from '../src/shell/Shell'
import { addressOf, swipeBackAllowed } from '../src/shell/backGesture'
import { stackAnimation } from '../src/shell/pageStep'
import { afterWelcome } from '../src/features/welcome/firstSync.model'
import { storedFirstSync } from '../src/features/welcome/firstSyncMemory'
import { useLayout } from '../src/shell/useLayout'
import { setRootWidth } from '../src/shell/rootWidth'
import { pageOwnsScreen, setPageChrome } from '../src/shell/pageChrome'
import { SIDEBAR_WIDTH } from '../src/shell/Sidebar'
import { useStageArriving } from '../src/shell/stageArrival'
import { modalCoversScreen } from '../src/ports/modalCoversScreen'
import { listenForAppFocus } from '../src/ports/appFocus'
import { hideScrollbars } from '../src/ports/scrollbars'
import { registerServiceWorker } from '../src/ports/serviceWorker'
import { AccentProvider } from '../src/ui/accent'
import { WidgetSync } from '../src/features/widget/WidgetSync'
import { showToast } from '../src/ui/toast'

/**
 * The app shell.
 *
 * The playback service is registered at module scope, before any component
 * mounts: on Android it is a headless task that the OS may start with no UI at
 * all, so registration cannot wait for React.
 */
TrackPlayer.registerPlaybackService(() => playbackService)

void SplashScreen.preventAutoHideAsync()

// Before the first paint, so no list is ever drawn with the browser's bar.
hideScrollbars()

// Coming back to the app is focus, for the queries that refetch on it.
listenForAppFocus()

/**
 * The design's two faces (`fonts` in packages/client). A native build embeds
 * them through the `expo-font` config plugin, so this finds them already there;
 * a browser gets them as `@font-face` from here, and a dev client built before
 * the plugin was added loads them at runtime the same way.
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
      if (typeof failure === 'string') showToast(failureText(failure, error), 'error')
    },
  }),
  defaultOptions: {
    queries: {
      // The phone is often on a flaky link to the server at home. Retrying twice
      // and then showing the cached library beats a spinner that never ends.
      retry: 1,
      refetchOnWindowFocus: false,
      gcTime: 24 * 60 * 60 * 1000,
    },
  },
})

/**
 * Now Playing comes up from the foot of the display and goes back down, over
 * 380 ms (docs/ui-mock `M2`, 1). The board has the mini player's card growing
 * into the page with the cover travelling in it; that needs shared elements
 * the app does not have, so the page rises and its cover grows into place as
 * it comes (`NowPlayingScreen`).
 *
 * A `fullScreenModal` has no sideways pop to inherit — the gesture a modal is
 * offered is a downward one — and pulling this one down to close is
 * `NowPlayingScreen`'s own responder, not the navigator's.
 */
const NOW_PLAYING_OPTIONS = {
  presentation: 'fullScreenModal',
  animation: 'slide_from_bottom',
  animationDuration: 380,
} as const

/**
 * At desktop width the page covers the library and not the player bar
 * (docs/ui-mock `C09`), so it cannot be a modal: on an iPad a fullScreenModal
 * covered the shell, and the stage was left with no transport at all.
 */
const NOW_PLAYING_WIDE = {
  presentation: 'card',
  animation: 'slide_from_bottom',
  animationDuration: 380,
} as const

export default function RootLayout(): ReactNode {
  return (
    // Outermost of all: gesture handler installs the root it arbitrates
    // gestures under, and a handler mounted outside one never fires. The one
    // gesture in the app is holding a playlist's row to move it
    // (`ui/components/HoldToReorder`), and it is the page furthest from here.
    <GestureHandlerRootView
      style={styles.root}
      // The width every screen lays out by, measured here (`shell/rootWidth`).
      onLayout={event => setRootWidth(event.nativeEvent.layout.width)}
    >
      <SafeAreaProvider>
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
                  <DevicesProvider>
                    <CarProvider>
                      {/* Around the shell: the sidebar and the library share it. */}
                      <LibraryFilterProvider>
                        <Shell />
                        {/* The home-screen widget's snapshot, where there is one. */}
                        <WidgetSync />
                      </LibraryFilterProvider>
                    </CarProvider>
                  </DevicesProvider>
                </PlayerProvider>
              </DownloadsProvider>
            </ConnectionProvider>
          </QueryClientProvider>
        </AccentProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function Shell(): ReactNode {
  const { theme } = useUnistyles()
  const { status, fromCloud } = useConnection()
  const router = useRouter()
  const pathname = usePathname()
  const { wide } = useLayout()
  // What was playing comes back when the app opens again, paused where it was.
  usePlaybackMemory()
  // Every downloaded song's cover and words, kept beside it while the server answers.
  useKeepAlongside()
  // A face that failed to load is not a reason to keep the app shut: the system
  // font stands in, and nothing else depends on it.
  const [fontsLoaded, fontError] = useFonts(FONTS)
  const fontsReady = fontsLoaded || fontError !== null

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
    if (status === 'missing' && pathname !== '/welcome') router.replace('/welcome')
  }, [status, pathname, router])

  // Welcome with a library is done: a device's first Google sign-in goes on to
  // First sync, once, and anything else — a later sign-in, an address typed in
  // development, a link to Welcome from inside the app — goes Home. Decided
  // here rather than on Welcome, so no second redirect can race it.
  useEffect(() => {
    if (status === 'ready' && pathname === '/welcome') {
      router.replace(afterWelcome(fromCloud, storedFirstSync()))
    }
  }, [status, pathname, fromCloud, router])

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
      ({ route }: { route: { name: string } }) => ({
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
        // The shell steps a tab's page in; the stack crossfades the pages a
        // phone pushes (`src/shell/pageStep.ts`).
        ...stackAnimation(route.name, wide),
        // Per screen, because the tab bar navigates inside this one stack:
        // without it iOS popped back to the tab underneath on a swipe.
        // `src/shell/backGesture.ts` has the rule and the reason.
        gestureEnabled: swipeBackAllowed(route.name),
      }),
    [surface, wide, ready],
  )

  return (
    <Frame chrome={chrome} sidebar={!(stage && arriving)}>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="now-playing" options={wide ? NOW_PLAYING_WIDE : NOW_PLAYING_OPTIONS} />
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
    </Frame>
  )
}

/** Light text over the dark theme, dark text over the light one, following a switch. */
function ThemedStatusBar(): ReactNode {
  const { rt } = useUnistyles()
  return <StatusBar style={rt.themeName === 'light' ? 'dark' : 'light'} />
}

const styles = StyleSheet.create({ root: { flex: 1 } })
