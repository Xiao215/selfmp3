import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { plural, formatLongDuration, type Tag } from '@selfmp3/shared'
import { clientApi, queryKeys, radius, space, useLibrary } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Chip } from '../../ui/components/Chip'
import { Plus } from '../../ui/components/Icons'
import { ListenTags } from '../../ui/components/ListenTags'
import { Sheet } from '../../ui/components/Sheet'
import { followRules } from '../library/saveTags'
import { AddSongsSheet } from '../playlistDetail/AddSongsSheet'
import { newPlaylist } from './playlists.model'

/**
 * Making a playlist, from wherever it is started: the sidebar's ＋, the
 * playlists page's New, the phone's ＋.
 *
 * One dialogue, no kinds.
 *
 * There used to be three — Playlist, Smart playlist, Live playlist — chosen
 * from a menu before a single song existed, and two of the three words had to
 * be explained. A playlist is a named list of songs; that definition has never
 * needed a second one, and every music app on earth agrees with it. What is
 * left is one optional property: it can follow tags, and then it keeps itself
 * filled.
 *
 * And only one box for that, not two. Filling a list from tags *is* following
 * them — there is no sensible reading where you pick tags to build a list and
 * then want it to go stale — and if you do want that, **Stop following** on
 * the playlist is one press and keeps every song.
 *
 * A playlist you fill yourself goes from its name straight into picking its
 * songs, and is only made when the first ones are confirmed, with them: a
 * playlist exists once it has a song (docs/UI-MIGRATION.md, Phase 5), so
 * cancelling at either step leaves nothing behind. One that follows tags is
 * made at once, since its tags are its songs.
 */
export function NewPlaylist({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const client = useQueryClient()
  const { data: library } = useLibrary()

  const [name, setName] = useState('')
  const [focused, setFocused] = useState(false)
  const [fromTags, setFromTags] = useState(false)
  const [tagIds, setTagIds] = useState<readonly number[]>([])
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Named, and picking its songs: the playlist does not exist yet. */
  const [picking, setPicking] = useState<string | null>(null)

  const tags: readonly Tag[] = library?.tags ?? []
  const chosen = tagIds.flatMap(id => tags.filter(tag => tag.id === id))
  const songs = library?.songs ?? []
  // What it would hold, worked out here rather than asked of the server: the
  // whole library is already in memory, and a count that lags behind the chips
  // is worse than no count.
  const matching = fromTags
    ? songs.filter(song => !song.missing && tagIds.some(id => song.tagIds.includes(id)))
    : []
  const seconds = matching.reduce((total, song) => total + song.duration, 0)

  const ready = name.trim().length > 0 && (!fromTags || tagIds.length > 0)

  const reset = (): void => {
    setName('')
    setFromTags(false)
    setTagIds([])
    setError(null)
    setPicking(null)
  }

  const finish = (id: number): void => {
    void client.invalidateQueries({ queryKey: queryKeys.library })
    reset()
    onClose()
    router.push({ pathname: '/playlists/[id]', params: { id: String(id) } })
  }

  /** Made with its first songs, in one go; a failure is the picker's to show. */
  const createWith = async (songIds: readonly number[]): Promise<void> => {
    const input = newPlaylist('manual', picking ?? '')
    if (!input) return
    const created = await clientApi().createPlaylist(input)
    await clientApi().addToPlaylist(created.id, { songIds: [...songIds] })
    finish(created.id)
  }

  const next = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!ready || busy) return
    if (!fromTags) {
      setPicking(trimmed)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input = newPlaylist('live', trimmed, {
        rules: followRules({ tagIds, sort: 'addedAt', descending: true }),
      })
      if (!input) return
      const created = await clientApi().createPlaylist(input)
      finish(created.id)
    } catch (caught) {
      // The name stays in the box, so trying again is one tap.
      setError(`Couldn’t make “${trimmed}”: ${(caught as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const toggleTag = (tagId: number): void =>
    setTagIds(current =>
      current.includes(tagId) ? current.filter(id => id !== tagId) : [...current, tagId],
    )

  const cancel = (): void => {
    reset()
    onClose()
  }

  if (picking !== null) {
    return (
      <AddSongsSheet
        open={open}
        onClose={cancel}
        playlistName={picking}
        target={{ kind: 'new', create: createWith }}
      />
    )
  }

  return (
    <Sheet open={open} onClose={onClose} title="New playlist" testID="new-playlist">
      <View style={styles.body}>
        <TextInput
          style={[styles.input, focused && { borderColor: accent.accent }]}
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => void next()}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Name it"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Playlist name"
          autoFocus
          autoCorrect={false}
          returnKeyType="done"
        />

        <Pressable
          onPress={() => setFromTags(on => !on)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: fromTags }}
          accessibilityLabel="Fill it from tags, and keep it filled"
          style={styles.checkRow}
          testID="new-playlist-from-tags"
        >
          <Checkbox checked={fromTags} />
          <Text style={styles.checkLabel}>Fill it from tags, and keep it filled</Text>
        </Pressable>

        {fromTags ? (
          <View style={styles.tagBlock}>
            <View style={styles.chips}>
              {chosen.map(tag => (
                <Chip
                  key={tag.id}
                  compact
                  label={tag.name}
                  hue={tag.hue}
                  selected
                  onPress={() => toggleTag(tag.id)}
                  onRemove={() => toggleTag(tag.id)}
                />
              ))}
              <View collapsable={false}>
                <Pressable
                  onPress={() => setChoosing(open => !open)}
                  accessibilityRole="button"
                  accessibilityLabel="Pick tags"
                  style={({ pressed }) => [
                    styles.add,
                    pressed && { backgroundColor: theme.colors.surface3 },
                  ]}
                  testID="new-playlist-pick-tags"
                >
                  <Plus size={13} color={theme.colors.textMuted} />
                  <Text style={styles.addLabel}>{chosen.length > 0 ? 'tag' : 'pick tags'}</Text>
                </Pressable>
              </View>
            </View>
            {choosing ? (
              <ListenTags
                open
                onClose={() => setChoosing(false)}
                selected={tagIds}
                onToggle={toggleTag}
              />
            ) : null}
            <Text style={styles.hint}>
              {tagIds.length === 0
                ? 'Songs carrying any of the tags you pick go in, and new ones join as you tag them.'
                : `${plural(matching.length, 'song', 'songs')} · ${formatLongDuration(seconds)}`}
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Button label="Cancel" onPress={cancel} />
          <Button
            // A playlist you fill yourself is not made yet: its songs come next.
            label={fromTags ? 'Create' : 'Add songs'}
            variant="primary"
            disabled={!ready}
            busy={busy}
            onPress={() => void next()}
            testID="new-playlist-next"
          />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm, padding: space.sm },
  input: {
    minHeight: 38,
    paddingHorizontal: space.md,
    color: theme.colors.textPrimary,
    fontSize: 14,
    // A control on the sheet, which is a card on a phone and the control
    // surface as a dialog, so the field is raised above both. The edge only
    // carries the focus ring: at rest it is the fill's own colour.
    backgroundColor: theme.colors.surface3,
    borderWidth: 1,
    borderColor: theme.colors.surface3,
    borderRadius: radius.pill,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 },
  checkLabel: { color: theme.colors.textPrimary, fontSize: 13.5, flexShrink: 1 },
  tagBlock: { gap: 6, paddingLeft: 26 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  addLabel: { color: theme.colors.textMuted, fontSize: 11.5 },
  hint: { color: theme.colors.textMuted, fontSize: 12 },
  error: { color: theme.colors.danger, fontSize: 12 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    marginTop: space.xs,
  },
}))
