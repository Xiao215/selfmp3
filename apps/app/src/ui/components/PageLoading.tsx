import type { ReactNode } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, type } from '@selfmp3/client'
import { useAccent } from '../accent'

/**
 * What a page's body is while what it shows is on its way: the accent's
 * spinner a little way under the head, and, where the wait is worth naming,
 * one quiet line beside it ("Working it out…" while the numbers are counted).
 *
 * One for every page, so a page that is loading looks like the others that
 * are: Playlists, a playlist and Library each placed their own spinner, and
 * Stats, the Report and a shared playlist said it in words of three sizes.
 */
export function PageLoading({ line, testID }: { line?: string; testID?: string }): ReactNode {
  const accent = useAccent()
  return (
    <View
      style={styles.loading}
      accessibilityRole="progressbar"
      accessibilityLabel={line ?? 'Loading'}
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <ActivityIndicator color={accent.accent} />
      {line ? <Text style={styles.line}>{line}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm + 2,
    marginTop: space.xl,
  },
  line: { color: theme.colors.textMuted, fontSize: type.sub },
}))
