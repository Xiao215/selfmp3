import { useMemo, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { fuzzyRank, type Tag } from '@selfmp3/shared'
import { chooserTagGroups, HIT_TARGET, radius, space, useLibrary } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { Chip } from './Chip'
import { usePanelDense } from './panel'
import { Popover } from './Popover'
import { Sheet } from './Sheet'

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
 * Two faces, and they never overlap. With nothing typed it offers the dozen
 * tags used most and the few made lately — which is the whole of what anyone
 * wants at two hundred tags. With something typed it shows the matches and
 * nothing else: once you are searching, a wall of tags you did not search for
 * is in the way.
 *
 * It stays open while you tap, so picking four tags is four taps rather than
 * four round trips, and the foot counts as you go.
 */
export function ListenTags({
  open,
  onClose,
  anchorRef,
  selected,
  onToggle,
  summary,
}: {
  open: boolean
  onClose: () => void
  /** The control that opened it, for a window attached to it at desktop width. */
  anchorRef?: RefObject<View | null>
  selected: readonly number[]
  onToggle: (tagId: number) => void
  /** What the choice comes to — "176 songs · 10 hr 52 min" — shown at the foot. */
  summary?: string
}): ReactNode {
  const { wide } = useLayout()
  const body = open ? (
    <ListenTagsList selected={selected} onToggle={onToggle} summary={summary} />
  ) : null
  if (wide && anchorRef) {
    return (
      <Popover open={open} onClose={onClose} anchorRef={anchorRef} width={360} testID="listen-tags">
        {body}
      </Popover>
    )
  }
  return (
    <Sheet open={open} onClose={onClose} title="Tags" titleTone="label" testID="listen-tags">
      {body}
    </Sheet>
  )
}

/**
 * The panel's contents on their own, for a screen that *is* the picker rather
 * than one that opens it: the phone's Tags page. Same two faces, same rules —
 * it would be a poor joke to teach the search twice.
 */
export function ListenTagsList({
  selected,
  onToggle,
  onEditTag,
  summary,
  autoFocus = false,
  style,
}: {
  selected: readonly number[]
  onToggle: (tagId: number) => void
  /** A long press on a chip, where tags can be renamed and deleted. */
  onEditTag?: (tag: Tag, anchor: View | null) => void
  summary?: string
  autoFocus?: boolean
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const dense = usePanelDense()
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
      compact={dense}
      label={tag.name}
      hue={tag.hue}
      selected={selected.includes(tag.id)}
      onPress={() => onToggle(tag.id)}
      onLongPress={onEditTag ? () => onEditTag(tag, null) : undefined}
    />
  )

  return (
    <View style={[styles.panel, style]}>
      <TextInput
        style={[
          styles.input,
          dense && styles.inputDense,
          focused && { borderColor: accent.accent },
        ]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        value={query}
        onChangeText={setQuery}
        placeholder={`Search ${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`}
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search tags"
        autoFocus={autoFocus}
        testID="listen-tags-search"
      />

      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        {trimmed ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>
              {matches.length} of {tags.length}
            </Text>
            {matches.length === 0 ? (
              <Text style={styles.hint}>No tag matches “{trimmed}”.</Text>
            ) : (
              <View style={styles.cloud}>{matches.map(chip)}</View>
            )}
          </View>
        ) : (
          <>
            {mostUsed.length > 0 ? (
              <View style={styles.group}>
                <Text style={styles.groupTitle}>You use these most</Text>
                <View style={styles.cloud}>{mostUsed.map(chip)}</View>
              </View>
            ) : (
              <Text style={styles.hint}>
                No tags yet. Tags are how you find things later — put one on a song and it turns up
                here.
              </Text>
            )}
            {lately.length > 0 ? (
              <View style={styles.group}>
                <Text style={styles.groupTitle}>Lately</Text>
                <View style={styles.cloud}>{lately.map(chip)}</View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {summary ? (
        <View style={styles.foot}>
          <Text style={styles.summary}>{summary}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  panel: { maxHeight: 420 },
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
    // As in TagPicker: the accent border is the focus, and the browser's own
    // ring on top of it drew a second white outline.
    _web: { outlineStyle: 'none' },
  },
  inputDense: {
    minHeight: 36,
    marginTop: space.sm,
    marginHorizontal: space.sm,
    marginBottom: space.sm,
  },
  body: { flexShrink: 1 },
  group: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.xs },
  groupTitle: {
    color: theme.colors.textMuted,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cloud: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  hint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  foot: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  summary: { color: theme.colors.textMuted, fontSize: 12 },
}))
