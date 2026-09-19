import { useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'expo-router'
import { useLibrary, type Artist } from '@selfmp3/client'
import { ArtistNudge } from './ArtistNudge'
import { artistLink } from './placeLinks'
import { artistNamed } from './tag.model'

interface Pending {
  readonly name: string
  readonly artist: Artist
  readonly make: () => void
}

/**
 * Every place a tag is made by name goes through here: All tags' new-tag
 * card, the sidebar's ＋, and the tag picker's "Create…".
 *
 * `check(name, make)` makes the tag at once when no artist has that name, and
 * otherwise asks first (`ArtistNudge`); `make` runs only on "Make the tag
 * anyway". The caller draws `nudge` somewhere in its tree. `onLeave` is for a
 * caller that is itself a window — a picker over the page — to close as the
 * artist's page opens under it.
 */
export function useArtistNudge(onLeave?: () => void): {
  readonly check: (name: string, make: () => void) => void
  readonly nudge: ReactNode
} {
  const router = useRouter()
  const { data: library } = useLibrary()
  const [pending, setPending] = useState<Pending | null>(null)

  const check = (name: string, make: () => void): void => {
    const artist = library ? artistNamed(library.songs, name) : null
    if (artist) setPending({ name, artist, make })
    else make()
  }

  const nudge = (
    <ArtistNudge
      name={pending?.name ?? ''}
      artist={pending?.artist ?? null}
      onOpenArtist={() => {
        if (!pending) return
        setPending(null)
        onLeave?.()
        router.navigate(artistLink(pending.artist.name))
      }}
      onMakeAnyway={() => {
        setPending(null)
        pending?.make()
      }}
      onClose={() => setPending(null)}
    />
  )

  return { check, nudge }
}
