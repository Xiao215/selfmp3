import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native-unistyles'
import { EmptyState } from '../../ui/components/EmptyState'

/**
 * What Now Playing says with no song loaded, on a computer's stage and on a
 * phone's page alike. Each page keeps its own head, with its own way out.
 */
export function NothingPlaying(): ReactNode {
  return (
    <EmptyState
      style={styles.empty}
      title="Nothing playing"
      line="Start a song and it turns up here, with its lyrics."
    />
  )
}

const styles = StyleSheet.create({
  // The whole stage, with the words in its middle.
  empty: { flex: 1, justifyContent: 'center' },
})
