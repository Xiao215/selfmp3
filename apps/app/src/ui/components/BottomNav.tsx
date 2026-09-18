import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NAV_HEIGHT, radius, type } from '@selfmp3/client'
import { activeTab, type TabHref } from './bottomNav.model'
import { Download, ListMusic, Music, User } from './Icons'

/**
 * The tab bar.
 *
 * Hand-rolled rather than expo-router's Tabs: a mini player has to sit
 * directly above the tabs, and a custom bar is less code besides.
 *
 * Four tabs. Library, Playlists and Import are places you go every day; the
 * fourth, You, lists the rest — Stats, Untagged, Tags and Settings — rather
 * than giving the bar's last slot to Settings alone. Import works anywhere:
 * connected, it looks a link up; signed in to the cloud, it asks the server.
 *
 * The current tab is marked twice: a white pill behind the icon, and its label
 * at full strength. Colour alone is a weak signal at 20px; light against dark
 * is not, and neither is the accent, which is kept for the button that commits.
 */
const TABS: { href: TabHref; label: string; Icon: typeof Music }[] = [
  { href: '/', label: 'Library', Icon: Music },
  { href: '/playlists', label: 'Playlists', Icon: ListMusic },
  { href: '/import', label: 'Import', Icon: Download },
  { href: '/you', label: 'You', Icon: User },
]

export function BottomNav(): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const current = activeTab(pathname)

  return (
    <View
      style={[styles.bar, { paddingBottom: insets.bottom, height: NAV_HEIGHT + insets.bottom }]}
      accessibilityRole="tablist"
    >
      {TABS.map(tab => {
        const active = tab.href === current
        return (
          <Pressable
            key={tab.href}
            style={styles.tab}
            onPress={() => {
              // A lit tab still goes to its own first page: You from Settings,
              // Playlists from a playlist, as a phone's tab bar does.
              if (pathname !== tab.href) router.navigate(tab.href)
            }}
            testID={`tab-${tab.label.toLowerCase()}`}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            // react-native-web does not turn `accessibilityState` into aria-selected.
            aria-selected={active}
          >
            <View style={[styles.pill, active && styles.pillOn]}>
              <tab.Icon size={20} tone={active ? 'onPrimary' : 'textMuted'} />
            </View>
            <Text style={[styles.label, active && styles.labelOn]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  bar: {
    flexDirection: 'row',
    // A card's tone against the page, with no line along its top.
    backgroundColor: theme.colors.surface1,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  pill: {
    width: 46,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: type.label,
    fontWeight: '500',
  },
  // The tab you are on: the white primary fill, as a chosen chip is.
  pillOn: { backgroundColor: theme.colors.textPrimary },
  labelOn: { color: theme.colors.textPrimary, fontWeight: '600' },
}))
