/**
 * Spike harness for check 6: FlashList v2 scrolls a 2,000-row list on web
 * without blank cells.
 *
 * 2,000 is the size docs/UNIVERSAL.md names, and it is the right size: the
 * whole library arrives in one response with no pagination (docs/ARCHITECTURE.md
 * explains why), so the library screen really does hand a list every song at
 * once. If this falls short on web the plan's own fallback is `FlatList` behind
 * `SongList.web.tsx`, and nothing else changes.
 *
 * The rows are deliberately the shape of a song row — a fixed-height row with a
 * title and a subtitle — rather than a bare `<Text>`, because a list of empty
 * boxes recycles differently from one that has to lay text out.
 */
import { FlashList } from '@shopify/flash-list'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'

import '../src/spike/unistyles'

const ROWS = Array.from({ length: 2000 }, (_, i) => ({
  id: i,
  title: `Song ${i}`,
  artist: `Artist ${i % 97}`,
}))

export default function SpikeList() {
  return (
    <View style={styles.page} testID="spike-list-page">
      <FlashList
        testID="spike-list"
        data={ROWS}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={styles.row} testID={`row-${item.id}`}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.artist}>{item.artist}</Text>
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create((theme) => ({
  page: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  row: {
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: theme.gap(4),
    backgroundColor: theme.colors.surface,
  },
  title: {
    color: theme.colors.text,
    fontSize: 15,
  },
  artist: {
    color: theme.colors.text,
    fontSize: 12,
    opacity: 0.6,
  },
}))
