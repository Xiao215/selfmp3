import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useLibrary } from '@selfmp3/client'
import { TagEditor } from '../../ui/components/TagEditor'
import { PlaceMissing } from './PlaceMissing'
import { PlacePage } from './PlacePage'
import { existingTag, placeSongs } from './tag.model'
import { usePlayer } from '../../player/PlayerProvider'

/**
 * A tag's page, `/tag/<name>` (docs/ui-mock `P08`, `C06`). The name is found
 * whatever its case; the ⋯ renames, recolours or deletes the tag. Renamed,
 * the address follows the new name; deleted, the page goes back.
 */
export function TagScreen(): ReactNode {
  const router = useRouter()
  const { name, play } = useLocalSearchParams<{ name: string; play?: string }>()
  const player = usePlayer()
  const { data: library } = useLibrary()
  const [editing, setEditing] = useState(false)
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
    if (ids.length > 0) player.playFrom(ids, 0)
    router.setParams({ play: undefined })
  }, [play, tag, library, player, router])

  if (!library) return null
  if (!tag) return <PlaceMissing kind="tag" name={name ?? ''} />
  return (
    <>
      <PlacePage
        key={tag.id}
        place={{ kind: 'tag', tag }}
        menu={node => {
          anchor.current = node
          setEditing(true)
        }}
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
