import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAccent } from '../accent'
import { colors, NAV_HEIGHT, type } from '@selfmp3/client'
import { ListMusic, Music, Settings } from './Icons'

/**
 * The tab bar: the web's `.mobile-nav`, drawn with the same icons.
 *
 * Hand-rolled rather than expo-router's Tabs: this app has three destinations
 * and a mini player that has to sit directly above them, and a custom bar is
 * both less code and an exact match for the web app's mobile nav.
 *
 * Three destinations rather than the web's five: Import and Stats both want a
 * Mac — Stats is marked `needsMac` there too — and a tab that is dark more
 * often than not is worse than no tab. They come back when the phone can do
 * that work itself.
 *
 * The current tab is marked twice, as on the web: the accent colour, and a
 * filled pill behind the icon. Colour alone is a weak signal at 20px and no
 * signal at all to anyone who cannot separate the accent from the grey.
 */
const TABS: { href: '/' | '/playlists' | '/settings'; label: string; Icon: typeof Music }[] = [
  { href: '/', label: 'Library', Icon: Music },
  { href: '/playlists', label: 'Playlists', Icon: ListMusic },
  { href: '/settings', label: 'Settings', Icon: Settings },
]

export function BottomNav(): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const accent = useAccent()

  return (
    <View
      style={[styles.bar, { paddingBottom: insets.bottom, height: NAV_HEIGHT + insets.bottom }]}
      accessibilityRole="tablist"
    >
      {TABS.map(tab => {
        const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
        return (
          <Pressable
            key={tab.href}
            style={styles.tab}
            onPress={() => {
              if (!active) router.navigate(tab.href)
            }}
            testID={`tab-${tab.label.toLowerCase()}`}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
          >
            <View style={[styles.pill, active && { backgroundColor: accent.accentPill }]}>
              <tab.Icon size={20} color={active ? accent.accent : colors.textMuted} />
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

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface1,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
    color: colors.textMuted,
    fontSize: type.label,
    fontWeight: '500',
  },
})
