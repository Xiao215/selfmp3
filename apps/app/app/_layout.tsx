import { useEffect } from 'react'
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
import { playbackService } from '../src/player/service'
import { ConnectionProvider, useConnection } from '../src/server/ConnectionProvider'
import { Shell as Frame } from '../src/shell/Shell'
import { useLayout } from '../src/shell/useLayout'
import { AccentProvider } from '../src/ui/accent'
import { launchScheme } from '../src/ui/themeAtLaunch'
import { colors } from '@selfmp3/client'

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
      <StatusBar style={launchScheme === 'light' ? 'dark' : 'light'} />
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
  const { status } = useConnection()
  const router = useRouter()
  const pathname = usePathname()
  const { wide } = useLayout()

  useEffect(() => {
    // hideAsync is safe to call more than once, so no "already hidden" flag is
    // needed — and tracking one in state would re-render the whole shell.
    if (status !== 'loading') void SplashScreen.hideAsync()
  }, [status])

  useEffect(() => {
    // Google is the front door: a phone's library is the bucket's, and no Mac
    // has to be awake or even exist. `/onboarding` is still reachable for
    // anyone pointing this at a Mac on purpose, but it is no longer the
    // question a new phone is asked first.
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
          contentStyle: { backgroundColor: colors.surface0 },
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
