import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useLibrary } from '@selfmp3/client'
import { TagEditor } from '../../ui/components/TagEditor'
import { PlaceMissing } from './PlaceMissing'
import { PlacePage } from './PlacePage'
import { existingTag } from './tag.model'

/**
 * A tag's page, `/tag/<name>` (docs/ui-mock `P08`, `C06`). The name is found
 * whatever its case; the ⋯ renames, recolours or deletes the tag. Renamed,
 * the address follows the new name; deleted, the page goes back.
 */
export function TagScreen(): ReactNode {
  const router = useRouter()
  const { name } = useLocalSearchParams<{ name: string }>()
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
