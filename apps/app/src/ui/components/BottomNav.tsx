import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NAV_HEIGHT, radius } from '@selfmp3/client'
import { glassBlur, glassFill } from '../../ports/glassBlur'
import { navBottom } from '../../shell/bottomInset'
import { MOVE_MS } from '../motion.model'
import { floating } from '../surfaces'
import { activeTab, type TabHref } from './bottomNav.model'
import { Home, ListMusic, Music } from './Icons'
import { useSlidingHighlight } from './SlidingHighlight'

/**
 * The phone's tab bar (docs/ui-mock `P04`): a capsule floating over the page
 * with Home, Library and Playlists, the three of them sharing its width.
 *
 * No search circle beside it: Home and Library each carry a search field of
 * their own, and a third way in took the room the tabs needed (Xiao, 2026-09-20).
 *
 * Hand-rolled rather than expo-router's Tabs: the mini player floats directly
 * above it, and a custom bar is less code besides.
 *
 * Everything that is not a tab is reached from Home — the tags, You behind the
 * avatar, Import behind the + — so three tabs are enough. The current tab is a
 * white pill with dark ink, as a chosen chip is; neither is the accent, which
 * is kept for the button that commits. The pill slides to the tab you chose,
 * 200 ms (docs/ui-mock `M2`, 4), while the page steps in beside it (`Shell`).
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
  const bottom = navBottom(insets.bottom)
  // Search belongs to no tab, and the tab it was opened from stays lit over it
  // (docs/ui-mock `P18`, `P19`): the bar still says where you were.
  const [lastTab, setLastTab] = useState<TabHref>('/')
  const own = activeTab(pathname)
  // Kept as the page changes, the way React asks a value derived from the
  // last render to be kept: set during render, only when it has moved.
  if (own !== null && own !== lastTab) setLastTab(own)
  const current = own ?? (pathname === '/search' ? lastTab : null)
  const pill = useSlidingHighlight(current, MOVE_MS.tab, styles.pill)

  return (
    <>
      <View style={[styles.bar, { bottom }]} accessibilityRole="tablist">
        {/*
          The tabs share the bar's width, so each one's width changes when the
          bar's does and the pill is measured again (a position that moves
          without a size that changes is not always reported). Narrower than
          the three of them together — an iPad in Slide Over — the bar scrolls
          sideways, as Home's recents do, rather than squeezing them to
          nothing.
        */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          keyboardShouldPersistTaps="handled"
        >
          {pill.highlight}
          {TABS.map(tab => {
            const active = tab.href === current
            return (
              <Pressable
                key={tab.href}
                onLayout={pill.measure(tab.href)}
                // Its own fill only until the sliding pill has somewhere to be.
                style={[styles.tab, active && !pill.placed && styles.tabOn]}
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
        </ScrollView>
      </View>
    </>
  )
}

/** Room from each edge of the display. */
const EDGE = 16

const styles = StyleSheet.create(theme => ({
  bar: {
    position: 'absolute',
    left: EDGE,
    right: EDGE,
    height: NAV_HEIGHT,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: glassFill(theme.colors),
    ...glassBlur,
    ...floating(theme.colors),
  },
  tabs: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
  },
  tab: {
    height: 48,
    // A share of the bar each, and never narrower than a finger.
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 0,
    minWidth: 72,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  // The tab you are on: the white primary fill, as a chosen chip is.
  tabOn: { backgroundColor: theme.colors.textPrimary },
  pill: { borderRadius: radius.pill, backgroundColor: theme.colors.textPrimary },
  label: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
  },
  labelOn: { color: theme.colors.onPrimary },
}))
