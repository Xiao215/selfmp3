import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useBulkTag, useCreateTag, useLibrary, iconSize } from '@selfmp3/client'
import { Pencil, Tag as TagIcon } from '../../ui/components/Icons'
import type { MenuItem } from '../../ui/components/MoreMenu'
import { showToast } from '../../ui/toast'
import { useOpenTag } from './useOpenTag'
import { PlaceMissing, PlaceWaiting } from './PlaceMissing'
import { PlacePage } from './PlacePage'
import { ArtistNamesEditor } from './ArtistNamesEditor'
import { existingTag } from './tag.model'
import { plural, findArtist, type Artist } from '@selfmp3/shared'

/**
 * An artist's page, `/artist/<name>` (docs/ui-mock `P10`): the tag page with
 * a figure where the dot would be. An artist is what the songs say, so it
 * cannot be renamed or deleted here; after what every list's ⋯ offers, its
 * own are the one bridge there is, "Make a tag from this artist" (`P11`), and
 * the other names search finds the artist by.
 */
export function ArtistScreen(): ReactNode {
  const { name } = useLocalSearchParams<{ name: string }>()
  const { data: library } = useLibrary()
  const artist = (library ? findArtist(library.songs, name ?? '') : null) ?? null
  const makeTag = useMakeTag(artist)
  const [naming, setNaming] = useState(false)
  // The names editor opens over the same ⋯.
  const anchor = useRef<View>(null)

  if (!library) return <PlaceWaiting />
  if (!artist) return <PlaceMissing kind="artist" name={name ?? ''} />
  return (
    <>
      <PlacePage
        key={artist.key}
        places={[{ kind: 'artist', artist }]}
        menuAnchor={anchor}
        menuItems={[
          makeTag,
          {
            key: 'other-names',
            label: 'Other names…',
            icon: <Pencil size={iconSize.item} tone="textSecondary" />,
            onPress: () => setNaming(true),
          },
        ]}
      />
      <ArtistNamesEditor
        artist={naming ? artist : null}
        anchorRef={anchor}
        onClose={() => setNaming(false)}
      />
    </>
  )
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
      showToast(
        { over: `Made a tag from ${plural(count, 'song', 'songs')}`, say: tag.name },
        'good',
      )
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
