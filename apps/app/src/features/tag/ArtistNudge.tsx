import type { ReactNode } from 'react'
import type { Artist } from '@selfmp3/shared'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { nudgeBody, nudgeTitle } from './artistNudge.model'

/**
 * A tag named like an artist: nudge, then allow (docs/ui-mock `P11`).
 *
 * The artist is the answer offered first, in the filled button, because it is
 * what most people typing the name wanted, and it is already a page with every
 * one of their songs. "Make the tag anyway" is a real choice rather than a
 * cancel, so closing the dialog any other way — the backdrop, Escape — makes
 * nothing at all.
 *
 * Drawn only while `artist` is set; `useArtistNudge` decides when that is.
 */
export function ArtistNudge({
  name,
  artist,
  onOpenArtist,
  onMakeAnyway,
  onClose,
}: {
  /** The tag's name as typed. */
  name: string
  artist: Artist | null
  onOpenArtist: () => void
  onMakeAnyway: () => void
  onClose: () => void
}): ReactNode {
  return (
    <ConfirmDialog
      open={artist !== null}
      title={nudgeTitle(name)}
      body={artist ? nudgeBody(artist) : undefined}
      confirmLabel="Open the artist"
      cancelLabel="Make the tag anyway"
      onConfirm={onOpenArtist}
      onCancel={onMakeAnyway}
      onDismiss={onClose}
    />
  )
}
