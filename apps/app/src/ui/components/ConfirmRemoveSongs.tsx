import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { plural, type Song } from '@selfmp3/shared'
import { failureText, useBulkDeleteSongs, useLibrary, radius } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { showToast } from '../toast'
import { ConfirmDialog } from './ConfirmDialog'
import { Cover, CoverEdge } from './Cover'

/**
 * Deleting songs from the library, from the question to the word afterwards:
 * the selection bar's and a song's ⋯ menu's are the same act, so they are the
 * same dialog doing the same things in the same order.
 *
 * On yes, the copies here go and the player lets go of the songs at once — the
 * one playing stops, and the next waits paused (`forgetSongs`) — rather than
 * after the server answers: the counts drawn from the library and the download
 * index have to lose them at the same moment, and music still playing from a
 * song you have just removed reads as the remove not having worked.
 */
export function RemoveSongs({
  songs,
  onCancel,
  onDone,
}: {
  songs: readonly Song[]
  onCancel: () => void
  /** Removed: close whatever asked. */
  onDone: () => void
}): ReactNode {
  const player = usePlayerCommands()
  const { dropDownloads } = useDownloads()
  const bulkDelete = useBulkDeleteSongs()
  const [error, setError] = useState<string | null>(null)
  const { data: library } = useLibrary()

  /*
   * A delete that reached the server but whose answer was lost failed here
   * while the list behind already showed the songs gone. Once every one of
   * them has left the library, it worked: say so and close.
   */
  const gone =
    error !== null &&
    library !== undefined &&
    !songs.some(song => library.songs.some(held => held.id === song.id))
  const told = useRef(false)
  useEffect(() => {
    if (!gone || told.current) return
    told.current = true
    onDone()
    const only = songs.length === 1 ? songs[0] : undefined
    showToast(
      only ? `Deleted “${only.title}”` : `Deleted ${plural(songs.length, 'song', 'songs')}`,
      'good',
    )
  }, [gone, onDone, songs])

  const confirm = (): void => {
    const ids = songs.map(song => song.id)
    setError(null)
    void dropDownloads(ids)
    player.forgetSongs(ids)
    bulkDelete.mutate(
      { songIds: ids },
      {
        onSuccess: result => {
          onDone()
          // The summary: what went, and what did not.
          const only = songs.length === 1 && result.removed === 1 ? songs[0] : undefined
          const parts = [
            only ? `Deleted “${only.title}”` : `Deleted ${plural(result.removed, 'song', 'songs')}`,
          ]
          // Why one could not go is the server's to log, not the toast's to quote.
          const trouble = result.failed.length
          if (trouble > 0) {
            parts.push(`${plural(trouble, 'song', 'songs')} couldn’t be deleted`)
            console.warn('Songs not deleted:', result.failed)
          }
          showToast(parts.join(', '), trouble > 0 ? 'warn' : 'good')
        },
        onError: caught =>
          setError(
            failureText(songs.length === 1 ? 'Couldn’t delete it' : 'Couldn’t delete them', caught),
          ),
      },
    )
  }

  return (
    <ConfirmRemoveSongs
      songs={songs}
      picture={<SongsPicture songs={songs} />}
      pending={bulkDelete.isPending}
      error={error}
      onCancel={onCancel}
      onConfirm={confirm}
    />
  )
}

/**
 * The confirmation for deleting a selection from the library: the shared
 * confirm dialog, asking "Delete this song?" with the song pictured and named.
 *
 * One question, one answer. Removing a song is removing it everywhere: the
 * row leaves the library on every device, whatever this device downloaded of
 * it goes with it, and the bucket lets the song's files go once nothing names
 * them (docs/SYNC.md). There is no "keep the file": the server keeps no copy
 * to keep, and a copy left on a disk somewhere is exactly how a removed song
 * comes back.
 *
 * A failure is shown inside the dialog, which stays open so that trying again
 * is one press, rather than closing it and reporting underneath.
 */
export function ConfirmRemoveSongs({
  songs,
  picture,
  pending = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  songs: readonly Song[]
  /** The songs pictured beside the question (`SongsPicture`). */
  picture?: ReactNode
  pending?: boolean
  /** Why the last attempt failed, if it did. */
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const count = songs.length
  const only = count === 1 ? songs[0] : undefined
  const cancel = (): void => {
    if (!pending) onCancel()
  }

  return (
    <ConfirmDialog
      open
      title={only ? 'Delete this song?' : `Delete ${count} songs?`}
      name={songNames(songs)}
      picture={picture}
      body={
        only
          ? 'It goes from every device, with its tags and plays. There’s no undo.'
          : 'They go from every device, with their tags and plays. There’s no undo.'
      }
      confirmLabel="Delete"
      danger
      busy={pending}
      error={error}
      onConfirm={onConfirm}
      onCancel={cancel}
      testID="confirm-remove-songs"
    />
  )
}

/** "Song 1", "Song 1 and Song 2", "Song 1, Song 2, Song 3 and 4 more". */
function songNames(songs: readonly Pick<Song, 'title'>[]): string {
  const titles = songs.map(song => song.title)
  if (titles.length <= 1) return titles[0] ?? ''
  if (titles.length <= 3) return `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`
  return `${titles.slice(0, 3).join(', ')} and ${titles.length - 3} more`
}

/** The question's picture: one song's cover, or four songs' as a mosaic. */
function SongsPicture({ songs }: { songs: readonly Song[] }): ReactNode {
  const artFor = useArt(PICTURE)
  const first = songs[0]
  if (!first) return null
  if (songs.length < 4) {
    return <Cover uri={artFor(first)} title={first.album || first.title} size={PICTURE} />
  }
  return (
    <View style={styles.mosaic}>
      {songs.slice(0, 4).map(song => (
        <Cover
          key={song.id}
          uri={artFor(song)}
          title={song.album || song.title}
          size={PICTURE / 2}
          radius={0}
        />
      ))}
      <CoverEdge radius={radius.cover} />
    </View>
  )
}

const PICTURE = 52

const styles = StyleSheet.create(theme => ({
  mosaic: {
    width: PICTURE,
    height: PICTURE,
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
    borderRadius: radius.cover,
    backgroundColor: theme.colors.surface2,
  },
}))
