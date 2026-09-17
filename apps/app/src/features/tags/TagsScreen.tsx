import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { TAG_NAME_MAX, type Tag } from '@selfmp3/shared'
import {
  HIT_TARGET,
  radius,
  tagSelected,
  toggleTag,
  useCreateTag,
  useLibrary,
} from '@selfmp3/client'
import { useRouter } from 'expo-router'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { BackToYou } from '../../ui/components/BackToYou'
import { Button } from '../../ui/components/Button'
import { ListenTagsList } from '../../ui/components/ListenTags'
import { Play, Plus, Shuffle } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { TagEditor } from '../../ui/components/TagEditor'
import { useLibraryModel } from '../library/library.model'
import { useLibraryFilter } from '../library/libraryFilter'
import { noteTagUsed } from '../library/recentTags.store'
import { useSaveTagsAsPlaylist } from '../library/saveTags'
import { existingTag } from './tags.model'

/**
 * Tags, as a page: reached from You on a phone.
 *
 * On a phone this is the front door to the whole library, so it is not a list
 * of tags to administer — it is what you are going to listen to. Tap tags, and
 * the bar along the foot says what you have built and starts it. A thumb is at
 * the bottom of a phone, which is why the bar is there and not in the header.
 *
 * Tag housekeeping is still here, because a phone has nowhere else for it: a
 * long press on a chip opens the same editor the sidebar's ⋯ does.
 */
export function TagsScreen(): ReactNode {
  const { theme } = useUnistyles()
  const { wide } = useLayout()
  const router = useRouter()
  const { data: library } = useLibrary()
  const { state: downloads } = useDownloads()
  const model = useLibraryModel(downloads.index)
  const [, setFilter] = useLibraryFilter()
  const player = usePlayer()
  const createTag = useCreateTag()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<Tag | null>(null)
  const editorAnchor = useRef<View>(null)

  const tags = library?.tags ?? []
  const saved = useSaveTagsAsPlaylist()
  const alreadySaved = saved.savedName !== null && saved.savedName === model.heading

  const choose = useCallback(
    (tagId: number) => {
      setFilter(current => {
        if (!tagSelected(current, tagId)) noteTagUsed(tagId)
        return toggleTag(current, tagId)
      })
    },
    [setFilter],
  )

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      setAdding(false)
      return
    }
    // Choosing the tag that exists beats silently making a twin of it.
    const existing = existingTag(tags, trimmed)
    if (existing) choose(existing.id)
    else if (!(await createTag.mutateAsync(trimmed).catch(() => null))) return
    setName('')
    setAdding(false)
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']} testID="tags-screen">
      <View style={[styles.head, wide ? styles.headWide : styles.headNarrow]}>
        <BackToYou />
        <View style={styles.headRow}>
          <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
            Tags
          </Text>
          <View style={styles.spacer} />
          <Pressable
            onPress={() => setAdding(open => !open)}
            accessibilityRole="button"
            accessibilityLabel="New tag"
            style={({ pressed }) => [styles.newTag, pressed && { opacity: 0.7 }]}
          >
            <Plus size={14} color={theme.colors.textSecondary} />
            <Text style={styles.newTagLabel}>New tag</Text>
          </Pressable>
        </View>

        {adding ? (
          <View style={styles.newForm}>
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
              maxLength={TAG_NAME_MAX}
              accessibilityLabel="New tag name"
            />
            <Button label="Add" variant="primary" onPress={() => void submit()} />
          </View>
        ) : null}
        {createTag.isError ? (
          <Text style={styles.error}>Couldn’t make that tag. Try a different name.</Text>
        ) : null}
      </View>

      {!library ? (
        <Text style={styles.hint}>Tags load with your library.</Text>
      ) : (
        <ListenTagsList
          selected={model.filter.tagIds}
          onToggle={choose}
          onEditTag={tag => setEditing(tag)}
          style={styles.list}
        />
      )}

      {/*
        The foot: what these tags come to, and the two things worth doing with
        it. Nothing here when no tag is on — there is no list yet to play.
      */}
      {model.tagFiltered ? (
        <View style={styles.bar} testID="tags-play-bar">
          {/*
            The words are the way to the songs themselves. Play starts them
            without showing them, and a picker with no way through to the list
            leaves you guessing what you built — so the count is a button, and
            it opens the Library already showing these tags.
          */}
          <Pressable
            onPress={() => router.navigate('/')}
            accessibilityRole="link"
            accessibilityLabel={`Show these songs: ${model.heading}, ${model.subtitle}`}
            style={({ pressed }) => [styles.barText, pressed && { opacity: 0.7 }]}
            testID="tags-show-songs"
          >
            <Text style={styles.barTitle} numberOfLines={1}>
              {model.heading}
            </Text>
            <Text style={styles.barSub} numberOfLines={1}>
              {model.subtitle} ›
            </Text>
          </Pressable>
          {alreadySaved ? (
            <Text style={styles.savedMark} testID="tags-saved">
              ✓ Saved
            </Text>
          ) : (
            <Button
              label={saved.saving ? '…' : 'Save'}
              accessibilityLabel="Save these tags as a playlist"
              disabled={saved.saving || model.visible.length === 0}
              onPress={() =>
                saved.save({
                  name: model.heading,
                  tagIds: model.filter.tagIds,
                  sort: model.filter.sort,
                  descending: model.filter.descending,
                })
              }
              testID="tags-save"
            />
          )}
          <Button
            accessibilityLabel="Shuffle these tags"
            icon={<Shuffle size={15} color={theme.colors.textPrimary} />}
            disabled={model.visible.length === 0}
            onPress={() => player.playShuffled(model.songIds)}
          />
          <Button
            variant="primary"
            accessibilityLabel="Play these tags"
            icon={<Play size={15} color={theme.colors.onAccent} />}
            disabled={model.visible.length === 0}
            onPress={() => player.playFrom(model.songIds, 0)}
            testID="tags-play"
          />
        </View>
      ) : null}

      <View ref={editorAnchor} collapsable={false} style={styles.editorAnchor} />
      <TagEditor
        tag={editing}
        anchorRef={editorAnchor}
        chosen={editing ? model.filter.tagIds.includes(editing.id) : false}
        onChoose={() => editing && choose(editing.id)}
        onDeleted={() => {
          if (editing && model.filter.tagIds.includes(editing.id)) choose(editing.id)
        }}
        onClose={() => setEditing(null)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  head: { gap: 10 },
  headWide: { paddingTop: 28, paddingHorizontal: 32 },
  headNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  spacer: { flex: 1 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headingNarrow: { fontSize: 22 },
  newTag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6 },
  newTagLabel: { color: theme.colors.textSecondary, fontSize: 13 },
  hint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18, padding: 16 },
  error: { color: theme.colors.danger, fontSize: 12 },
  list: { flex: 1, maxHeight: undefined, paddingTop: 10 },
  newForm: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: HIT_TARGET,
    paddingHorizontal: 10,
    color: theme.colors.textPrimary,
    fontSize: 15,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  barText: { flex: 1, minWidth: 0 },
  barTitle: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' },
  barSub: { color: theme.colors.textMuted, fontSize: 12 },
  savedMark: { color: theme.colors.good, fontSize: 12, fontWeight: '600' },
  // The editor is anchored to the page rather than to a chip: a chip moves as
  // the search filters under it, and a popover pinned to one that has gone
  // draws in the wrong place.
  editorAnchor: { position: 'absolute', top: 0, left: 0, right: 0 },
}))
