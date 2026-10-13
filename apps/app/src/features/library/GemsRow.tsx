import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { plural, artistOr, formatRelative, type Song } from '@selfmp3/shared'
import { space, type, useGems, radius } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { prefs } from '../../ports/prefs'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Press } from '../../ui/components/Press'
import { SectionHead } from '../../ui/components/SectionHead'
import { Shelf, SongCard } from '../../ui/components/Shelf'
import { Play } from '../../ui/components/Icons'
import { card } from '../../ui/surfaces'
import { tip } from '../../ui/tip'
import { GEMS_SOURCE } from '../lists/lists.model'

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
  const player = usePlayerCommands()
  const [collapsed, setCollapsedState] = useState(() => prefs.get(COLLAPSED_KEY) === 'true')

  const data = gems.data
  if (gems.isError || !data || data.songs.length === 0) return null

  const ids = data.songs.map(song => song.id)
  const play = (index: number): void => player.playFrom(ids, index, { source: GEMS_SOURCE })
  const when = (song: Song): string =>
    song.lastPlayedAt ? formatRelative(song.lastPlayedAt) : 'never played'
  // A shelf of posters suits a dozen songs, not one: below four, the cards lie
  // down and share the width instead.
  const few = data.songs.length <= 3
  const setCollapsed = (next: boolean): void => {
    setCollapsedState(next)
    prefs.set(COLLAPSED_KEY, String(next))
  }

  return (
    <View style={styles.row} accessibilityLabel="Forgotten gems">
      <SectionHead
        title="Forgotten gems"
        aside={`${plural(data.total, 'song', 'songs')} you liked but haven’t played in ${data.minDays}+ days`}
        collapsible={{ collapsed, onToggle: () => setCollapsed(!collapsed) }}
        end={
          collapsed ? null : (
            <>
              <Button
                label="Play all"
                icon={<Play color={theme.colors.textPrimary} />}
                onPress={() => play(0)}
              />
              <Button label="Add to Up next" onPress={() => player.addToQueue(ids)} />
            </>
          )
        }
      />

      {collapsed ? null : few ? (
        <View style={styles.listFew}>
          {data.songs.map((song, index) => (
            <FewCard key={song.id} song={song} when={when(song)} onPress={() => play(index)} />
          ))}
        </View>
      ) : (
        <Shelf contentStyle={styles.list}>
          {data.songs.map((song, index) => (
            <SongCard
              key={song.id}
              song={song}
              size={72}
              more={when(song)}
              onPress={() => play(index)}
            />
          ))}
        </Shelf>
      )}
    </View>
  )
}

/** One of three or fewer: lying down, its words beside its cover, sharing the row's width. */
function FewCard({
  song,
  when,
  onPress,
}: {
  song: Song
  when: string
  onPress: () => void
}): ReactNode {
  const artFor = useArt(ROW_COVER_SIZE)
  const artist = artistOr(song.artist)
  return (
    <Press
      wrap={styles.cardFewWrap}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${song.title} by ${artist}`}
      {...tip(`${song.title} — ${artist}`)}
      style={styles.cardFew}
    >
      <Cover uri={artFor(song)} title={song.album || song.title} size={44} />
      <View style={styles.cardTextFew}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.cardArtist} numberOfLines={1}>
          {artist}
        </Text>
        <Text style={styles.cardWhen} numberOfLines={1}>
          {when}
        </Text>
      </View>
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  row: {
    marginHorizontal: space.lg,
    marginBottom: space.lg,
    paddingVertical: space.snug,
    paddingHorizontal: space.md,
    ...card(theme.colors),
  },
  list: { marginTop: space.snug, paddingBottom: space.xs },
  listFew: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.snug },
  // Grows in the row's wrap; the card fills what its wrap is given.
  cardFewWrap: { flexGrow: 1, flexBasis: 200, maxWidth: 340 },
  cardFew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    padding: space.tight,
    borderRadius: radius.item,
    backgroundColor: theme.colors.surface2,
  },
  cardTextFew: { flex: 1, minWidth: 0, gap: 1 },
  cardTitle: { color: theme.colors.textPrimary, fontSize: type.small, fontWeight: '600' },
  cardArtist: { color: theme.colors.textSecondary, fontSize: type.tiny },
  cardWhen: { color: theme.colors.textMuted, fontSize: type.tiny },
}))
