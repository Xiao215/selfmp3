import { useEffect } from 'react'
import { useUnistyles } from 'react-native-unistyles'
import type { ReactNode } from 'react'
import { Stack, usePathname, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TrackPlayer from 'react-native-track-player'
import { DevicesProvider } from '../src/features/devices/DevicesProvider'
import { LibraryFilterProvider } from '../src/features/library/libraryFilter'
import { CarProvider } from '../src/ports/car/CarProvider'
import { DownloadsProvider } from '../src/offline/DownloadsProvider'
import { PlayerProvider } from '../src/player/PlayerProvider'
import { usePlaybackMemory } from '../src/player/usePlaybackMemory'
import { playbackService } from '../src/player/service'
import { ConnectionProvider, useConnection } from '../src/server/ConnectionProvider'
import { Shell as Frame } from '../src/shell/Shell'
import { useLayout } from '../src/shell/useLayout'
import { registerServiceWorker } from '../src/ports/serviceWorker'
import { AccentProvider } from '../src/ui/accent'

/**
 * The app shell.
 *
 * The playback service is registered at module scope, before any component
 * mounts: on Android it is a headless task that the OS may start with no UI at
 * all, so registration cannot wait for React.
 */
TrackPlayer.registerPlaybackService(() => playbackService)

void SplashScreen.preventAutoHideAsync()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The phone is often on a flaky link to a Mac at home. Retrying twice
      // and then showing the cached library beats a spinner that never ends.
      retry: 1,
      refetchOnWindowFocus: false,
      gcTime: 24 * 60 * 60 * 1000,
    },
  },
})

/** Screens that own the whole display: no tab bar, no mini player. */
const FULL_SCREEN_ROUTES = ['/onboarding', '/now-playing']

export default function RootLayout(): ReactNode {
  return (
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

  // In a browser: the manifest, and the service worker, told whether there is a
  // bucket to fetch songs from. Nothing on a phone.
  useEffect(() => {
    if (status !== 'loading') registerServiceWorker({ cloud: fromCloud })
  }, [status, fromCloud])

  useEffect(() => {
    // hideAsync is safe to call more than once, so no "already hidden" flag is
    // needed — and tracking one in state would re-render the whole shell.
    if (status !== 'loading') void SplashScreen.hideAsync()
  }, [status])

  useEffect(() => {
    // Google sign-in is the only way in: the library is the bucket's, and the
    // server does not have to be running. `/onboarding`, typing a server's
    // address, exists in development builds only, for the simulator tests.
    const ownItsRoute = pathname === '/onboarding' || pathname === '/sign-in'
    if (status === 'missing' && !ownItsRoute) router.replace('/sign-in')
  }, [status, pathname, router])

  // On a computer Now Playing covers the sidebar and keeps the player bar.
  const stage = wide && pathname === '/now-playing'
  const chrome = (stage || !FULL_SCREEN_ROUTES.includes(pathname)) && status === 'ready'

  return (
    <Frame chrome={chrome} sidebar={!stage}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.surface0 },
          animation: 'fade',
        }}
      >
        <Stack.Screen
          name="now-playing"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
      </Stack>
    </Frame>
  )
}

/** Light text over the dark theme, dark text over the light one, following a switch. */
function ThemedStatusBar(): ReactNode {
  const { rt } = useUnistyles()
  return <StatusBar style={rt.themeName === 'light' ? 'dark' : 'light'} />
}
