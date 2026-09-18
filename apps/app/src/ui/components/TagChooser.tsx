import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Tag } from '@selfmp3/shared'
import { radius } from '@selfmp3/client'
import { Chip } from './Chip'
import { TagPlus } from './Icons'
import { Sheet } from './Sheet'
import { TagSearchList } from './TagPicker'

/**
 * Tags for songs that are not in the library yet: an import, a migration. The
 * choice is only held here; whoever runs the import applies it.
 *
 * Only the chosen tags are on show, so the row stays one line however many
 * tags the library has. The rest are in the picker a song uses.
 */
export function TagChooser({
  tags,
  selected,
  onChange,
  title = 'Tag these songs',
}: {
  tags: readonly Tag[]
  selected: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
  title?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const [open, setOpen] = useState(false)
  const chosen = tags.filter(tag => selected.has(tag.id))

  const remove = (id: number): void => {
    const next = new Set(selected)
    next.delete(id)
    onChange(next)
  }

  return (
    <View style={styles.row}>
      {chosen.map(tag => (
        <Chip
          key={tag.id}
          label={tag.name}
          hue={tag.hue}
          selected
          compact
          onPress={() => setOpen(true)}
          onRemove={() => remove(tag.id)}
        />
      ))}
      <Pressable
        style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={chosen.length > 0 ? 'Edit tags' : 'Add tags'}
      >
        <TagPlus size={14} color={theme.colors.textSecondary} />
        <Text style={styles.addLabel}>{chosen.length > 0 ? 'Edit tags' : 'Add tags'}</Text>
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={title} titleTone="label">
        {open ? <TagSearchList selected={selected} onChange={onChange} autoFocus /> : null}
      </Sheet>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    // The dashed edge is the mark of a place something will go, as on Chip's
    // add chip.
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderStyle: 'dashed',
  },
  addPressed: { backgroundColor: theme.colors.surface2 },
  addLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '500' },
}))
