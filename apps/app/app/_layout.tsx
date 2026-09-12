import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, usePathname, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TrackPlayer from 'react-native-track-player'
import { CarProvider } from '../src/car/CarProvider'
import { DownloadsProvider } from '../src/offline/DownloadsProvider'
import { PlayerProvider } from '../src/player/PlayerProvider'
import { playbackService } from '../src/player/service'
import { ConnectionProvider, useConnection } from '../src/server/ConnectionProvider'
import { AccentProvider } from '../src/ui/accent'
import { BottomNav } from '../src/ui/components/BottomNav'
import { MiniPlayer } from '../src/ui/components/MiniPlayer'
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
      <StatusBar style="light" />
      {/* Outermost of the app's own providers: everything below draws with it. */}
      <AccentProvider>
        <QueryClientProvider client={queryClient}>
          <ConnectionProvider>
            <DownloadsProvider>
              <PlayerProvider>
                <CarProvider>
                  <Shell />
                </CarProvider>
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

  const chrome = !FULL_SCREEN_ROUTES.includes(pathname) && status === 'ready'

  return (
    <View style={styles.root}>
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
      {chrome ? (
        <>
          <MiniPlayer />
          <BottomNav />
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
})
