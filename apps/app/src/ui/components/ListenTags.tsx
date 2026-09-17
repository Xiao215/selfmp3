import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { fuzzyRank, type Tag } from '@selfmp3/shared'
import { chooserTagGroups, HIT_TARGET, radius, space, type, useLibrary } from '@selfmp3/client'
import { useAccent } from '../accent'
import { Chip } from './Chip'
import { Search, X } from './Icons'

/**
 * Choosing tags to listen to.
 *
 * Neither of the two pickers that already exist. `TagPicker` puts tags *on* a
 * song, and `TagChooser` collects tags for songs that are not in the library
 * yet; this one picks tags to *hear*. So it cannot create a tag — there is
 * nothing to create for a library you are browsing — and it shows chips rather
 * than a checklist, because what you are assembling is read back as chips
 * everywhere else.
 *
 * **A panel in the page, not a window over it.** It was a popover hanging off a
 * small ＋, which put a dark box across the sidebar, gave the chips a column
 * narrower than the one they were being added to, and — when the router had
 * more than one library mounted — drew twice. In the flow it is part of the
 * thing it edits: the head grows, the songs move down, nothing overlaps, and
 * the chips have the whole width to breathe in. It is the same at every width,
 * which also means it can sit inside a dialogue without being a second layer
 * over the first.
 *
 * Two faces, and they never overlap. With nothing typed it offers the tags used
 * most and the few made lately, each a labelled lane. With something typed it
 * shows the matches and nothing else: once you are searching, a wall of tags
 * you did not search for is in the way.
 */
export function ListenTags({
  open,
  onClose,
  selected,
  onToggle,
  summary,
}: {
  open: boolean
  onClose: () => void
  selected: readonly number[]
  onToggle: (tagId: number) => void
  /** What the choice comes to — "176 songs · 10 hr 52 min" — shown by the Done row. */
  summary?: string
}): ReactNode {
  if (!open) return null
  return (
    <ListenTagsList
      selected={selected}
      onToggle={onToggle}
      summary={summary}
      onDone={onClose}
      autoFocus
    />
  )
}

/**
 * The panel itself, for a caller that draws it in its own flow: the library
 * head, and the phone's Tags page, which *is* the picker rather than a page
 * that opens one.
 */
export function ListenTagsList({
  selected,
  onToggle,
  onEditTag,
  onDone,
  summary,
  autoFocus = false,
  style,
}: {
  selected: readonly number[]
  onToggle: (tagId: number) => void
  /** A long press on a chip, where tags can be renamed and deleted. */
  onEditTag?: (tag: Tag) => void
  /** Shown as a Done button when the panel is something that closes. */
  onDone?: () => void
  summary?: string
  autoFocus?: boolean
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')
  const { data: library } = useLibrary()
  const tags = useMemo<readonly Tag[]>(() => library?.tags ?? [], [library?.tags])
  const trimmed = query.trim()

  const matches = useMemo(
    () => (trimmed ? fuzzyRank(query, tags, tag => tag.name).map(match => match.item) : []),
    [query, trimmed, tags],
  )
  const { mostUsed, lately } = useMemo(() => chooserTagGroups(tags, selected), [tags, selected])

  const chip = (tag: Tag): ReactNode => (
    <Chip
      key={tag.id}
      compact
      label={tag.name}
      hue={tag.hue}
      count={tag.songCount}
      selected={selected.includes(tag.id)}
      onPress={() => onToggle(tag.id)}
      onLongPress={onEditTag ? () => onEditTag(tag) : undefined}
    />
  )

  /** A labelled lane: the heading on the left, the chips flowing beside it. */
  const lane = (label: string, list: readonly Tag[]): ReactNode =>
    list.length === 0 ? null : (
      <View style={styles.lane}>
        <Text style={styles.laneLabel}>{label}</Text>
        <View style={styles.cloud}>{list.map(chip)}</View>
      </View>
    )

  return (
    <View style={[styles.panel, style]} testID="listen-tags">
      <View style={styles.searchRow}>
        <View style={[styles.searchBox, focused && { borderColor: accent.accent }]}>
          <Search size={14} color={focused ? accent.accent : theme.colors.textMuted} />
          <TextInput
            style={styles.search}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`}
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={autoFocus}
            accessibilityLabel="Search tags"
            testID="listen-tags-search"
          />
          {trimmed ? (
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
        {summary ? <Text style={styles.summary}>{summary}</Text> : null}
        {onDone ? (
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel="Done choosing tags"
            style={({ pressed }) => [styles.done, pressed && { opacity: 0.7 }]}
            testID="listen-tags-done"
          >
            <Text style={[styles.doneLabel, { color: accent.accent }]}>Done</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        {trimmed ? (
          matches.length === 0 ? (
            <Text style={styles.hint}>No tag matches “{trimmed}”.</Text>
          ) : (
            lane(`${matches.length} of ${tags.length}`, matches)
          )
        ) : tags.length === 0 ? (
          <Text style={styles.hint}>
            No tags yet. Tags are how you find things later — put one on a song and it turns up
            here.
          </Text>
        ) : (
          <>
            {lane('Most used', mostUsed)}
            {lane('Lately', lately)}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  panel: {
    gap: space.sm,
    padding: space.sm,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  searchBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  search: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    // As in TagPicker: the accent border is the focus, and the browser's own
    // ring on top of it drew a second white outline.
    _web: { outlineStyle: 'none' },
  },
  summary: { color: theme.colors.textMuted, fontSize: type.small },
  done: { minHeight: HIT_TARGET - 10, justifyContent: 'center', paddingHorizontal: space.sm },
  doneLabel: { fontSize: type.small, fontWeight: '700' },
  body: { flexShrink: 1, maxHeight: 210 },
  // The label sits beside its chips rather than over them: a heading on its own
  // line costs a row of height per group, and there are only ever two groups.
  lane: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingBottom: space.xs },
  laneLabel: {
    width: 74,
    paddingTop: 5,
    color: theme.colors.textMuted,
    fontSize: type.label,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cloud: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  hint: { color: theme.colors.textMuted, fontSize: type.small, padding: space.xs },
}))
