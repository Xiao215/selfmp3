import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { formatRelative } from '@selfmp3/shared'
import { space, useGems } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { usePlayer } from '../../player/PlayerProvider'
import { prefs } from '../../ports/prefs'
import { useLayout } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { ChevronDown, ChevronRight, Play } from '../../ui/components/Icons'
import { card, sectionTitle } from '../../ui/surfaces'
import { tip } from '../../ui/tip'

const COLLAPSED_KEY = 'gems.collapsed'

/**
 * Forgotten gems.
 *
 * Songs you loved or wore out that have not come up in months. The server
 * re-ranks them with a little randomness on every request, so it is a
 * different handful each time the library is opened rather than the same
 * reproach every day. It hides itself when there is nothing to show — or
 * the server cannot be reached — because an error box above the library would
 * be worse than no row at all.
 */
export function GemsRow(): ReactNode {
  const { theme } = useUnistyles()
  const gems = useGems(12)
  const player = usePlayer()
  const artFor = useArt(ROW_COVER_SIZE)
  const { wide } = useLayout()
  const [collapsed, setCollapsedState] = useState(() => prefs.get(COLLAPSED_KEY) === 'true')

  const data = gems.data
  if (gems.isError || !data || data.songs.length === 0) return null

  const ids = data.songs.map(song => song.id)
  // A shelf of posters suits a dozen songs, not one: below four, the cards lie
  // down and share the width instead.
  const few = data.songs.length <= 3
  const setCollapsed = (next: boolean): void => {
    setCollapsedState(next)
    prefs.set(COLLAPSED_KEY, String(next))
  }

  const cards = data.songs.map((song, index) => (
    <Pressable
      key={song.id}
      onPress={() => player.playFrom(ids, index)}
      accessibilityRole="button"
      accessibilityLabel={`${song.title} — ${song.artist || 'Unknown artist'}`}
      {...tip(`${song.title} — ${song.artist || 'Unknown artist'}`)}
      style={({ pressed }) => [
        few ? styles.cardFew : styles.card,
        pressed && (few ? styles.cardFewPressed : styles.cardPressed),
      ]}
    >
      <Cover uri={artFor(song)} title={song.album || song.title} size={few ? 44 : 64} />
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, few && styles.cardTitleFew]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.cardArtist} numberOfLines={1}>
          {song.artist || 'Unknown artist'}
        </Text>
        <Text style={styles.cardWhen} numberOfLines={1}>
          {song.lastPlayedAt ? formatRelative(song.lastPlayedAt) : 'never played'}
        </Text>
      </View>
    </Pressable>
  ))

  return (
    <View style={styles.row} accessibilityLabel="Forgotten gems">
      <View style={[styles.head, !wide && styles.headStacked]}>
        <Pressable
          onPress={() => setCollapsed(!collapsed)}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          style={styles.title}
        >
          {collapsed ? (
            <ChevronRight size={15} color={theme.colors.textMuted} />
          ) : (
            <ChevronDown size={15} color={theme.colors.textMuted} />
          )}
          <Text style={styles.titleLabel}>Forgotten gems</Text>
          <Text style={styles.hint} numberOfLines={1}>
            {data.total} {data.total === 1 ? 'song' : 'songs'} you liked, unplayed for{' '}
            {data.minDays}+ days
          </Text>
        </Pressable>
        {collapsed ? null : (
          <View style={styles.actions}>
            <Button
              label="Play all"
              icon={<Play size={13} color={theme.colors.textPrimary} />}
              onPress={() => player.playFrom(ids, 0)}
            />
            <Button label="Add to queue" onPress={() => player.addToQueue(ids)} />
          </View>
        )}
      </View>

      {collapsed ? null : few ? (
        <View style={styles.listFew}>{cards}</View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
        >
          {cards}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  row: {
    marginHorizontal: space.lg,
    marginBottom: space.lg,
    paddingVertical: 10,
    paddingHorizontal: 12,
    ...card(theme.colors),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  headStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 1 },
  titleLabel: sectionTitle(theme.colors),
  hint: { color: theme.colors.textMuted, fontSize: 12, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  list: { gap: 10, marginTop: 10, paddingBottom: 4 },
  listFew: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  card: { width: 92, padding: 4, gap: 3, borderRadius: 12 },
  cardPressed: { backgroundColor: theme.colors.surface2 },
  cardFew: {
    flexGrow: 1,
    flexBasis: 200,
    maxWidth: 340,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 6,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
  },
  cardFewPressed: { backgroundColor: theme.colors.surface3 },
  cardText: { flex: 1, minWidth: 0, gap: 1 },
  cardTitle: { color: theme.colors.textPrimary, fontSize: 11, fontWeight: '600', marginTop: 3 },
  cardTitleFew: { fontSize: 12, marginTop: 0 },
  cardArtist: { color: theme.colors.textSecondary, fontSize: 11 },
  cardWhen: { color: theme.colors.textMuted, fontSize: 10 },
}))
