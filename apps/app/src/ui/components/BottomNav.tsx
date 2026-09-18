import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NAV_HEIGHT, radius } from '@selfmp3/client'
import { glassBlur } from '../../ports/glassBlur'
import { navBottom } from '../../shell/bottomInset'
import { usePressScale } from '../motion'
import { floating } from '../surfaces'
import { activeTab, type TabHref } from './bottomNav.model'
import { Home, ListMusic, Music, Search } from './Icons'

/**
 * The phone's tab bar (docs/ui-mock `P04`): a capsule floating over the page
 * with Home, Library and Playlists, and a separate search circle beside it.
 *
 * Hand-rolled rather than expo-router's Tabs: the mini player floats directly
 * above it, and a custom bar is less code besides.
 *
 * Everything that is not a tab is reached from Home — the tags, You behind the
 * avatar, Import behind the + — so three tabs are enough. The current tab is a
 * white pill with dark ink, as a chosen chip is; neither is the accent, which
 * is kept for the button that commits.
 *
 * Both float, on glass: a translucent fill that a browser also blurs. The page
 * runs on under them, so every list keeps room at its end (`useBottomInset`).
 */
const TABS: { href: TabHref; label: string; Icon: typeof Music; id: string }[] = [
  { href: '/', label: 'Home', Icon: Home, id: 'home' },
  { href: '/library', label: 'Library', Icon: Music, id: 'library' },
  { href: '/playlists', label: 'Playlists', Icon: ListMusic, id: 'playlists' },
]

export function BottomNav(): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const current = activeTab(pathname)
  const bottom = navBottom(insets.bottom)

  return (
    <>
      <View style={[styles.bar, { bottom }]} accessibilityRole="tablist">
        {TABS.map(tab => {
          const active = tab.href === current
          return (
            <Pressable
              key={tab.href}
              style={[styles.tab, active && styles.tabOn]}
              onPress={() => {
                // A lit tab still goes to its own first page: Home from
                // Settings, Playlists from a playlist, as a phone's tab bar does.
                if (pathname !== tab.href) router.navigate(tab.href)
              }}
              testID={`tab-${tab.id}`}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              // react-native-web does not turn `accessibilityState` into aria-selected.
              aria-selected={active}
            >
              <tab.Icon size={20} tone={active ? 'onPrimary' : 'textSecondary'} />
              <Text style={[styles.label, active && styles.labelOn]} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <SearchCircle bottom={bottom} />
    </>
  )
}

/**
 * Search, on its own beside the tabs. Until the Search page exists
 * (docs/UI-MIGRATION.md, Phase 3) it opens Library with its search box ready.
 */
function SearchCircle({ bottom }: { bottom: number }): ReactNode {
  const router = useRouter()
  const press = usePressScale()
  return (
    <Animated.View style={[styles.circleSlot, { bottom }, press.style]}>
      <Pressable
        {...press.handlers}
        testID="tab-search"
        onPress={() => router.navigate({ pathname: '/library', params: { search: '1' } })}
        accessibilityRole="button"
        accessibilityLabel="Search"
        style={styles.circle}
      >
        <Search size={20} tone="textPrimary" />
      </Pressable>
    </Animated.View>
  )
}

/** Room between the bar and the search circle, and from each edge. */
const EDGE = 16

const styles = StyleSheet.create(theme => ({
  bar: {
    position: 'absolute',
    left: EDGE,
    right: EDGE + NAV_HEIGHT + EDGE,
    height: NAV_HEIGHT,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    backgroundColor: theme.colors.glass,
    ...glassBlur,
    ...floating(theme.colors),
  },
  tab: {
    height: 48,
    minWidth: 64,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  // The tab you are on: the white primary fill, as a chosen chip is.
  tabOn: { backgroundColor: theme.colors.textPrimary },
  label: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
  },
  labelOn: { color: theme.colors.onPrimary },
  circleSlot: {
    position: 'absolute',
    right: EDGE,
    width: NAV_HEIGHT,
    height: NAV_HEIGHT,
  },
  circle: {
    width: NAV_HEIGHT,
    height: NAV_HEIGHT,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.glass,
    ...glassBlur,
    ...floating(theme.colors),
  },
}))
