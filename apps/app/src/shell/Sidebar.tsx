import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { colors, radius, space, type } from '@selfmp3/client'
import { useAccent } from '../ui/accent'
import { BrandMark } from '../ui/components/BrandMark'
import { ListMusic, Music, Settings } from '../ui/components/Icons'

/**
 * The desktop's left rail: the web app's `.sidebar`.
 *
 * The same destinations the tab bar carries, in the same order, from the same
 * route files — `docs/UNIVERSAL.md` foundation 5. Only the arrangement differs,
 * which is what a breakpoint is for: a row of icons along the bottom under 820,
 * a column with words beside them above it.
 *
 * The tag list and the offline footer the web sidebar also has belong to the
 * library surface, which phase 4 brings across. What is here is the frame.
 */
const DESTINATIONS: {
  href: '/' | '/playlists' | '/settings'
  label: string
  Icon: typeof Music
}[] = [
  { href: '/', label: 'Library', Icon: Music },
  { href: '/playlists', label: 'Playlists', Icon: ListMusic },
  { href: '/settings', label: 'Settings', Icon: Settings },
]

export const SIDEBAR_WIDTH = 244

export function Sidebar(): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const accent = useAccent()

  return (
    <View style={styles.rail} testID="sidebar">
      <View style={styles.brand}>
        <BrandMark size={20} />
        <Text style={styles.wordmark}>self.mp3</Text>
      </View>

      <View accessibilityRole="tablist" style={styles.nav}>
        {DESTINATIONS.map(destination => {
          const active =
            destination.href === '/' ? pathname === '/' : pathname.startsWith(destination.href)
          return (
            <Pressable
              key={destination.href}
              style={[styles.item, active && { backgroundColor: accent.accentPill }]}
              onPress={() => {
                if (!active) router.navigate(destination.href)
              }}
              accessibilityRole="tab"
              accessibilityLabel={destination.label}
              accessibilityState={{ selected: active }}
              testID={`nav-${destination.label.toLowerCase()}`}
            >
              <destination.Icon size={18} color={active ? accent.accent : colors.textMuted} />
              <Text
                style={[styles.label, active && { color: accent.accent, fontWeight: '600' }]}
                numberOfLines={1}
              >
                {destination.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  rail: {
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.surface1,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: space.md,
    paddingTop: space.xl,
    gap: space.xl,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
  },
  wordmark: {
    color: colors.textPrimary,
    fontSize: type.title,
    fontWeight: '700',
  },
  nav: {
    gap: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: type.body,
  },
})
