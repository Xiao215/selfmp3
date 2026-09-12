import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAccent } from '../accent'
import { colors, NAV_HEIGHT, type } from '../theme'
import { Glyph, type GlyphName } from './Glyph'

/**
 * The tab bar.
 *
 * Hand-rolled rather than expo-router's Tabs: this app has three destinations
 * and a mini player that has to sit directly above them, and a custom bar is
 * both less code and an exact match for the web app's mobile nav.
 */

const TABS: { href: '/' | '/playlists' | '/settings'; label: string; icon: GlyphName }[] = [
  { href: '/', label: 'Library', icon: 'library' },
  { href: '/playlists', label: 'Playlists', icon: 'playlists' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
]

export function BottomNav(): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const accent = useAccent()

  return (
    <View
      style={[styles.bar, { paddingBottom: insets.bottom, height: NAV_HEIGHT + insets.bottom }]}
    >
      {TABS.map(tab => {
        const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
        return (
          <Pressable
            key={tab.href}
            style={styles.tab}
            onPress={() => router.navigate(tab.href)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Glyph name={tab.icon} size={17} color={active ? accent.accent : colors.textMuted} />
            <Text style={[styles.label, active && { color: accent.accent }]}>{tab.label}</Text>
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    color: colors.textMuted,
    fontSize: type.tiny,
    fontWeight: '500',
  },
})
