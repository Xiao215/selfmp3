import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { plural, rulesWithoutTag, TAG_NAME_MAX, type Playlist, type Tag } from '@selfmp3/shared'
import {
  failureText,
  space,
  type,
  useDeleteTag,
  useLibrary,
  useRenameTag,
  useSetTagHue,
  iconSize,
} from '@selfmp3/client'
import { useAccent } from '../accent'
import { Button } from './Button'
import { TextField } from './TextField'
import { Check, Trash } from './Icons'
import { HueSwatches } from './HueSwatches'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'
import { label } from '../surfaces'
import { StatusLine } from './StatusLine'
import { TagDot } from './TagDot'

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

export function TagEditor({
  tag,
  anchorRef,
  onDeleted,
  onClose,
}: {
  /** The tag being edited, or null when closed. */
  tag: Tag | null
  anchorRef: RefObject<View | null>
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
  // The hue the tag had when this opened leads the swatches while it is open:
  // the tag's own changes with every tap, and a row led by it would shift
  // under the pointer and lose the colour it started from.
  const [openedHue] = useState(tag.hue)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const rename = useRenameTag()
  const setHue = useSetTagHue()
  const deleteTag = useDeleteTag()
  const { data: library } = useLibrary()
  const following = followersOf(library?.playlists ?? [], tag.id)

  const trimmed = name.trim()
  const changed = trimmed.length > 0 && trimmed !== tag.name
  const submit = (): void => {
    if (!changed) return
    rename.mutate({ id: tag.id, name: trimmed })
  }

  return (
    <View>
      <View style={styles.title}>
        <TagDot hue={tag.hue} />
        <Text style={styles.titleText} numberOfLines={1}>
          Tag <Text style={styles.titleName}>{tag.name}</Text>
        </Text>
        <Text style={styles.hint}>{plural(tag.songCount, 'song', 'songs')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextField
          raised
          value={name}
          onChangeText={text => {
            setName(text)
            rename.reset()
          }}
          onSubmitEditing={submit}
          autoCapitalize="none"
          maxLength={TAG_NAME_MAX}
          accessibilityLabel="Name"
          action={
            <Button
              label="Rename"
              variant="primary"
              disabled={!changed || rename.isPending}
              onPress={submit}
              icon={
                rename.isSuccess && !changed ? (
                  <Check size={iconSize.sub} color={accent.onAccent} />
                ) : undefined
              }
            />
          }
        />
        {rename.error ? (
          <StatusLine style={styles.error}>
            {failureText('Couldn’t rename it', rename.error)}
          </StatusLine>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.fieldLabel}>Colour</Text>
        <HueSwatches
          value={tag.hue}
          first={openedHue}
          onChange={hue => setHue.mutate({ id: tag.id, hue })}
        />
      </View>

      {!confirmingDelete ? (
        <SheetItem
          icon={<Trash color={theme.colors.danger} />}
          label="Delete tag…"
          danger
          onPress={() => setConfirmingDelete(true)}
        />
      ) : (
        <View>
          <Text style={[styles.hint, styles.confirm]}>
            Delete “{tag.name}”? Its {plural(tag.songCount, 'song stays', 'songs stay')} in your
            library.
            {following.length > 0
              ? ` ${quoted(following)} ${following.length === 1 ? 'fills' : 'fill'} from it, and will go on without it.`
              : null}
          </Text>
          <SheetItem
            icon={<Trash color={theme.colors.danger} />}
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

/** The playlists that fill from this tag, by name: what deleting it changes (`rulesWithoutTag`). */
function followersOf(playlists: readonly Playlist[], tagId: number): string[] {
  return playlists
    .filter(playlist => playlist.rules && rulesWithoutTag(playlist.rules, tagId) !== undefined)
    .map(playlist => playlist.name)
}

/** “A”, “A” and “B”, or “A”, “B” and 3 more. */
function quoted(names: readonly string[]): string {
  const shown = names.slice(0, 2).map(name => `“${name}”`)
  const more = names.length - shown.length
  if (more > 0) return `${shown.join(', ')} and ${more} more`
  return shown.join(' and ')
}

const styles = StyleSheet.create(theme => ({
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  titleText: { color: theme.colors.textSecondary, fontSize: type.sub, flexShrink: 1 },
  titleName: { color: theme.colors.textPrimary, fontWeight: '700' },
  hint: { color: theme.colors.textMuted, fontSize: type.small },
  section: { paddingTop: space.xs, paddingHorizontal: space.xs, paddingBottom: space.sm },
  fieldLabel: { ...label(theme.colors), marginBottom: 5 },
  error: { marginTop: 5 },
  confirm: { paddingHorizontal: space.md, paddingVertical: space.sm },
}))
