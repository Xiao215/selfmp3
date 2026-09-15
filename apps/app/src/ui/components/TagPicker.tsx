import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { fuzzyRank, type Song, type Tag } from '@selfmp3/shared'
import {
  HIT_TARGET,
  oklchToHexAlpha,
  radius,
  space,
  useCreateTag,
  useLibrary,
  useSetSongTags,
} from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { Checkbox } from './Checkbox'
import { Plus } from './Icons'
import { usePanelDense } from './panel'
import { Popover } from './Popover'
import { Sheet } from './Sheet'

/**
 * Attach tags to a song.
 *
 * Tagging should never interrupt listening. The list filters as you type,
 * submitting picks the best match, and creating a tag is always one step away.
 * A near-match is shown first, though, because free-form tagging usually goes
 * wrong as "chill", "Chill" and "chilled" becoming three tags.
 *
 * A small window: over the button that opened it when there is one (the
 * player bar's), and otherwise — opened from a song's menu, which closes as
 * it opens — a sheet, which on a computer is a small centred window.
 */
export function TagPicker({
  song,
  onClose,
  anchorRef,
}: {
  song: Song | null
  onClose: () => void
  /** The control that opened it, for a window attached to it at desktop width. */
  anchorRef?: RefObject<View | null>
}): ReactNode {
  const { wide } = useLayout()
  const picker = song ? <Picker key={song.id} song={song} /> : null
  if (wide && anchorRef) {
    return (
      <Popover
        open={song !== null}
        onClose={onClose}
        anchorRef={anchorRef}
        width={320}
        testID="tag-picker"
      >
        {picker}
      </Popover>
    )
  }
  return (
    <Sheet
      open={song !== null}
      onClose={onClose}
      title={song ? `Tags for ${song.title}` : undefined}
      titleTone="label"
      testID="tag-picker"
    >
      {picker}
    </Sheet>
  )
}

function Picker({ song }: { song: Song }): ReactNode {
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set(song.tagIds))
  const setSongTags = useSetSongTags()
  return (
    <TagSearchList
      selected={selected}
      onChange={next => {
        setSelected(next)
        setSongTags.mutate({ songId: song.id, tagIds: [...next] })
      }}
      autoFocus
    />
  )
}

/**
 * The picker itself, for tags on a song or tags for songs not yet here (an
 * import, a migration): search as you type, tick, and make a tag on the spot.
 * It holds no choice of its own; whoever shows it keeps `selected`.
 */
export function TagSearchList({
  selected,
  onChange,
  autoFocus = false,
}: {
  selected: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
  autoFocus?: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  // In a pop-up with a mouse the rows are a menu's, not a finger's.
  const dense = usePanelDense()
  const [focused, setFocused] = useState(false)
  const { data: library } = useLibrary()
  const tags = useMemo<readonly Tag[]>(() => library?.tags ?? [], [library?.tags])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createTag = useCreateTag()
  // The set as it is now: a tag ticked while a create waited must survive it.
  const latest = useRef(selected)
  useEffect(() => {
    latest.current = selected
  }, [selected])

  const ranked = useMemo(() => fuzzyRank(query, tags, tag => tag.name), [query, tags])
  const hasExact = ranked.some(match => match.exact)
  const trimmed = query.trim()

  const toggle = (tagId: number): void => {
    const next = new Set(latest.current)
    if (next.has(tagId)) next.delete(tagId)
    else next.add(tagId)
    latest.current = next
    onChange(next)
  }

  const create = async (): Promise<void> => {
    if (!trimmed || createTag.isPending) return
    setError(null)
    try {
      const tag = await createTag.mutateAsync(trimmed)
      setQuery('')
      const next = new Set([...latest.current, tag.id])
      latest.current = next
      onChange(next)
    } catch (caught) {
      // The name stays in the box, so trying again is one tap.
      setError(`Couldn’t create “${trimmed}”: ${(caught as Error).message}`)
    }
  }

  const submit = (): void => {
    // With nothing typed there is no best match: an empty query ranks the whole
    // list, and submitting would silently tick its first entry.
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
        style={[styles.input, dense && styles.inputDense, focused && { borderColor: accent.accent }]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
        placeholder="Search or create a tag…"
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        accessibilityLabel="Search or create a tag"
      />

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {ranked.map(({ item }) => {
          const on = selected.has(item.id)
          return (
            <Pressable
              key={item.id}
              style={({ pressed }) => [
                styles.item,
                dense && styles.itemDense,
                pressed && styles.itemPressed,
              ]}
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
    // The border says it has focus, in the accent. The browser's own ring on top
    // of it drew a second, white outline, and Chrome draws an `auto` ring at any
    // width: it has to be no outline at all.
    _web: { outlineStyle: 'none' },
  },
  /* In a pop-up: room above the box, a menu's height. */
  inputDense: {
    minHeight: 36,
    marginTop: space.sm,
    marginHorizontal: space.sm,
    marginBottom: space.sm,
  },
  itemDense: {
    minHeight: 34,
    paddingHorizontal: space.sm + 2,
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
