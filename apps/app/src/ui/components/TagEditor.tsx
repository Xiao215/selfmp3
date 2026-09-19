import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { View as RNView } from 'react-native'
import { TAG_NAME_MAX, type Tag } from '@selfmp3/shared'
import {
  HIT_TARGET,
  oklchToHexAlpha,
  radius,
  space,
  tagColors,
  useDeleteTag,
  useRenameTag,
  useSetTagHue,
} from '@selfmp3/client'
import { useAccent } from '../accent'
import { Button } from './Button'
import { Check, Trash } from './Icons'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'
import { label } from '../surfaces'

/**
 * Everything you can do to a tag itself.
 *
 * Rename it, recolour it, delete it. Tags are how this library is browsed,
 * so their names and colours are how you find things. It opens from the ⋯
 * beside a tag in the sidebar, from holding a tag on All tags, and from the ⋯
 * on a tag's own page. Opening the tag is the tag itself, tapped: this has no
 * "listen" of its own.
 *
 * A popover beside the control at desktop width and a sheet on a phone — the
 * primitive decides, not this.
 */

/**
 * Twelve hues around the wheel, skipping the muddy stretch between yellow and
 * green where chips stop looking like different colours from each other.
 */
const HUES = [0, 22, 40, 58, 95, 140, 168, 192, 212, 235, 262, 290, 318] as const

export function TagEditor({
  tag,
  anchorRef,
  onDeleted,
  onClose,
}: {
  /** The tag being edited, or null when closed. */
  tag: Tag | null
  anchorRef: RefObject<RNView | null>
  onDeleted?: () => void
  onClose: () => void
}): ReactNode {
  return (
    <Popover
      open={tag !== null}
      onClose={onClose}
      anchorRef={anchorRef}
      width={290}
      testID="tag-editor"
    >
      {tag ? <Editor key={tag.id} tag={tag} onDeleted={onDeleted} onClose={onClose} /> : null}
    </Popover>
  )
}

function Editor({
  tag,
  onDeleted,
  onClose,
}: {
  tag: Tag
  onDeleted?: () => void
  onClose: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const [name, setName] = useState(tag.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const rename = useRenameTag()
  const setHue = useSetTagHue()
  const deleteTag = useDeleteTag()

  const trimmed = name.trim()
  const changed = trimmed.length > 0 && trimmed !== tag.name
  // A tag made before the palette existed has a hue of its own; it leads the
  // row so the current colour is always one of the choices.
  const hues: readonly number[] = HUES.some(hue => hue === tag.hue) ? HUES : [tag.hue, ...HUES]

  const submit = (): void => {
    if (!changed) return
    rename.mutate({ id: tag.id, name: trimmed })
  }

  return (
    <View>
      <View style={styles.title}>
        <View style={[styles.dot, { backgroundColor: tagColors(tag.hue).dot }]} />
        <Text style={styles.titleText} numberOfLines={1}>
          Tag <Text style={styles.titleName}>{tag.name}</Text>
        </Text>
        <Text style={styles.hint}>
          {tag.songCount} {tag.songCount === 1 ? 'song' : 'songs'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.fieldLabel}>Name</Text>
        <View style={styles.nameRow}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={text => {
              setName(text)
              rename.reset()
            }}
            onSubmitEditing={submit}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={TAG_NAME_MAX}
            accessibilityLabel="Name"
          />
          <Button
            label="Rename"
            variant="primary"
            disabled={!changed || rename.isPending}
            onPress={submit}
            icon={
              rename.isSuccess && !changed ? <Check size={13} color={accent.onAccent} /> : undefined
            }
          />
        </View>
        {rename.error ? <Text style={styles.error}>{rename.error.message}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.fieldLabel}>Colour</Text>
        <View style={styles.swatches} role="radiogroup" aria-label="Tag colour">
          {hues.map(hue => {
            const on = tag.hue === hue
            return (
              <Pressable
                key={hue}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Hue ${hue}`}
                onPress={() => setHue.mutate({ id: tag.id, hue })}
                style={[
                  styles.swatchRing,
                  on && { borderColor: oklchToHexAlpha(0.75, 0.14, hue, 1) },
                ]}
              >
                <View
                  style={[styles.swatch, { backgroundColor: oklchToHexAlpha(0.62, 0.15, hue, 1) }]}
                >
                  {on ? <Check size={12} color={oklchToHexAlpha(0.18, 0.03, hue, 1)} /> : null}
                </View>
              </Pressable>
            )
          })}
        </View>
      </View>

      {!confirmingDelete ? (
        <SheetItem
          icon={<Trash size={15} color={theme.colors.danger} />}
          label="Delete tag…"
          danger
          onPress={() => setConfirmingDelete(true)}
        />
      ) : (
        <View>
          <Text style={[styles.hint, styles.confirm]}>
            Delete “{tag.name}”? Its {tag.songCount}{' '}
            {tag.songCount === 1 ? 'song stays' : 'songs stay'} in your library.
          </Text>
          <SheetItem
            icon={<Trash size={15} color={theme.colors.danger} />}
            label="Delete tag"
            danger
            onPress={() => {
              deleteTag.mutate(tag.id)
              onDeleted?.()
              onClose()
            }}
          />
          <SheetItem label="Cancel" onPress={() => setConfirmingDelete(false)} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  titleText: { color: theme.colors.textSecondary, fontSize: 13, flexShrink: 1 },
  titleName: { color: theme.colors.textPrimary, fontWeight: '700' },
  hint: { color: theme.colors.textMuted, fontSize: 12 },
  section: { paddingTop: space.xs, paddingHorizontal: space.xs, paddingBottom: space.sm },
  fieldLabel: { ...label(theme.colors), marginBottom: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    flex: 1,
    minHeight: HIT_TARGET,
    paddingHorizontal: 10,
    color: theme.colors.textPrimary,
    fontSize: 13,
    backgroundColor: theme.colors.surface3,
    borderRadius: radius.pill,
  },
  error: { color: theme.colors.danger, fontSize: 12, marginTop: 5 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // The ring is the mark of the chosen colour, so it keeps its edge.
  swatchRing: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 999,
    padding: 2,
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirm: { paddingHorizontal: space.md, paddingVertical: space.sm },
}))
