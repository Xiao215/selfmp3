import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Tag } from '@selfmp3/shared'
import { type, space } from '@selfmp3/client'
import { Chip } from './Chip'
import { Plus } from './Icons'
import { Sheet } from './Sheet'
import { TagSearchList } from './TagPicker'

/**
 * A row of chosen tags with a way to add another: the tags an import arrives
 * with, the tags a live playlist fills from, the tags songs not yet in the
 * library will get. Each chosen tag is a white chip; pressing it, or its ×,
 * takes it off (`onRemove`; left out where a tag cannot go, as a live
 * playlist's last). Then the dashed "+ tag" add chip (`Chip dashed`), and
 * whatever the place adds at the end.
 */
export function TagChipRow({
  lead,
  tags,
  onRemove,
  add,
  children,
  style,
  testID,
}: {
  /** Words before the chips: "Tag them", "Fills from". */
  lead?: string
  /** The chosen tags, in the order drawn. */
  tags: readonly Tag[]
  onRemove?: (tag: Tag) => void
  add: {
    readonly onPress: () => void
    /** What a screen reader hears for "+ tag": "Add a tag it fills from". */
    readonly accessibilityLabel: string
    readonly testID?: string
  }
  children?: ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  return (
    <View style={[styles.row, style]} testID={testID}>
      {lead ? <Text style={styles.lead}>{lead}</Text> : null}
      {tags.map(tag => (
        <Chip
          key={tag.id}
          label={tag.name}
          hue={tag.hue}
          // Only the chosen tags are drawn, so every chip is on.
          selected
          compact
          onPress={() => onRemove?.(tag)}
          onRemove={onRemove ? () => onRemove(tag) : undefined}
        />
      ))}
      <Chip
        label="tag"
        icon={<Plus tone="textSecondary" />}
        selected={false}
        dashed
        compact
        onPress={add.onPress}
        accessibilityLabel={add.accessibilityLabel}
        testID={add.testID}
      />
      {children}
    </View>
  )
}

/**
 * Tags for songs that are not in the library yet: an import, a migration. The
 * choice is only held here; whoever runs the import applies it.
 *
 * Only the chosen tags are on show, so the row stays one line however many
 * tags the library has. The rest are in the picker a song uses.
 */
const TITLE = 'Tag these songs'

export function TagChooser({
  tags,
  selected,
  onChange,
}: {
  tags: readonly Tag[]
  selected: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const chosen = tags.filter(tag => selected.has(tag.id))

  const remove = (tag: Tag): void => {
    const next = new Set(selected)
    next.delete(tag.id)
    onChange(next)
  }

  return (
    <>
      <TagChipRow
        tags={chosen}
        onRemove={remove}
        add={{ onPress: () => setOpen(true), accessibilityLabel: TITLE }}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={TITLE} titleTone="label">
        {open ? <TagSearchList selected={selected} onChange={onChange} /> : null}
      </Sheet>
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.tight },
  lead: { color: theme.colors.textSecondary, fontSize: type.sub },
}))
