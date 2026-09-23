import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useBulkTag, useCreateTag, useLibrary } from '@selfmp3/client'
import { Popover } from '../../ui/components/Popover'
import { SheetItem } from '../../ui/components/Sheet'
import { Tag as TagIcon } from '../../ui/components/Icons'
import { showToast } from '../../ui/toast'
import { tagLink } from './placeLinks'
import { PlaceMissing } from './PlaceMissing'
import { PlacePage } from './PlacePage'
import { existingTag } from './tag.model'
import { plural, findArtist, type Artist } from '@selfmp3/shared'

/**
 * An artist's page, `/artist/<name>` (docs/ui-mock `P10`): the tag page with
 * a figure where the dot would be. An artist is what the songs say, so it
 * cannot be renamed or deleted here; its ⋯ offers the one bridge there is,
 * "Make a tag from this artist" (`P11`).
 */
export function ArtistScreen(): ReactNode {
  const { name } = useLocalSearchParams<{ name: string }>()
  const { data: library } = useLibrary()
  const [open, setOpen] = useState(false)
  const anchor = useRef<View | null>(null)

  if (!library) return null
  const artist = findArtist(library.songs, name ?? '')
  if (!artist) return <PlaceMissing kind="artist" name={name ?? ''} />
  return (
    <>
      <PlacePage
        key={artist.key}
        place={{ kind: 'artist', artist }}
        menu={node => {
          anchor.current = node
          setOpen(true)
        }}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={260}>
        <MakeTag artist={artist} onDone={() => setOpen(false)} />
      </Popover>
    </>
  )
}

/**
 * The bridge from an artist to a tag (`P11`). It runs once and says what it
 * did; where a tag of that name already exists it makes nothing and opens
 * that tag instead.
 */
function MakeTag({ artist, onDone }: { artist: Artist; onDone: () => void }): ReactNode {
  const router = useRouter()
  const { data: library } = useLibrary()
  const createTag = useCreateTag()
  const bulkTag = useBulkTag()
  const [busy, setBusy] = useState(false)

  const make = async (): Promise<void> => {
    const already = existingTag(library?.tags ?? [], artist.name)
    if (already) {
      onDone()
      router.navigate(tagLink(already.name))
      return
    }
    setBusy(true)
    try {
      const tag = await createTag.mutateAsync(artist.name)
      await bulkTag.mutateAsync({ songIds: [...artist.songIds], tagId: tag.id, action: 'add' })
      const count = artist.songIds.length
      showToast(`Made the tag “${tag.name}” from ${plural(count, 'song', 'songs')}`, 'good')
      onDone()
      router.navigate(tagLink(tag.name))
    } catch {
      // The mutations say what failed themselves.
      setBusy(false)
    }
  }

  return (
    <SheetItem
      icon={<TagIcon size={16} tone="textSecondary" />}
      label={busy ? 'Making the tag…' : 'Make a tag from this artist'}
      onPress={() => void make()}
      disabled={busy}
    />
  )
}
