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
import { swipeBackAllowed } from '../src/shell/backGesture'
import { useLayout } from '../src/shell/useLayout'
import { modalCoversScreen } from '../src/ports/modalCoversScreen'
import { listenForAppFocus } from '../src/ports/appFocus'
import { hideScrollbars } from '../src/ports/scrollbars'
import { registerServiceWorker } from '../src/ports/serviceWorker'
import { AccentProvider } from '../src/ui/accent'
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

/** Screens that own the whole display: no tab bar, no mini player. */
const FULL_SCREEN_ROUTES = ['/onboarding', '/now-playing']

/**
 * Now Playing comes up from the foot of the display and goes back down.
 *
 * A `fullScreenModal` has no sideways pop to inherit — the gesture a modal is
 * offered is a downward one — and pulling this one down to close is
 * `NowPlayingScreen`'s own responder, not the navigator's.
 */
const NOW_PLAYING_OPTIONS = {
  presentation: 'fullScreenModal',
  animation: 'slide_from_bottom',
} as const

export default function RootLayout(): ReactNode {
  return (
    // Outermost of all: gesture handler installs the root it arbitrates
    // gestures under, and a handler mounted outside one never fires. The one
    // gesture in the app is holding a playlist's row to move it
    // (`ui/components/HoldToReorder`), and it is the page furthest from here.
    <GestureHandlerRootView style={styles.root}>
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
    // server does not have to be running. `/onboarding`, typing a server's
    // address, exists in development builds only, for the simulator tests.
    const ownItsRoute = pathname === '/onboarding' || pathname === '/sign-in'
    if (status === 'missing' && !ownItsRoute) router.replace('/sign-in')
  }, [status, pathname, router])

  // Already connected, sign-in has nothing to offer, and a link to it would draw
  // it inside the whole app, sidebar and library around it.
  useEffect(() => {
    if (status === 'ready' && pathname === '/sign-in') router.replace('/')
  }, [status, pathname, router])

  // On a computer Now Playing covers the sidebar and keeps the player bar.
  const stage = wide && pathname === '/now-playing'
  // On a phone Now Playing is a native modal over the tab bar already. Taking
  // the chrome away under it only made the page beneath taller, and a list
  // scrolled to its end was pulled back up by the difference when it closed.
  const covered = pathname === '/now-playing' && modalCoversScreen
  const chrome = (stage || covered || !FULL_SCREEN_ROUTES.includes(pathname)) && status === 'ready'

  // Kept, not rebuilt: a new function here is new options for every screen in
  // the stack each time the shell renders.
  const surface = theme.colors.surface0
  const screenOptions = useMemo(
    () =>
      ({ route }: { route: { name: string } }) => ({
        headerShown: false,
        contentStyle: { backgroundColor: surface },
        animation: 'fade' as const,
        // Per screen, because the tab bar navigates inside this one stack:
        // without it iOS popped back to the tab underneath on a swipe.
        // `src/shell/backGesture.ts` has the rule and the reason.
        gestureEnabled: swipeBackAllowed(route.name),
      }),
    [surface],
  )

  return (
    <Frame chrome={chrome} sidebar={!stage}>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="now-playing" options={NOW_PLAYING_OPTIONS} />
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
