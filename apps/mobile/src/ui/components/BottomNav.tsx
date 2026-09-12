import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, NAV_HEIGHT, type } from '../theme'
import { ListMusic, Music, Settings } from './Icons'

/**
 * The tab bar.
 *
 * Hand-rolled rather than expo-router's Tabs: this app has three destinations
 * and a mini player that has to sit directly above them, and a custom bar is
 * both less code and an exact match for the web app's mobile nav.
 */

/**
 * The same icons the web app's mobile nav uses, from the same drawings.
 *
 * Three destinations rather than the web's five: Import and Stats both want a
 * Mac — Stats is marked `needsMac` there too — and a tab that is dark more
 * often than not is worse than no tab. They come back when the phone can do
 * that work itself.
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
            <tab.Icon size={20} color={active ? colors.accent : colors.textMuted} />
            <Text style={[styles.label, active && styles.activeLabel]}>{tab.label}</Text>
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
  activeLabel: {
    color: colors.accent,
  },
})
