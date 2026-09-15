import type { ReactNode } from 'react'
import { Pressable, Text } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useNavigation, useRouter } from 'expo-router'
import { space } from '@selfmp3/client'
import { isBehind, type StackState } from './backRow.model'
import { ChevronLeft } from './Icons'

/**
 * Go to `href` the way a back button should: back, when that page is the one
 * behind this; otherwise in this one's place (backRow.model.ts). For a link
 * or a button that returns somewhere — "Go to the library", "Import page" —
 * as well as the rows below.
 */
export function useBackTo(): (href: string) => void {
  const router = useRouter()
  const navigation = useNavigation()
  return href => {
    const state = navigation.getState() as StackState | undefined
    if (isBehind(state, href) && router.canGoBack()) router.back()
    else router.replace(href as never)
  }
}

/**
 * "‹ Import" above a page's title: the page it came from, one tap away.
 *
 * Drawn the same as Playlist detail's "‹ Playlists", so every way back looks
 * like one control. The caller decides at which widths it shows.
 */
export function BackRow({
  label,
  href,
  testID,
}: {
  /** The page it returns to, as that page names itself: "You", "Import". */
  label: string
  href: string
  testID?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const backTo = useBackTo()
  return (
    <Pressable
      onPress={() => backTo(href)}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <ChevronLeft size={18} color={theme.colors.textSecondary} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    marginLeft: -4,
    marginBottom: space.xs,
    minHeight: 32,
  },
  label: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
}))
