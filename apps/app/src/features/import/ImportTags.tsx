import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Tag } from '@selfmp3/shared'
import { radius } from '@selfmp3/client'
import { Chip } from '../../ui/components/Chip'
import { Sheet } from '../../ui/components/Sheet'
import { TagSearchList } from '../../ui/components/TagPicker'

/**
 * The tags an import arrives with, which is all an import can add: it never
 * offers a playlist (`S3`, Import). Two faces of the one choice, held in the
 * draft (importDraft.ts): "Tag it [night drive ▾] as it arrives" on the Import
 * page (`P29`), and "Tag them" with chips on the review (`P30`, `C14`).
 *
 * Both open the tag picker a song uses, which makes a tag on the spot and asks
 * first when the name is an artist's (`useArtistNudge`). The tags are the ones
 * the import is going to (importSource.ts), list and new tag alike, so a tag
 * ticked or made here is one the import can name.
 */

/** The picker, as a sheet: a small centred window on a computer. */
function TagSheet({
  open,
  onClose,
  tags,
  createTag,
  selected,
  onChange,
}: {
  open: boolean
  onClose: () => void
  tags: readonly Tag[]
  createTag: (name: string) => Promise<Tag>
  selected: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
}): ReactNode {
  const from = useMemo(() => ({ tags, create: createTag }), [tags, createTag])
  return (
    <Sheet open={open} onClose={onClose} title="Tag these songs" titleTone="label">
      {open ? (
        <TagSearchList
          selected={selected}
          onChange={onChange}
          onLeave={onClose}
          from={from}
          autoFocus
        />
      ) : null}
    </Sheet>
  )
}

/** `P29`: "Tag it [night drive ▾] as it arrives", the choice read back in one pill. */
export function TagItPill({
  tags,
  createTag,
  selected,
  onChange,
}: {
  tags: readonly Tag[]
  createTag: (name: string) => Promise<Tag>
  selected: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const names = tags.filter(tag => selected.has(tag.id)).map(tag => tag.name)
  const shown = names.length === 0 ? 'no tag' : names.join(', ')
  return (
    <View style={styles.sentence}>
      <Text style={styles.words}>Tag it</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Tag it: ${shown}. Change`}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        testID="import-tag-it"
      >
        <Text style={styles.pillText} numberOfLines={1}>
          {shown}
        </Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>
      <Text style={styles.words}>as it arrives</Text>
      <TagSheet
        open={open}
        onClose={() => setOpen(false)}
        tags={tags}
        createTag={createTag}
        selected={selected}
        onChange={onChange}
      />
    </View>
  )
}

/**
 * `P30`, `C14`: "Tag them", each chosen tag a white chip, then the dashed
 * "+ tag". A tag turned off here stays on show, unlit, until the review goes,
 * so a slip is one tap to undo rather than a trip back into the picker.
 */
export function TagThem({
  tags,
  createTag,
  selected,
  onChange,
}: {
  tags: readonly Tag[]
  createTag: (name: string) => Promise<Tag>
  selected: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set(selected))
  // Adjusted during render: a tag chosen in the picker joins the row at once.
  if ([...selected].some(id => !seen.has(id))) setSeen(new Set([...seen, ...selected]))
  const shown = tags.filter(tag => seen.has(tag.id))

  const toggle = (id: number): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <View style={styles.row}>
      <Text style={styles.words}>Tag them</Text>
      {shown.map(tag => (
        <Chip
          key={tag.id}
          label={tag.name}
          hue={tag.hue}
          selected={selected.has(tag.id)}
          compact
          onPress={() => toggle(tag.id)}
        />
      ))}
      <Chip
        label="+ tag"
        selected={false}
        dashed
        compact
        onPress={() => setOpen(true)}
        testID="import-add-tag"
      />
      <TagSheet
        open={open}
        onClose={() => setOpen(false)}
        tags={tags}
        createTag={createTag}
        selected={selected}
        onChange={onChange}
      />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  sentence: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  words: { color: theme.colors.textSecondary, fontSize: 13 },
  // A control on the ground: the control's fill, no edge.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 240,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  pressed: { backgroundColor: theme.colors.surface3 },
  pillText: { flexShrink: 1, color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  caret: { color: theme.colors.textMuted, fontSize: 12 },
}))
