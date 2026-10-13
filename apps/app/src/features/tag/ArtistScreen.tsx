import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { useBulkTag, useCreateTag, useLibrary, iconSize } from '@selfmp3/client'
import { Tag as TagIcon } from '../../ui/components/Icons'
import type { MenuItem } from '../../ui/components/MoreMenu'
import { showToast } from '../../ui/toast'
import { useOpenTag } from './useOpenTag'
import { PlaceMissing } from './PlaceMissing'
import { PlacePage } from './PlacePage'
import { existingTag } from './tag.model'
import { plural, findArtist, type Artist } from '@selfmp3/shared'

/**
 * An artist's page, `/artist/<name>` (docs/ui-mock `P10`): the tag page with
 * a figure where the dot would be. An artist is what the songs say, so it
 * cannot be renamed or deleted here; after what every list's ⋯ offers, its
 * own is the one bridge there is, "Make a tag from this artist" (`P11`).
 */
export function ArtistScreen(): ReactNode {
  const { name } = useLocalSearchParams<{ name: string }>()
  const { data: library } = useLibrary()
  const artist = (library ? findArtist(library.songs, name ?? '') : null) ?? null
  const makeTag = useMakeTag(artist)

  if (!library) return null
  if (!artist) return <PlaceMissing kind="artist" name={name ?? ''} />
  return <PlacePage key={artist.key} places={[{ kind: 'artist', artist }]} menuItems={[makeTag]} />
}

/**
 * The bridge from an artist to a tag (`P11`), as an item of the artist's ⋯.
 * It runs once and says what it did; where a tag of that name already exists
 * it makes nothing and opens that tag instead.
 */
function useMakeTag(artist: Artist | null): MenuItem {
  const openTag = useOpenTag()
  const { data: library } = useLibrary()
  const createTag = useCreateTag()
  const bulkTag = useBulkTag()
  // A second press while the first is still making it makes nothing.
  const busy = useRef(false)

  const make = async (): Promise<void> => {
    if (!artist || busy.current) return
    const already = existingTag(library?.tags ?? [], artist.name)
    if (already) {
      openTag(already)
      return
    }
    busy.current = true
    try {
      const tag = await createTag.mutateAsync({ name: artist.name })
      await bulkTag.mutateAsync({ songIds: [...artist.songIds], tagId: tag.id, action: 'add' })
      const count = artist.songIds.length
      showToast(`Made the tag “${tag.name}” from ${plural(count, 'song', 'songs')}`, 'good')
      openTag(tag)
    } catch {
      // The mutations say what failed themselves.
    } finally {
      busy.current = false
    }
  }

  return {
    key: 'make-tag',
    label: 'Make a tag from this artist',
    icon: <TagIcon size={iconSize.item} tone="textSecondary" />,
    apart: true,
    onPress: () => void make(),
  }
}
