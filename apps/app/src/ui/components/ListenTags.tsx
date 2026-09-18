import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { fuzzyRank, type Tag } from '@selfmp3/shared'
import { chooserTagGroups, HIT_TARGET, radius, space, type, useLibrary } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { Chip } from './Chip'
import { Search, X } from './Icons'
import { card, label as labelText } from '../surfaces'

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
 *
 * **The same panel, laid out for the room it has.** With a mouse the lane's
 * label sits beside its chips and the chips are the compact size. On a phone
 * the label goes above them — a 74-point gutter out of 368 is a quarter of the
 * width spent on the word MOST USED — the chips are finger-sized, and the
 * summary and Done take a row of their own along the foot rather than being
 * squeezed in beside the search.
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
  return <Panel selected={selected} onToggle={onToggle} summary={summary} onDone={onClose} />
}

/** The panel itself, drawn in the caller's flow. */
function Panel({
  selected,
  onToggle,
  onDone,
  summary,
}: {
  selected: readonly number[]
  onToggle: (tagId: number) => void
  /** Shown as a Done button when the panel is something that closes. */
  onDone?: () => void
  summary?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const { wide } = useLayout()
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
      choice
      compact={wide}
      label={tag.name}
      hue={tag.hue}
      count={tag.songCount}
      selected={selected.includes(tag.id)}
      onPress={() => onToggle(tag.id)}
    />
  )

  /** A labelled lane: the heading beside the chips, or above them on a phone. */
  const lane = (label: string, list: readonly Tag[]): ReactNode =>
    list.length === 0 ? null : (
      <View style={wide ? styles.lane : styles.laneStacked}>
        <Text style={[styles.laneLabel, wide && styles.laneLabelBeside]}>{label}</Text>
        <View style={styles.cloud}>{list.map(chip)}</View>
      </View>
    )

  return (
    <View style={[styles.panel, wide ? styles.panelWide : styles.panelNarrow]} testID="listen-tags">
      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchBox,
            !wide && styles.searchBoxNarrow,
            focused && { borderColor: accent.accent },
          ]}
        >
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
            // With a mouse the panel opens ready to type. On a phone it must
            // not: the keyboard would come up over the chips the panel exists
            // to show, for a search almost nobody wants at nine tags.
            autoFocus={wide}
            returnKeyType="search"
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
        {/* With a mouse the summary and Done ride along beside the search. */}
        {wide ? foot({ summary, onDone, accent: accent.accent }) : null}
      </View>

      <ScrollView
        style={[styles.body, !wide && styles.bodyNarrow]}
        keyboardShouldPersistTaps="handled"
      >
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

      {/* On a phone they take the foot, where a thumb is and where a panel ends. */}
      {!wide && (summary !== undefined || onDone !== undefined) ? (
        <View style={styles.footRow}>
          {foot({ summary, onDone, accent: accent.accent, spread: true })}
        </View>
      ) : null}
    </View>
  )
}

/** What the choice comes to, and the way out of the panel. */
function foot({
  summary,
  onDone,
  accent,
  spread = false,
}: {
  summary?: string
  onDone?: () => void
  accent: string
  /** A row of its own: the summary to the left, Done to the right, count or no count. */
  spread?: boolean
}): ReactNode {
  return (
    <>
      {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      {spread ? <View style={styles.footSpacer} /> : null}
      {onDone ? (
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Done choosing tags"
          style={({ pressed }) => [styles.done, pressed && { opacity: 0.7 }]}
          testID="listen-tags-done"
        >
          <Text style={[styles.doneLabel, { color: accent }]}>Done</Text>
        </Pressable>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  // A card in the page's flow: one step up from the ground, no edge.
  panel: card(theme.colors),
  panelWide: { gap: space.sm, padding: space.sm },
  /* A phone has one panel on the screen and room to breathe in it. */
  panelNarrow: { gap: space.md, padding: space.md },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  searchBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 10,
    // A control on the card. Its edge is there only to carry the focus ring,
    // and is clear until then.
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.pill,
  },
  searchBoxNarrow: { minHeight: HIT_TARGET, paddingHorizontal: space.md },
  search: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    // As in TagPicker: the accent ring is the focus, and the browser's own
    // ring on top of it drew a second white outline.
    _web: { outlineStyle: 'none' },
  },
  summary: { color: theme.colors.textMuted, fontSize: type.small },
  done: { minHeight: HIT_TARGET - 10, justifyContent: 'center', paddingHorizontal: space.sm },
  doneLabel: { fontSize: type.small, fontWeight: '700' },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xs,
  },
  footSpacer: { flex: 1, minWidth: 0 },
  body: { flexShrink: 1, maxHeight: 210 },
  // Lower than a computer's, because the songs the picking is for are under
  // it: a panel that fills a phone leaves nothing to look at.
  bodyNarrow: { maxHeight: 200 },
  // With a mouse the label sits beside its chips: a heading on its own line
  // costs a row of height per group, and there are only ever two groups.
  lane: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingBottom: space.xs },
  /* On a phone the gutter is a quarter of the width, so the label goes above. */
  laneStacked: { gap: space.xs, paddingBottom: space.md },
  laneLabel: labelText(theme.colors),
  laneLabelBeside: { width: 74, paddingTop: 5 },
  cloud: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hint: { color: theme.colors.textMuted, fontSize: type.small, padding: space.xs },
}))
