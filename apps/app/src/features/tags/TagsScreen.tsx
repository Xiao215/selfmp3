import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import type { Tag } from '@selfmp3/shared'
import {
  excludeTag,
  HIT_TARGET,
  includeTag,
  oklchToHexAlpha,
  radius,
  tagFilterState,
  type TagFilterState,
  useCreateTag,
  useLibrary,
} from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { BackToYou } from '../../ui/components/BackToYou'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { More, Plus } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { TagEditor } from '../../ui/components/TagEditor'
import { useLibraryTagFilter } from '../library/libraryFilter'
import { existingTag, onlyTag, songCount } from './tags.model'

/**
 * Your tags, as a page: reached from You on a phone (tags.model.ts).
 *
 * Tapping a tag shows its songs in the Library; the ⋯ beside it opens the
 * same editor the sidebar's does — filter either way, rename, recolour,
 * delete. It draws at any width, but only a phone links to it: a computer's
 * sidebar lists the tags already.
 */
export function TagsScreen(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const { wide } = useLayout()
  const { data: library } = useLibrary()
  // The tag half only: a letter typed into the library search changes nothing here.
  const [filter, setFilter] = useLibraryTagFilter()
  const createTag = useCreateTag()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const tags = library?.tags ?? []

  // A tag filters the library, so choosing one goes there to show it.
  const toLibrary = (): void => router.navigate('/')
  const show = (tagId: number): void => {
    setFilter(current => onlyTag(current, tagId))
    toLibrary()
  }

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      setAdding(false)
      return
    }
    // Choosing the tag that exists beats silently making a twin of it.
    const existing = existingTag(tags, trimmed)
    if (existing) {
      show(existing.id)
    } else {
      const made = await createTag.mutateAsync(trimmed).catch(() => null)
      if (!made) return
    }
    setName('')
    setAdding(false)
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        keyboardShouldPersistTaps="handled"
        testID="tags-screen"
      >
        <BackToYou />
        <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
          Tags
        </Text>

        {!library ? (
          <Text style={styles.hint}>Tags load with your library.</Text>
        ) : (
          <>
            <View style={styles.card} accessibilityRole="list" accessibilityLabel="Tags">
              {tags.map((tag, index) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  first={index === 0}
                  state={tagFilterState(filter, tag.id)}
                  onShow={() => show(tag.id)}
                  onInclude={() => {
                    setFilter(current => includeTag(current, tag.id))
                    toLibrary()
                  }}
                  onExclude={() => {
                    setFilter(current => excludeTag(current, tag.id))
                    toLibrary()
                  }}
                  onDeleted={() => {
                    const state = tagFilterState(filter, tag.id)
                    if (state === 'include') setFilter(current => includeTag(current, tag.id))
                    if (state === 'exclude') setFilter(current => excludeTag(current, tag.id))
                  }}
                />
              ))}

              {adding ? (
                <View style={[styles.newForm, tags.length > 0 && styles.rowDivided]}>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={text => {
                      setName(text)
                      createTag.reset()
                    }}
                    onSubmitEditing={() => void submit()}
                    placeholder="tag name"
                    placeholderTextColor={theme.colors.textMuted}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={40}
                    accessibilityLabel="New tag name"
                  />
                  <Button
                    label={existingTag(tags, name) ? 'Show it' : 'Add'}
                    variant="primary"
                    disabled={!name.trim() || createTag.isPending}
                    onPress={() => void submit()}
                  />
                  <Button
                    label="Cancel"
                    onPress={() => {
                      setName('')
                      setAdding(false)
                    }}
                  />
                </View>
              ) : (
                <Pressable
                  onPress={() => setAdding(true)}
                  accessibilityRole="button"
                  testID="tags-new"
                  style={({ pressed }) => [
                    styles.row,
                    tags.length > 0 && styles.rowDivided,
                    pressed && { backgroundColor: theme.colors.surface2 },
                  ]}
                >
                  <Plus size={16} color={accent.accent} />
                  <Text style={[styles.newLabel, { color: accent.accent }]}>New tag</Text>
                </Pressable>
              )}
            </View>

            {createTag.error ? <Text style={styles.error}>{createTag.error.message}</Text> : null}

            <Text style={[styles.hint, styles.foot]}>
              {tags.length === 0
                ? 'No tags yet. Tags are how you find things later — try “chill”.'
                : 'Tap a tag to see its songs in Library.'}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * One tag: its colour, its name and how many songs carry it. A tag that is
 * filtering the library right now is tinted, or marked "not", as the sidebar
 * marks it, so coming back here shows what the Library is doing.
 */
function TagRow({
  tag,
  first,
  state,
  onShow,
  onInclude,
  onExclude,
  onDeleted,
}: {
  tag: Tag
  first: boolean
  state: TagFilterState
  onShow: () => void
  onInclude: () => void
  onExclude: () => void
  onDeleted: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const [editing, setEditing] = useState(false)
  const moreRef = useRef<View>(null)
  const included = state === 'include'
  const excluded = state === 'exclude'

  return (
    <View
      style={[
        styles.tagRow,
        !first && styles.rowDivided,
        included && { backgroundColor: oklchToHexAlpha(0.35, 0.09, tag.hue, 0.32) },
      ]}
    >
      <Pressable
        onPress={onShow}
        accessibilityRole="button"
        accessibilityLabel={`${tag.name}, ${songCount(tag.songCount)}`}
        accessibilityState={{ selected: included }}
        style={({ pressed }) => [styles.row, styles.tagMain, pressed && { opacity: 0.7 }]}
      >
        <View
          style={[
            styles.dot,
            excluded
              ? { borderWidth: 1.5, borderColor: oklchToHexAlpha(0.68, 0.15, tag.hue, 1) }
              : { backgroundColor: oklchToHexAlpha(0.68, 0.15, tag.hue, 1) },
          ]}
        />
        <Text style={[styles.tagName, included && styles.tagNameOn]} numberOfLines={1}>
          {excluded ? <Text style={styles.not}>not </Text> : null}
          {tag.name}
        </Text>
        <Text style={styles.count}>{tag.songCount.toLocaleString()}</Text>
      </Pressable>
      <View ref={moreRef} collapsable={false}>
        <IconButton onPress={() => setEditing(open => !open)} label={`Edit tag ${tag.name}`}>
          <More size={16} color={theme.colors.textMuted} />
        </IconButton>
      </View>

      <TagEditor
        tag={editing ? tag : null}
        anchorRef={moreRef}
        filter={state}
        onInclude={onInclude}
        onExclude={onExclude}
        onDeleted={onDeleted}
        onClose={() => setEditing(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentWide: { paddingTop: 28, paddingHorizontal: 32, maxWidth: 640 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700', marginBottom: 16 },
  headingNarrow: { fontSize: 22 },
  hint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  foot: { marginTop: 12, paddingHorizontal: 4 },
  error: { color: theme.colors.danger, fontSize: 12, marginTop: 8 },
  card: {
    overflow: 'hidden',
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: HIT_TARGET + 4,
    paddingHorizontal: 14,
  },
  tagRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  tagMain: { flex: 1, minWidth: 0 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tagName: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: 15 },
  tagNameOn: { fontWeight: '600' },
  not: { color: theme.colors.danger },
  count: { color: theme.colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  newLabel: { fontSize: 15, fontWeight: '600' },
  newForm: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: HIT_TARGET,
    paddingHorizontal: 10,
    color: theme.colors.textPrimary,
    fontSize: 15,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
}))
