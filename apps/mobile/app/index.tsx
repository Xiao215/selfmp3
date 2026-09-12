import { useCallback, useMemo, useState } from 'react'
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
import { formatLongDuration, type Song } from '@selfmp3/shared'
import { useLibrary, useToggleLoved } from '../src/api/queries'
import { useArt } from '../src/offline/useArt'
import { DEFAULT_FILTER, filterSongs, SORT_OPTIONS, usedTags } from '../src/lib/library'
import { isDownloaded } from '@selfmp3/client'
import { useDownloads } from '../src/offline/DownloadsProvider'
import { usePlayer } from '../src/player/PlayerProvider'
import { useAccent } from '../src/ui/accent'
import { Button } from '../src/ui/components/Button'
import { Chip } from '../src/ui/components/Chip'
import { ChevronDown, Downloaded, Play, Search, Shuffle, X } from '../src/ui/components/Icons'
import { Sheet, SheetItem } from '../src/ui/components/Sheet'
import { SongMenu } from '../src/ui/components/SongMenu'
import { SongRow } from '../src/ui/components/SongRow'
import { SyncStatus } from '../src/ui/components/SyncStatus'
import { colors, HIT_TARGET, radius, space, type } from '../src/ui/theme'

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
export default function LibraryScreen(): ReactNode {
  const accent = useAccent()
  const library = useLibrary()
  const player = usePlayer()
  const toggleLoved = useToggleLoved()
  const { state: downloads } = useDownloads()

  const [filter, setFilter] = useState(DEFAULT_FILTER)
  const [sortOpen, setSortOpen] = useState(false)
  const [menuSong, setMenuSong] = useState<Song | null>(null)

  const songs = useMemo(() => library.data?.songs ?? [], [library.data])
  const tags = useMemo(() => usedTags(songs, library.data?.tags ?? []), [songs, library.data])

  const downloaded = useCallback(
    (songId: number) => isDownloaded(downloads.index, songId),
    [downloads.index],
  )

  const visible = useMemo(() => filterSongs(songs, filter, downloaded), [songs, filter, downloaded])
  const songIds = useMemo(() => visible.map(song => song.id), [visible])
  const totalSeconds = useMemo(
    () => visible.reduce((sum, song) => sum + song.duration, 0),
    [visible],
  )

  const artFor = useArt()
  const currentId = player.current?.id ?? null
  const playing = player.isPlaying

  const filteredTag = filter.tagId === null ? null : tags.find(tag => tag.id === filter.tagId)
  const heading = filteredTag?.name ?? 'Library'
  const sortLabel = SORT_OPTIONS.find(option => option.field === filter.sort)?.label ?? 'Sort'

  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow
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
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.heading} numberOfLines={1}>
          {heading}
        </Text>
        <Text style={styles.sub}>
          {library.isPending
            ? 'Loading…'
            : `${visible.length} ${visible.length === 1 ? 'song' : 'songs'} · ${formatLongDuration(totalSeconds)}`}
        </Text>

        <View style={styles.searchBox}>
          <Search size={15} color={colors.textMuted} />
          <TextInput
            style={styles.search}
            value={filter.query}
            onChangeText={query => setFilter(current => ({ ...current, query }))}
            placeholder="Search"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search library"
          />
          {filter.query ? (
            <Pressable
              onPress={() => setFilter(current => ({ ...current, query: '' }))}
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
            onPress={() => setFilter(current => ({ ...current, descending: !current.descending }))}
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
            onPress={() =>
              setFilter(current => ({ ...current, downloadedOnly: !current.downloadedOnly }))
            }
          />
          {tags.map(tag => (
            <Chip
              key={tag.id}
              label={tag.name}
              hue={tag.hue}
              selected={filter.tagId === tag.id}
              onPress={() =>
                setFilter(current => ({
                  ...current,
                  tagId: current.tagId === tag.id ? null : tag.id,
                }))
              }
            />
          ))}
        </ScrollView>
      ) : null}

      <SyncStatus songs={songs} />

      {library.isPending ? (
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
            <Text style={styles.empty}>
              {library.isError
                ? 'Could not reach the server, and nothing is cached yet.'
                : songs.length === 0
                  ? 'Nothing here yet. Import a song on the Mac and it turns up here.'
                  : 'Nothing matches.'}
            </Text>
          }
        />
      )}

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        {SORT_OPTIONS.map(option => (
          <SheetItem
            key={option.field}
            label={option.label}
            active={filter.sort === option.field}
            onPress={() => {
              setFilter(current => ({ ...current, sort: option.field }))
              setSortOpen(false)
            }}
          />
        ))}
      </Sheet>

      <SongMenu song={menuSong} onClose={() => setMenuSong(null)} />
    </SafeAreaView>
  )
}

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
