import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { fuzzyRank, type Song, type Tag } from '@selfmp3/shared'
import { HIT_TARGET, oklchToHexAlpha, radius, space } from '@selfmp3/client'
import { useCreateTag, useLibrary, useSetSongTags } from '../../api/queries'
import { useAccent } from '../accent'
import { Checkbox } from './Checkbox'
import { Plus } from './Icons'
import { Sheet } from './Sheet'

/**
 * Attach tags to a song: the web's `TagPicker`.
 *
 * Tagging should never interrupt listening. The list filters as you type,
 * submitting picks the best match, and creating a tag is always one step away.
 * A near-match is shown first, though, because free-form tagging usually goes
 * wrong as "chill", "Chill" and "chilled" becoming three tags.
 *
 * A sheet at every width for now, like the song menu it opens from, which has
 * no control of its own to hang a popover off.
 */
export function TagPicker({
  song,
  onClose,
}: {
  song: Song | null
  onClose: () => void
}): ReactNode {
  return (
    <Sheet
      open={song !== null}
      onClose={onClose}
      title={song ? `Tags for ${song.title}` : undefined}
      titleTone="label"
      testID="tag-picker"
    >
      {song ? <Picker key={song.id} song={song} /> : null}
    </Sheet>
  )
}

function Picker({ song }: { song: Song }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { data: library } = useLibrary()
  const tags = useMemo<readonly Tag[]>(() => library?.tags ?? [], [library?.tags])
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set(song.tagIds))
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const setSongTags = useSetSongTags()
  const createTag = useCreateTag()

  const ranked = useMemo(() => fuzzyRank(query, tags, tag => tag.name), [query, tags])
  const hasExact = ranked.some(match => match.exact)
  const trimmed = query.trim()

  const apply = (next: ReadonlySet<number>): void => {
    setSelected(next)
    setSongTags.mutate({ songId: song.id, tagIds: [...next] })
  }

  const toggle = (tagId: number): void => {
    const next = new Set(selected)
    if (next.has(tagId)) next.delete(tagId)
    else next.add(tagId)
    apply(next)
  }

  const create = async (): Promise<void> => {
    if (!trimmed || createTag.isPending) return
    setError(null)
    try {
      const tag = await createTag.mutateAsync(trimmed)
      setQuery('')
      // Read the set as it is now: a tag ticked while this waited must survive.
      setSelected(current => {
        const next = new Set([...current, tag.id])
        setSongTags.mutate({ songId: song.id, tagIds: [...next] })
        return next
      })
    } catch (caught) {
      // The name stays in the box, so trying again is one tap.
      setError(`Couldn’t create “${trimmed}”: ${(caught as Error).message}`)
    }
  }

  const submit = (): void => {
    // With nothing typed there is no best match: an empty query ranks the whole
    // list, and submitting would silently tag the song with its first entry.
    if (!trimmed) return
    const best = ranked[0]
    if (best) {
      toggle(best.item.id)
      setQuery('')
    } else {
      void create()
    }
  }

  return (
    <View>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
        placeholder="Search or create a tag…"
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        accessibilityLabel="Search or create a tag"
      />

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {ranked.map(({ item }) => {
          const on = selected.has(item.id)
          return (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={() => {
                toggle(item.id)
                setQuery('')
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={item.name}
            >
              <Checkbox checked={on} />
              <View
                style={[styles.dot, { backgroundColor: oklchToHexAlpha(0.68, 0.15, item.hue, 1) }]}
              />
              <Text style={styles.itemLabel} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.count}>{item.songCount}</Text>
            </Pressable>
          )
        })}
        {ranked.length === 0 && !trimmed ? (
          <Text style={styles.hint}>No tags yet — type a name to create your first one.</Text>
        ) : null}
      </ScrollView>

      {trimmed && !hasExact ? (
        <Pressable
          style={({ pressed }) => [styles.item, styles.create, pressed && styles.itemPressed]}
          onPress={() => void create()}
          accessibilityRole="button"
          accessibilityLabel={`Create ${trimmed}`}
        >
          <Plus size={14} color={accent.accent} />
          <Text style={[styles.itemLabel, { color: accent.accent }]} numberOfLines={1}>
            Create <Text style={styles.createName}>{trimmed}</Text>
          </Text>
          {ranked[0] ? <Text style={styles.count}>similar: {ranked[0].item.name}</Text> : null}
        </Pressable>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  input: {
    minHeight: HIT_TARGET,
    marginHorizontal: space.md,
    marginBottom: space.xs,
    paddingHorizontal: 10,
    color: theme.colors.textPrimary,
    fontSize: 14,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  list: { maxHeight: 320 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: HIT_TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  itemPressed: { backgroundColor: theme.colors.surface2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  itemLabel: { flex: 1, color: theme.colors.textPrimary, fontSize: 14 },
  count: { color: theme.colors.textMuted, fontSize: 11 },
  create: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    borderRadius: 0,
    marginTop: space.xs,
  },
  createName: { fontWeight: '700' },
  hint: { color: theme.colors.textMuted, fontSize: 12, padding: space.md },
  error: {
    color: theme.colors.danger,
    fontSize: 12,
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
}))
