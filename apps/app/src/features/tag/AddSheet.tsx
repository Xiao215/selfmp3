import { useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Text, useWindowDimensions, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { plural, libraryArtists } from '@selfmp3/shared'
import { type, useLibrary, space } from '@selfmp3/client'
import { useRecentTagIds } from '../library/recentTags.store'
import { songsById } from '../../ui/songsById'
import { ArtistFace } from './ArtistFace'
import { Button } from '../../ui/components/Button'
import { Checkbox, CheckRow, TagCheck } from '../../ui/components/Checkbox'
import { Chip } from '../../ui/components/Chip'
import { User } from '../../ui/components/Icons'
import { Segmented } from '../../ui/components/Segmented'
import { Sheet } from '../../ui/components/Sheet'
import { label as labelText } from '../../ui/surfaces'
import {
  addSheetRows,
  placeKey,
  placeName,
  placeSize,
  placeSongs,
  togglePlace,
  type AddRow,
  type Place,
} from './tag.model'
import { EmptyState } from '../../ui/components/EmptyState'
import { SearchField } from '../../ui/components/SearchField'
import { FlatList } from '../../ui/components/Scroll'
import { SideScroll } from '../../ui/components/Shelf'

/**
 * Combine with… (docs/ui-mock `P09`, docs/features/lists.md): the sheet that
 * puts tags and artists together.
 *
 * What is chosen sits on one row that scrolls sideways; under it a Tags and an
 * Artists list, searchable together; the song count is on the button and
 * nowhere else. Every tag or artist turned on **adds** its songs — or, on a
 * combination switched to All, narrows them, and the count says so. The lists
 * draw only what is on screen, for a library with hundreds of tags.
 *
 * Nothing changes on the page until the button is pressed: the sheet works on
 * a copy, so closing it leaves the page as it was.
 */
export function AddSheet({
  open,
  chosen,
  onClose,
  onShow,
  match = 'any',
}: {
  open: boolean
  chosen: readonly Place[]
  onClose: () => void
  onShow: (places: readonly Place[]) => void
  /** What the page it opened from counts: songs any of them holds, or all. */
  match?: 'any' | 'all'
}): ReactNode {
  // Mounted fresh each opening, so the copy starts from what the page shows.
  return (
    <Sheet open={open} onClose={onClose} title="Combine with…" width={520} testID="add-sheet">
      {open ? <AddSheetBody chosen={chosen} onShow={onShow} match={match} /> : null}
    </Sheet>
  )
}

function AddSheetBody({
  chosen,
  onShow,
  match,
}: {
  chosen: readonly Place[]
  onShow: (places: readonly Place[]) => void
  match: 'any' | 'all'
}): ReactNode {
  const window = useWindowDimensions()
  const { data: library } = useLibrary()
  const recentTagIds = useRecentTagIds()
  const [draft, setDraft] = useState<readonly Place[]>(chosen)
  const [query, setQuery] = useState('')
  const [list, setList] = useState<'tags' | 'artists'>('tags')

  const songs = useMemo(() => library?.songs ?? [], [library])
  const tags = useMemo(() => library?.tags ?? [], [library])
  const artists = useMemo(() => libraryArtists(songs), [songs])
  // Each artist's first song with a cover: their face until the picture comes.
  const leads = useMemo(() => {
    const byId = songsById(songs)
    return new Map(
      artists.map(artist => {
        const own = artist.songIds.flatMap(id => byId.get(id) ?? [])
        return [artist.key, own.find(song => song.hasArt) ?? own[0] ?? null]
      }),
    )
  }, [songs, artists])
  const rows = useMemo(
    () => addSheetRows({ query, tags, artists, recentTagIds, list }),
    [query, tags, artists, recentTagIds, list],
  )
  const onKeys = useMemo(() => new Set(draft.map(placeKey)), [draft])
  const count = useMemo(() => placeSongs(draft, songs, match).length, [draft, songs, match])

  const renderRow = ({ item }: { item: AddRow }): ReactElement => {
    if (item.kind === 'heading') return <Text style={styles.heading}>{item.title}</Text>
    const place = item.place
    const on = onKeys.has(placeKey(place))
    return (
      <CheckRow
        checked={on}
        onPress={() => setDraft(current => togglePlace(current, place))}
        label={`${placeName(place)}, ${plural(placeSize(place), 'song', 'songs')}`}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        {/* A tag's ring is its tick (one mark a row); an artist's face is a
            picture, so the artist keeps a checkbox at the end. */}
        {place.kind === 'tag' ? (
          <View style={styles.mark}>
            <TagCheck hue={place.tag.hue} checked={on} />
          </View>
        ) : (
          <ArtistFace
            artist={place.artist}
            lead={leads.get(place.artist.key) ?? null}
            size={FACE}
          />
        )}
        <Text style={[styles.name, on && styles.nameOn]} numberOfLines={1}>
          {placeName(place)}
        </Text>
        <Text style={styles.size}>{placeSize(place)}</Text>
        {place.kind === 'artist' ? <Checkbox checked={on} /> : null}
      </CheckRow>
    )
  }

  return (
    <View style={styles.body}>
      <View style={styles.searchRow}>
        <SearchField
          raised
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${plural(tags.length, 'tag', 'tags')} and ${plural(artists.length, 'artist', 'artists')}`}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search tags and artists"
          testID="add-sheet-search"
          style={styles.search}
        />
        {draft.length > 0 ? (
          <Button size="small" variant="text" label="Clear all" onPress={() => setDraft([])} />
        ) : null}
      </View>

      {draft.length > 0 ? (
        <SideScroll contentStyle={styles.chosen} style={styles.chosenRow}>
          {draft.map(place => (
            <Chip
              key={placeKey(place)}
              label={placeName(place)}
              hue={place.kind === 'tag' ? place.tag.hue : undefined}
              icon={place.kind === 'artist' ? <User tone="onPrimary" /> : undefined}
              selected
              compact
              onPress={() => setDraft(current => togglePlace(current, place))}
              onRemove={() => setDraft(current => togglePlace(current, place))}
              removeLabel={place.kind === 'artist' ? `Remove ${placeName(place)}` : undefined}
            />
          ))}
        </SideScroll>
      ) : null}

      <View style={styles.segment}>
        <Segmented
          label="Tags or artists"
          value={list}
          onChange={setList}
          options={[
            { value: 'tags', label: `Tags · ${tags.length}` },
            { value: 'artists', label: `Artists · ${artists.length}` },
          ]}
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item, index) =>
          item.kind === 'heading' ? `heading-${index}` : placeKey(item.place)
        }
        renderItem={renderRow}
        initialNumToRender={20}
        style={{ height: Math.min(420, window.height * 0.45) }}
        ListEmptyComponent={
          <EmptyState
            compact
            title={
              query.trim()
                ? `Nothing matches “${query.trim()}”`
                : list === 'tags'
                  ? 'No tags yet'
                  : 'No artists yet'
            }
          />
        }
      />

      <View style={styles.foot}>
        <Button
          variant="primary"
          grow
          label={`Show ${plural(count, 'song', 'songs')}`}
          disabled={draft.length === 0}
          onPress={() => onShow(draft)}
          testID="add-sheet-show"
        />
      </View>
    </View>
  )
}

/** A row's mark: the room a tag's ring sits in, or an artist's face. */
const FACE = 32

const styles = StyleSheet.create(theme => ({
  body: { gap: space.snug, paddingBottom: space.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  search: { flex: 1 },
  chosenRow: { flexGrow: 0 },
  chosen: { gap: space.sm, paddingHorizontal: space.lg },
  segment: { paddingHorizontal: space.lg },
  heading: {
    ...labelText(theme.colors),
    paddingHorizontal: space.lg,
    paddingTop: space.snug,
    paddingBottom: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.lg,
  },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  mark: { width: FACE, height: FACE, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '500' },
  nameOn: { fontWeight: '700' },
  size: { color: theme.colors.textMuted, fontSize: type.sub, fontVariant: ['tabular-nums'] },
  foot: { flexDirection: 'row', paddingHorizontal: space.lg, paddingTop: space.tight },
}))
