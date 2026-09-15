import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAccent } from '../accent'
import { NAV_HEIGHT, type } from '@selfmp3/client'
import { activeTab, type TabHref } from './bottomNav.model'
import { Download, ListMusic, Music, User } from './Icons'

/**
 * The tab bar: the web's `.mobile-nav`, drawn with the same icons.
 *
 * Hand-rolled rather than expo-router's Tabs: a mini player has to sit
 * directly above the tabs, and a custom bar is both less code and an exact
 * match for the web app's mobile nav.
 *
 * Four tabs. Library, Playlists and Import are places you go every day; the
 * fourth, You, lists the rest — Stats, Untagged, Tags and Settings — rather
 * than giving the bar's last slot to Settings alone. Import works anywhere:
 * connected, it looks a link up; signed in to the cloud, it asks the server.
 *
 * The current tab is marked twice, as on the web: the accent colour, and a
 * filled pill behind the icon. Colour alone is a weak signal at 20px and no
 * signal at all to anyone who cannot separate the accent from the grey.
 */
const TABS: { href: TabHref; label: string; Icon: typeof Music }[] = [
  { href: '/', label: 'Library', Icon: Music },
  { href: '/playlists', label: 'Playlists', Icon: ListMusic },
  { href: '/import', label: 'Import', Icon: Download },
  { href: '/you', label: 'You', Icon: User },
]

export function BottomNav(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const accent = useAccent()
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
            <View style={[styles.pill, active && { backgroundColor: accent.accentPill }]}>
              <tab.Icon size={20} color={active ? accent.accent : theme.colors.textMuted} />
            </View>
            <Text
              style={[styles.label, active && { color: accent.accent, fontWeight: '600' }]}
              numberOfLines={1}
            >
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
    backgroundColor: theme.colors.surface1,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
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
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: type.label,
    fontWeight: '500',
  },
}))
