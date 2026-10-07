import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useLibrary } from '@selfmp3/client'
import { Pencil, TagPlus } from '../../ui/components/Icons'
import { Popover } from '../../ui/components/Popover'
import { SheetItem } from '../../ui/components/Sheet'
import { TagEditor } from '../../ui/components/TagEditor'
import { AddSongsSheet } from '../playlistDetail/AddSongsSheet'
import { PlaceMissing } from './PlaceMissing'
import { PlacePage } from './PlacePage'
import { existingTag, placeSongs } from './tag.model'
import { usePlayer } from '../../player/PlayerProvider'

/**
 * A tag's page, `/tag/<name>` (docs/ui-mock `P08`, `C06`). The name is found
 * whatever its case. Its ⋯ offers Tag songs… — adding a song to a tag is
 * tagging it (docs/features/lists.md) — and the editor that renames,
 * recolours or deletes it. Renamed, the address follows the new name;
 * deleted, the page goes back.
 */
export function TagScreen(): ReactNode {
  const router = useRouter()
  const { name, play } = useLocalSearchParams<{ name: string; play?: string }>()
  const player = usePlayer()
  const { data: library } = useLibrary()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [tagging, setTagging] = useState(false)
  const anchor = useRef<View | null>(null)
  // The tag this page is about, held by id once found, so a rename is followed.
  const [tagId, setTagId] = useState<number | null>(null)

  const byName = library ? existingTag(library.tags, name ?? '') : null
  if (byName && tagId === null) setTagId(byName.id)
  const tag = library?.tags.find(entry => entry.id === tagId) ?? byName

  useEffect(() => {
    if (tag && name && tag.name !== name) router.setParams({ name: tag.name })
  }, [tag, name, router])

  // A tile on the home-screen widget opens `/tag/<name>?play=1`: the tag
  // starts as the page opens, once, and the address forgets it so going back
  // and forth does not start it again.
  useEffect(() => {
    if (play !== '1' || !tag || !library) return
    const ids = placeSongs([{ kind: 'tag', tag }], library.songs).map(song => song.id)
    if (ids.length > 0) {
      player.playFrom(ids, 0, { source: { kind: 'tag', tagId: tag.id, name: tag.name } })
    }
    router.setParams({ play: undefined })
  }, [play, tag, library, player, router])

  const inTag = useMemo(
    () =>
      new Set(
        tag
          ? (library?.songs ?? []).filter(song => song.tagIds.includes(tag.id)).map(s => s.id)
          : [],
      ),
    [library, tag],
  )

  if (!library) return null
  if (!tag) return <PlaceMissing kind="tag" name={name ?? ''} />
  return (
    <>
      <PlacePage
        key={tag.id}
        places={[{ kind: 'tag', tag }]}
        menu={node => {
          anchor.current = node
          setMenuOpen(true)
        }}
      />
      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={anchor}
        width={240}
        testID="tag-menu"
      >
        <SheetItem
          icon={<TagPlus size={16} tone="textSecondary" />}
          label="Tag songs…"
          onPress={() => {
            setMenuOpen(false)
            setTagging(true)
          }}
        />
        <SheetItem
          icon={<Pencil size={16} tone="textSecondary" />}
          label="Rename, colour or delete"
          onPress={() => {
            setMenuOpen(false)
            setEditing(true)
          }}
        />
      </Popover>
      <AddSongsSheet
        open={tagging}
        onClose={() => setTagging(false)}
        targetName={tag.name}
        target={{ kind: 'tag', tagId: tag.id, inTag }}
      />
      <TagEditor
        tag={editing ? tag : null}
        anchorRef={anchor}
        onClose={() => setEditing(false)}
        onDeleted={() => {
          setEditing(false)
          if (router.canGoBack()) router.back()
          else router.replace('/tags')
        }}
      />
    </>
  )
}
