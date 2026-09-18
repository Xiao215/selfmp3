import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { TAG_NAME_MAX, type Tag } from '@selfmp3/shared'
import {
  HIT_TARGET,
  oklchToHexAlpha,
  radius,
  space,
  tagSelected,
  toggleTag,
  type,
  useCreateTag,
  useLibrary,
} from '@selfmp3/client'
import { useRouter } from 'expo-router'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { BackToYou } from '../../ui/components/BackToYou'
import { Button } from '../../ui/components/Button'
import { Plus, Search, X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { TagEditor } from '../../ui/components/TagEditor'
import { useLibraryFilter } from '../library/libraryFilter'
import { noteTagUsed } from '../library/recentTags.store'
import { openTagSearch } from '../library/tagSearch.store'
import { existingTag, songCount, tagsHeadline, tagsToManage } from './tags.model'

/**
 * Tags, as a page: reached from You on a phone.
 *
 * **Housekeeping, not listening.** This page used to be a second tag picker —
 * tap tags, and a bar along the foot said what they came to and played it —
 * and it was the wrong place for it twice over. It was buried under You, two
 * taps from anywhere, for the feature the whole library is browsed by; and
 * picking tags there showed you no songs, only a count you had to tap to be
 * taken somewhere else. The library's picker, which is on the Library screen
 * at both widths, shows the songs under the chips as they are chosen, so that
 * is now the only place tags are picked and this page does the one thing a
 * phone had nowhere else for: naming, colouring, deleting and making tags.
 *
 * Which is also why it is a list of rows rather than a cloud of chips. Chips
 * are the app's word for "tags you are choosing between"; rows say this is a
 * list of things you own and can change, and they have room for a count and
 * the way in to the editor.
 */
export function TagsScreen(): ReactNode {
  const { theme } = useUnistyles()
  const { wide } = useLayout()
  const accent = useAccent()
  const router = useRouter()
  const { data: library } = useLibrary()
  const [filter, setFilter] = useLibraryFilter()
  const createTag = useCreateTag()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [nameFocused, setNameFocused] = useState(false)
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [editing, setEditing] = useState<Tag | null>(null)
  const editorAnchor = useRef<View>(null)

  const tags = useMemo<readonly Tag[]>(() => library?.tags ?? [], [library?.tags])
  const listed = useMemo(() => tagsToManage(tags, query), [tags, query])
  // A search box for nine tags is furniture; for two hundred it is the only
  // way to find one.
  const searchable = tags.length > SEARCH_FROM

  /** Listen to a tag: the library is where that happens, so go there. */
  const listen = useCallback(
    (tagId: number) => {
      const turningOn = !tagSelected(filter, tagId)
      if (turningOn) noteTagUsed(tagId)
      setFilter(current => toggleTag(current, tagId))
      if (turningOn) router.navigate('/')
    },
    [filter, setFilter, router],
  )

  const trimmed = name.trim()
  const submit = async (): Promise<void> => {
    if (!trimmed) return
    // Choosing the tag that exists beats silently making a twin of it.
    const already = existingTag(tags, trimmed)
    if (already) {
      setName('')
      setEditing(already)
      return
    }
    if (!(await createTag.mutateAsync(trimmed).catch(() => null))) return
    // The field stays open and empty: tags arrive in handfuls, and a second
    // one should not cost another trip to the ＋.
    setName('')
  }

  const closeAdding = (): void => {
    setAdding(false)
    setName('')
    createTag.reset()
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']} testID="tags-screen">
      <View style={[styles.head, wide ? styles.headWide : styles.headNarrow]}>
        <BackToYou />
        <View style={styles.headRow}>
          <View style={styles.titles}>
            <Text
              style={[styles.heading, !wide && styles.headingNarrow]}
              accessibilityRole="header"
            >
              Tags
            </Text>
            <Text style={styles.sub}>{tagsHeadline(tags.length)} · rename, recolour, delete</Text>
          </View>
          <Button
            label="New tag"
            icon={<Plus size={14} color={theme.colors.textPrimary} />}
            accessibilityLabel="New tag"
            active={adding}
            onPress={() => (adding ? closeAdding() : setAdding(true))}
            testID="tags-new"
          />
        </View>

        {/*
          Making a tag, in the page. It was a bare field and a blue Add sitting
          above the picker at a width of their own, lined up with nothing; this
          is the card the rest of the app makes things in — a label, a field
          that shows its focus the way every other field does, and the button
          that does it beside it, disabled until there is a name to give.
        */}
        {adding ? (
          <View style={styles.newCard} testID="tags-new-form">
            <View style={styles.newHeadRow}>
              <Text style={styles.fieldLabel}>New tag</Text>
              <Pressable
                onPress={closeAdding}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close new tag"
              >
                <X size={14} color={theme.colors.textMuted} />
              </Pressable>
            </View>
            <View style={styles.newRow}>
              <TextInput
                style={[styles.input, nameFocused && { borderColor: accent.accent }]}
                value={name}
                onChangeText={text => {
                  setName(text)
                  createTag.reset()
                }}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
                onSubmitEditing={() => void submit()}
                placeholder="chill, 中文, gym…"
                placeholderTextColor={theme.colors.textMuted}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                // Enter makes the tag and stays in the field: tags arrive in
                // handfuls, and dismissing the keyboard after each one costs a
                // tap to get it back.
                submitBehavior="submit"
                returnKeyType="done"
                maxLength={TAG_NAME_MAX}
                accessibilityLabel="New tag name"
                testID="tags-new-name"
              />
              <Button
                label="Create"
                variant="primary"
                disabled={trimmed.length === 0}
                busy={createTag.isPending}
                onPress={() => void submit()}
                testID="tags-create"
              />
            </View>
            {createTag.isError ? (
              <Text style={styles.error}>Couldn’t make that tag. Try a different name.</Text>
            ) : (
              <Text style={styles.newHint}>
                A tag is a word or two. Put it on songs from a song’s ⋯, or while one is playing.
              </Text>
            )}
          </View>
        ) : null}

        {searchable ? (
          <View style={[styles.searchBox, searchFocused && { borderColor: accent.accent }]}>
            <Search size={14} color={searchFocused ? accent.accent : theme.colors.textMuted} />
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder={`Search ${tags.length} tags`}
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search tags"
              testID="tags-search"
            />
            {query.trim() ? (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear tag search"
              >
                <X size={13} color={theme.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {/*
        The way to the other thing anyone comes here for. Picking tags lives on
        the Library, so this hands the job over rather than growing a second
        picker: the library opens with its picker already down.
      */}
      <Pressable
        onPress={() => {
          openTagSearch()
          router.navigate('/')
        }}
        accessibilityRole="link"
        accessibilityLabel="Pick tags to listen to, in your library"
        style={({ pressed }) => [
          styles.listenRow,
          wide ? styles.rowsWide : styles.rowsNarrow,
          pressed && { backgroundColor: theme.colors.surface2 },
        ]}
        testID="tags-pick-to-listen"
      >
        <Text style={[styles.listenLabel, { color: accent.accent }]}>Pick tags to listen to</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {!library ? (
        <Text style={styles.hint}>Tags load with your library.</Text>
      ) : tags.length === 0 ? (
        <Text style={styles.hint}>
          No tags yet. Tags are how this library is browsed — make one here, or put one on a song
          from its ⋯ while it plays.
        </Text>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={[styles.listBody, wide ? styles.rowsWide : styles.rowsNarrow]}
          keyboardShouldPersistTaps="handled"
        >
          {listed.length === 0 ? (
            <Text style={styles.hint}>No tag matches “{query.trim()}”.</Text>
          ) : (
            listed.map(tag => (
              <Pressable
                key={tag.id}
                onPress={() => setEditing(tag)}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${tag.name}, ${songCount(tag.songCount)}`}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: theme.colors.surface2 },
                ]}
                testID={`tag-row-${tag.id}`}
              >
                <View
                  style={[styles.dot, { backgroundColor: oklchToHexAlpha(0.72, 0.14, tag.hue, 1) }]}
                />
                <Text style={styles.rowName} numberOfLines={1}>
                  {tag.name}
                </Text>
                <Text style={styles.rowCount}>{songCount(tag.songCount)}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      <View ref={editorAnchor} collapsable={false} style={styles.editorAnchor} />
      <TagEditor
        tag={editing}
        anchorRef={editorAnchor}
        chosen={editing ? filter.tagIds.includes(editing.id) : false}
        onChoose={() => editing && listen(editing.id)}
        onClose={() => setEditing(null)}
      />
    </SafeAreaView>
  )
}

/** Above this many tags the page grows a search box. */
const SEARCH_FROM = 8

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  head: { gap: space.md },
  headWide: { paddingTop: 28, paddingHorizontal: 32 },
  headNarrow: { paddingTop: 18, paddingHorizontal: space.lg },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headingNarrow: { fontSize: type.large },
  sub: { color: theme.colors.textMuted, fontSize: type.small },
  hint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18, padding: space.lg },
  newCard: {
    gap: space.sm,
    padding: space.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  newHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: {
    color: theme.colors.textMuted,
    fontSize: type.label,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  newHint: { color: theme.colors.textMuted, fontSize: type.small, lineHeight: 16 },
  error: { color: theme.colors.danger, fontSize: type.small },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: HIT_TARGET,
    paddingHorizontal: space.md,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
    _web: { outlineStyle: 'none' },
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: HIT_TARGET,
    paddingHorizontal: space.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  search: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    _web: { outlineStyle: 'none' },
  },
  listenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: HIT_TARGET,
    marginTop: space.md,
  },
  listenLabel: { fontSize: type.body, fontWeight: '600' },
  list: { flex: 1 },
  listBody: { paddingBottom: space.xl },
  rowsWide: { paddingHorizontal: 32 },
  rowsNarrow: { paddingHorizontal: space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: HIT_TARGET + 6,
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    borderRadius: radius.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowName: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: type.body },
  rowCount: { color: theme.colors.textMuted, fontSize: type.small, fontVariant: ['tabular-nums'] },
  chevron: { color: theme.colors.textMuted, fontSize: 18, lineHeight: 20 },
  // The editor is anchored to the page rather than to a row: a row moves as
  // the search filters under it, and a popover pinned to one that has gone
  // draws in the wrong place.
  editorAnchor: { position: 'absolute', top: 0, left: 0, right: 0 },
}))
