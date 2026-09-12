import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { type Song } from '@selfmp3/shared'
import { useToggleLoved } from '../../api/queries'
import { useArt } from '../../offline/useArt'
import { isDownloaded, colors, HIT_TARGET, radius, space, type } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { ChevronDown, Downloaded, Play, Search, Shuffle, X } from '../../ui/components/Icons'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { SongMenu } from '../../ui/components/SongMenu'
import { SongRow } from '../../ui/components/SongRow'
import { SyncStatus } from '../../ui/components/SyncStatus'
import { useLibraryModel } from './library.model'

/**
 * The library: the web's phone layout, on the phone.
 *
 * The header is the web's `.view-head`: the title and a count, the search on
 * a line of its own, then order and play sharing the next. Under it the tag
 * strip, which is the sidebar's tag list folded into a row. All of the
 * filtering runs over the full in-memory list, exactly as on the web — the
 * whole library arrives in one response, so a keystroke costs one pass over
 * an array and no round trip.
 */
export function LibraryScreen(): ReactNode {
  const accent = useAccent()
  const player = usePlayer()
  const toggleLoved = useToggleLoved()
  const { state: downloads } = useDownloads()

  // Everything this screen knows is in the model, which draws nothing and is
  // tested without a simulator. What is left here is drawing.
  const model = useLibraryModel(downloads.index)
  const { filter, songs, visible, songIds, tags, heading, sortLabel } = model

  const [sortOpen, setSortOpen] = useState(false)
  const [menuSong, setMenuSong] = useState<Song | null>(null)

  const downloaded = useCallback(
    (songId: number) => isDownloaded(downloads.index, songId),
    [downloads.index],
  )

  const artFor = useArt()
  const currentId = player.current?.id ?? null
  const playing = player.isPlaying

  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow
        testID={`song-row-${index}`}
        song={item}
        artUri={artFor(item)}
        active={currentId === item.id}
        playing={playing}
        downloaded={downloaded(item.id)}
        onPress={() => player.playFrom(songIds, index)}
        onMore={() => setMenuSong(item)}
        onToggleLoved={() => toggleLoved.mutate({ id: item.id, loved: !item.loved })}
      />
    ),
    [artFor, currentId, playing, songIds, downloaded, player, toggleLoved],
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']} testID="library-screen">
      <View style={styles.head}>
        <Text style={styles.heading} numberOfLines={1}>
          {heading}
        </Text>
        <Text style={styles.sub}>{model.subtitle}</Text>

        <View style={styles.searchBox}>
          <Search size={15} color={colors.textMuted} />
          <TextInput
            style={styles.search}
            value={filter.query}
            onChangeText={model.setQuery}
            placeholder="Search"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search library"
          />
          {filter.query ? (
            <Pressable
              onPress={model.clearQuery}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <X size={13} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.sortButton, pressed && styles.sortButtonPressed]}
            onPress={() => setSortOpen(true)}
            testID="library-sort"
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${sortLabel}`}
          >
            <Text style={styles.sortLabel} numberOfLines={1}>
              {sortLabel}
            </Text>
            <ChevronDown size={15} color={colors.textMuted} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.direction, pressed && styles.sortButtonPressed]}
            onPress={model.toggleDirection}
            accessibilityRole="button"
            accessibilityLabel={filter.descending ? 'Sort ascending' : 'Sort descending'}
          >
            <Text style={styles.directionArrow}>{filter.descending ? '↓' : '↑'}</Text>
          </Pressable>

          <View style={styles.transport}>
            <Button
              label="Play"
              icon={<Play size={15} color={colors.onAccent} />}
              variant="primary"
              disabled={visible.length === 0}
              onPress={() => player.playFrom(songIds, 0, false)}
            />
            <Button
              icon={<Shuffle size={15} color={colors.textPrimary} />}
              disabled={visible.length === 0}
              onPress={() => player.playShuffled(songIds)}
            />
          </View>
        </View>
      </View>

      {tags.length > 0 || songs.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tagStripFrame}
          contentContainerStyle={styles.tagStrip}
          keyboardShouldPersistTaps="handled"
        >
          <Chip
            label="On this phone"
            selected={filter.downloadedOnly}
            icon={
              <Downloaded
                size={12}
                color={filter.downloadedOnly ? colors.textPrimary : colors.textSecondary}
                knockout={colors.surface1}
              />
            }
            onPress={model.toggleDownloadedOnly}
          />
          {tags.map((tag, index) => (
            <Chip
              key={tag.id}
              testID={`tag-chip-${index}`}
              label={tag.name}
              hue={tag.hue}
              selected={filter.tagId === tag.id}
              onPress={() => model.toggleTag(tag.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      <SyncStatus songs={songs} />

      {model.loading ? (
        <ActivityIndicator style={styles.spinner} color={accent.accent} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={song => String(song.id)}
          renderItem={renderSong}
          initialNumToRender={16}
          windowSize={11}
          removeClippedSubviews
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>{EMPTY_TEXT[model.emptyReason ?? 'no-matches']}</Text>
          }
        />
      )}

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        {model.sortOptions.map(option => (
          <SheetItem
            key={option.field}
            label={option.label}
            active={filter.sort === option.field}
            onPress={() => {
              model.setSort(option.field)
              setSortOpen(false)
            }}
          />
        ))}
      </Sheet>

      <SongMenu song={menuSong} onClose={() => setMenuSong(null)} />
    </SafeAreaView>
  )
}

/**
 * One sentence per reason the list is empty. The model decides which; this only
 * knows how to say it.
 */
const EMPTY_TEXT = {
  unreachable: 'Could not reach the server, and nothing is cached yet.',
  'no-library': 'Nothing here yet. Import a song on the Mac and it turns up here.',
  'no-matches': 'Nothing matches.',
} as const

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  head: {
    paddingHorizontal: space.lg,
    paddingTop: 18,
    gap: space.md,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sub: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: -space.sm - 1,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingLeft: 10,
    paddingRight: 10,
    minHeight: HIT_TARGET,
  },
  search: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: type.body,
    paddingVertical: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  sortButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    minHeight: HIT_TARGET,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  sortButtonPressed: {
    backgroundColor: colors.surface3,
  },
  sortLabel: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  direction: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  directionArrow: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 20,
  },
  transport: {
    flexDirection: 'row',
    gap: space.sm,
  },
  // A ScrollView shrinks like anything else in a column; next to a list that
  // takes all the room it was squeezed to nothing, and the chips with it.
  tagStripFrame: {
    flexGrow: 0,
    flexShrink: 0,
  },
  tagStrip: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  list: {
    paddingTop: space.xs,
    paddingBottom: space.md,
  },
  spinner: {
    marginTop: space.xl,
  },
  empty: {
    color: colors.textMuted,
    fontSize: type.body,
    textAlign: 'center',
    marginTop: space.xl,
    paddingHorizontal: space.xl,
    lineHeight: 20,
  },
})
