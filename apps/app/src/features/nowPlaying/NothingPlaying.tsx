import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, type } from '@selfmp3/client'

/**
 * What Now Playing says with no song loaded, on a computer's stage and on a
 * phone's page alike. Each page keeps its own head, with its own way out.
 */
export function NothingPlaying(): ReactNode {
  return (
    <View style={styles.empty}>
      <Text style={styles.title}>Nothing playing</Text>
      <Text style={styles.text}>Start a song and it turns up here, with its lyrics.</Text>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  title: { color: theme.colors.textSecondary, fontSize: type.body, fontWeight: '600' },
  text: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center' },
}))
