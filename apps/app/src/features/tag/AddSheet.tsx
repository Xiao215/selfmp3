import { useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { libraryArtists } from '@selfmp3/shared'
import { radius, tagColors, useLibrary } from '@selfmp3/client'
import { useRecentTagIds } from '../library/recentTags.store'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Chip } from '../../ui/components/Chip'
import { Search, User } from '../../ui/components/Icons'
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

/**
 * Add (docs/ui-mock `P09`): the sheet that combines tags and artists.
 *
 * What is chosen sits on one row that scrolls sideways; under it a Tags and an
 * Artists list, searchable together; the song count is on the button and
 * nowhere else. Every tag or artist turned on **adds** its songs. The lists
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
}: {
  open: boolean
  chosen: readonly Place[]
  onClose: () => void
  onShow: (places: readonly Place[]) => void
}): ReactNode {
  // Mounted fresh each opening, so the copy starts from what the page shows.
  return (
    <Sheet open={open} onClose={onClose} title="Add to this" width={520} testID="add-sheet">
      {open ? <AddSheetBody chosen={chosen} onShow={onShow} /> : null}
    </Sheet>
  )
}

function AddSheetBody({
  chosen,
  onShow,
}: {
  chosen: readonly Place[]
  onShow: (places: readonly Place[]) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const window = useWindowDimensions()
  const { data: library } = useLibrary()
  const recentTagIds = useRecentTagIds()
  const [draft, setDraft] = useState<readonly Place[]>(chosen)
  const [query, setQuery] = useState('')
  const [list, setList] = useState<'tags' | 'artists'>('tags')

  const songs = useMemo(() => library?.songs ?? [], [library])
  const tags = useMemo(() => library?.tags ?? [], [library])
  const artists = useMemo(() => libraryArtists(songs), [songs])
  const rows = useMemo(
    () => addSheetRows({ query, tags, artists, recentTagIds, list }),
    [query, tags, artists, recentTagIds, list],
  )
  const onKeys = useMemo(() => new Set(draft.map(placeKey)), [draft])
  const count = useMemo(() => placeSongs(draft, songs).length, [draft, songs])

  const renderRow = ({ item }: { item: AddRow }): ReactElement => {
    if (item.kind === 'heading') return <Text style={styles.heading}>{item.title}</Text>
    const place = item.place
    const on = onKeys.has(placeKey(place))
    return (
      <Pressable
        onPress={() => setDraft(current => togglePlace(current, place))}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        aria-checked={on}
        accessibilityLabel={`${placeName(place)}, ${placeSize(place)} songs`}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.mark}>
          {place.kind === 'tag' ? (
            <View style={[styles.dot, { backgroundColor: tagColors(place.tag.hue).dot }]} />
          ) : (
            <User size={14} tone="textSecondary" />
          )}
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {placeName(place)}
        </Text>
        <Text style={styles.size}>{placeSize(place)}</Text>
        <Checkbox checked={on} />
      </Pressable>
    )
  }

  return (
    <View style={styles.body}>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Search size={17} color={theme.colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${plural(tags.length, 'tag')} and ${plural(artists.length, 'artist')}`}
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search tags and artists"
            testID="add-sheet-search"
            style={styles.input}
          />
        </View>
        {draft.length > 0 ? (
          <Pressable onPress={() => setDraft([])} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.clear, { color: accent.accent }]}>Clear all</Text>
          </Pressable>
        ) : null}
      </View>

      {draft.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chosen}
          style={styles.chosenRow}
        >
          {draft.map(place => (
            <Chip
              key={placeKey(place)}
              label={placeName(place)}
              hue={place.kind === 'tag' ? place.tag.hue : undefined}
              icon={place.kind === 'artist' ? <User size={12} tone="onPrimary" /> : undefined}
              selected
              compact
              onPress={() => setDraft(current => togglePlace(current, place))}
              onRemove={() => setDraft(current => togglePlace(current, place))}
            />
          ))}
        </ScrollView>
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
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        style={{ height: Math.min(420, window.height * 0.45) }}
        ListEmptyComponent={<Text style={styles.empty}>Nothing matches “{query.trim()}”.</Text>}
      />

      <View style={styles.foot}>
        <Button
          variant="primary"
          grow
          label={count === 1 ? 'Show 1 song' : `Show ${count} songs`}
          disabled={draft.length === 0}
          onPress={() => onShow(draft)}
          testID="add-sheet-show"
        />
      </View>
    </View>
  )
}

/** "1 tag", "46 tags". */
function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`
}

const styles = StyleSheet.create(theme => ({
  body: { gap: 10, paddingBottom: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  search: {
    flex: 1,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface3,
  },
  input: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: 15 },
  clear: { fontSize: 14, fontWeight: '600' },
  chosenRow: { flexGrow: 0 },
  chosen: { gap: 8, paddingHorizontal: 16 },
  segment: { paddingHorizontal: 16 },
  heading: { ...labelText(theme.colors), paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, color: theme.colors.textPrimary, fontSize: 15, fontWeight: '500' },
  size: { color: theme.colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  empty: { color: theme.colors.textSecondary, fontSize: 14, padding: 16 },
  foot: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 6 },
}))
