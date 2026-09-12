import { useState } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { formatBytes, type Song } from '@selfmp3/shared'
import { clientApi, colors, isDownloaded, space } from '@selfmp3/client'
import { useAddToPlaylist, useDeleteSong, useLibrary, usePatchSong } from '../../api/queries'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import {
  CheckSquare,
  CloudDownload,
  Info,
  ListMusic,
  Music,
  Queue,
  Sparkles,
  Tag as TagIcon,
  Trash,
  X,
} from './Icons'
import { Sheet, SheetItem } from './Sheet'
import { SongDetails } from './SongDetails'
import { TagPicker } from './TagPicker'

/**
 * The ⋯ menu for a song: the web's `SongMenu`, in its order.
 *
 * At phone width this is a row's only set of actions, so everything a row can
 * do has to be reachable from here, tagging included. The song's name heads it,
 * so a menu opened by holding a row still says which row it came from.
 *
 * Destructive actions sit last and apart. Removing asks first, and "remove
 * from my list" and "delete the actual file" are separate choices, never one
 * mis-tap apart.
 *
 * Editing tags and the song's details replace the menu rather than stacking on
 * it, as on the web.
 */
export function SongMenu({
  song,
  onClose,
  onStartSelecting,
}: {
  song: Song | null
  onClose: () => void
  /**
   * Where the list supports it, "Select" starts selection mode with this song
   * ticked — the web's third way in, and the only one a held finger has.
   */
  onStartSelecting?: (song: Song) => void
}): ReactNode {
  const { data: library } = useLibrary()
  const [opened, setOpened] = useState<{ kind: 'tags' | 'details'; songId: number } | null>(null)
  // The song as the library has it now, so a dialog opened from the menu shows
  // the tags or the play count after a change rather than a snapshot.
  const openedSong =
    opened === null ? null : (library?.songs.find(item => item.id === opened.songId) ?? null)

  return (
    <>
      <Sheet
        testID="song-menu"
        open={song !== null}
        onClose={onClose}
        title={song?.title}
        subtitle={song ? song.artist || 'Unknown artist' : undefined}
      >
        {song ? (
          <Items
            song={song}
            onClose={onClose}
            onStartSelecting={onStartSelecting}
            onOpen={kind => {
              setOpened({ kind, songId: song.id })
              onClose()
            }}
          />
        ) : null}
      </Sheet>

      <TagPicker
        song={opened?.kind === 'tags' ? openedSong : null}
        onClose={() => setOpened(null)}
      />
      {opened?.kind === 'details' && openedSong ? (
        <SongDetails song={openedSong} onClose={() => setOpened(null)} />
      ) : null}
    </>
  )
}

function Items({
  song,
  onClose,
  onStartSelecting,
  onOpen,
}: {
  song: Song
  onClose: () => void
  onStartSelecting?: (song: Song) => void
  onOpen: (kind: 'tags' | 'details') => void
}): ReactNode {
  const player = usePlayer()
  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const deleteSong = useDeleteSong()
  const patchSong = usePatchSong()
  const { state: downloads, queue: downloadQueue } = useDownloads()
  const [playlistsOpen, setPlaylistsOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const held = isDownloaded(downloads.index, song.id)
  const manualPlaylists = (library?.playlists ?? []).filter(list => list.kind === 'manual')

  const then = (run: () => void) => (): void => {
    run()
    onClose()
  }

  /** Nearest neighbours from the server; the seed song leads the list. */
  const withSimilar = (use: (songIds: number[]) => void): void => {
    void clientApi()
      .similar(song.id, 20)
      .then(result => use([song.id, ...result.songs.map(item => item.id)]))
      .catch(() => undefined)
  }

  const icon = (Glyph: typeof Queue) => <Glyph size={16} color={colors.textSecondary} />

  return (
    <>
      {onStartSelecting ? (
        <>
          <SheetItem
            icon={icon(CheckSquare)}
            label="Select"
            onPress={then(() => onStartSelecting(song))}
          />
          <View style={styles.divider} />
        </>
      ) : null}

      <SheetItem
        icon={icon(Queue)}
        label="Play next"
        onPress={then(() => player.playNext([song.id]))}
      />
      <SheetItem
        icon={icon(ListMusic)}
        label="Add to queue"
        onPress={then(() => player.addToQueue([song.id]))}
      />

      <View style={styles.divider} />

      <SheetItem
        icon={icon(Sparkles)}
        label="Play similar"
        onPress={then(() => withSimilar(songIds => player.playFrom(songIds, 0)))}
      />
      <SheetItem
        icon={icon(Sparkles)}
        label="Add similar to queue"
        onPress={then(() => withSimilar(songIds => player.addToQueue(songIds.slice(1))))}
      />

      <View style={styles.divider} />

      <SheetItem icon={icon(TagIcon)} label="Edit tags…" onPress={() => onOpen('tags')} />
      <SheetItem
        icon={icon(ListMusic)}
        label="Add to playlist…"
        active={playlistsOpen}
        onPress={() => setPlaylistsOpen(open => !open)}
      />
      {playlistsOpen ? (
        <View style={styles.nested}>
          {manualPlaylists.length === 0 ? (
            <Text style={styles.hint}>No playlists yet.</Text>
          ) : (
            manualPlaylists.map(list => (
              <SheetItem
                key={list.id}
                label={list.name}
                onPress={then(() =>
                  addToPlaylist.mutate({ playlistId: list.id, songIds: [song.id] }),
                )}
              />
            ))
          )}
        </View>
      ) : null}

      <View style={styles.divider} />

      <SheetItem icon={icon(Info)} label="Song details" onPress={() => onOpen('details')} />
      {/* An instrumental gets a visual instead of "no lyrics found", and is not
          looked up again. Easy to take back: lyrics added later win. */}
      <SheetItem
        icon={icon(Music)}
        label={song.instrumental ? 'Has lyrics after all' : 'Mark as instrumental'}
        onPress={then(() =>
          patchSong.mutate({ id: song.id, patch: { instrumental: !song.instrumental } }),
        )}
      />
      {held ? (
        <SheetItem
          icon={icon(X)}
          label="Remove download"
          onPress={then(() => void downloadQueue.remove([song.id]))}
        />
      ) : (
        <SheetItem
          icon={icon(CloudDownload)}
          label="Download for offline"
          detail={song.sizeBytes > 0 ? formatBytes(song.sizeBytes) : undefined}
          onPress={then(() => downloadQueue.enqueue([song.id]))}
        />
      )}

      <View style={styles.divider} />

      {!confirmingDelete ? (
        <SheetItem
          icon={<Trash size={16} color={colors.danger} />}
          label="Remove from library…"
          danger
          onPress={() => setConfirmingDelete(true)}
        />
      ) : (
        <View>
          <Text style={styles.hint}>Remove “{song.title}”?</Text>
          <SheetItem
            label="Remove from library, keep the file"
            onPress={then(() => deleteSong.mutate({ id: song.id, deleteFile: false }))}
          />
          <SheetItem
            icon={<Trash size={16} color={colors.danger} />}
            label="Delete the file too"
            danger
            onPress={then(() => deleteSong.mutate({ id: song.id, deleteFile: true }))}
          />
          <SheetItem label="Cancel" onPress={() => setConfirmingDelete(false)} />
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.xs },
  nested: { paddingLeft: space.lg },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
})
