import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, type } from '@selfmp3/client'
import { card as cardSurface, rowTitle, textColumn } from '../surfaces'
import { ChevronRight } from './Icons'
import { Press } from './Press'

/**
 * A row that takes you somewhere: what is there, one line on what it holds,
 * and a › at its end — You's Import, Report and Settings, Stats' Report on a
 * phone, Search's Ask, Import's way back to a search or a review left half
 * done, Tags' untagged songs.
 *
 * Each was drawn by its page and they had drifted: icon tiles of 40 and 32,
 * corners of 12 and 10, three ways of looking pressed, and links that said
 * they were buttons. The icon sits in a 40 tile of the control surface
 * (`accent` tints it, for Ask); `leading` takes the tile's place for a
 * picture of its own (a stack of covers). `card` stands it on a card for a
 * row on its own among the page's blocks, rather than in a list of them.
 *
 * It is a link — it goes to a page — unless `role` says it does something
 * here instead.
 */
export function NavRow({
  icon,
  accent = false,
  leading,
  title,
  hint,
  onPress,
  card = false,
  role = 'link',
  accessibilityLabel,
  style,
  testID,
}: {
  icon?: ReactNode
  accent?: boolean
  leading?: ReactNode
  title: string
  hint?: string
  onPress: () => void
  card?: boolean
  role?: 'link' | 'button'
  accessibilityLabel?: string
  /** Places the row among the page's blocks (a margin); never its look. */
  style?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  return (
    <Press
      depth="row"
      wrap={style}
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? (hint ? `${title}, ${hint}` : title)}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        card && styles.card,
        pressed && (card ? styles.cardPressed : styles.pressed),
      ]}
    >
      {leading ??
        (icon ? <View style={[styles.tile, accent && styles.tileAccent]}>{icon}</View> : null)}
      <View style={styles.words}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {hint ? (
          <Text style={styles.hint} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={16} tone="textMuted" />
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60 },
  card: {
    ...cardSurface(theme.colors),
    gap: space.md,
    minHeight: 0,
    paddingVertical: space.md,
    paddingHorizontal: 14,
  },
  pressed: { opacity: 0.6 },
  cardPressed: { backgroundColor: theme.colors.surface2 },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
  },
  tileAccent: { backgroundColor: theme.colors.accentPill },
  words: textColumn,
  title: rowTitle(theme.colors),
  hint: { color: theme.colors.textSecondary, fontSize: type.small },
}))
